import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import type { RuleAction, RuleTrigger } from "@offboard/db/schema";
import { automationRules, equipment, offboardingCases, tasks } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import type { RuleContext } from "../../shared/rule-dispatch.js";
import { executeRule, fireRulesForTrigger, type EngineRepos, type Rule } from "./engine.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

type Received = { method: string; url: string; body: string };

function rule(
  actions: RuleAction[],
  conditions: Rule["conditions"] = {},
  trigger: RuleTrigger = "correios.delivered",
) {
  return { id: "rule-1", name: "Rule", trigger, conditions, actions } satisfies Rule;
}

describe.skipIf(!url)("automation rules engine", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const brokenDb = createClient("postgres://offboard@127.0.0.1:1/none");
  const broken = createRepositories(brokenDb);

  const received: Received[] = [];
  let serverUrl = "";
  let correiosChecks = 0;

  const engine = {
    automationRules: repos.automationRules,
    offboardings: repos.offboardings,
    equipment: repos.equipment,
    runCorreiosCheck: async () => {
      correiosChecks += 1;
    },
  } satisfies EngineRepos;

  const bare = { ...engine, runCorreiosCheck: undefined } satisfies EngineRepos;

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      received.push({ method: req.method ?? "", url: req.url ?? "", body });

      if (req.url === "/fail") {
        res.writeHead(500);
        res.end("error");

        return;
      }

      if (req.url === "/emails") {
        const parsed = JSON.parse(body);

        if (parsed.to === "fail@example.com") {
          res.writeHead(422);
          res.end(JSON.stringify({ name: "validation_error", message: "Invalid recipient" }));

          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ id: "email_1" }));

        return;
      }

      if (req.url === "/chat.postMessage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, channel: "C1", ts: "1.1" }));

        return;
      }

      res.writeHead(200);
      res.end("ok");
    });
  });

  const saved = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_API_URL: process.env.SLACK_API_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_BASE_URL: process.env.RESEND_BASE_URL,
  };

  const missingId = "00000000-0000-4000-8000-000000000000";

  let context: RuleContext = {};
  let equipmentId = "";
  let taskId = "";
  let caseId = "";

  async function equipmentStatus() {
    const [row] = await db
      .select({ status: equipment.status })
      .from(equipment)
      .where(eq(equipment.id, equipmentId));

    return row.status;
  }

  async function taskStatus() {
    const [row] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId));

    return row.status;
  }

  function addRule(trigger: RuleTrigger, actions: RuleAction[], conditions: Rule["conditions"]) {
    return repos.automationRules.createRule({
      name: `${trigger}-${actions.map((action) => action.type).join(",")}`,
      trigger,
      conditions,
      actions,
      enabled: true,
      cronSchedule: null,
    });
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();

        serverUrl = `http://127.0.0.1:${addr != null && addr instanceof Object ? addr.port : 0}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    server.close();
    await db.$client.end();
    await brokenDb.$client.end();

    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
    await db.delete(automationRules);

    received.length = 0;
    correiosChecks = 0;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.RESEND_API_KEY;
    process.env.SLACK_API_URL = `${serverUrl}/`;
    process.env.RESEND_BASE_URL = serverUrl;

    const [item] = await db.select().from(equipment).where(eq(equipment.returnMethod, "pickup"));

    const [owner] = await db
      .select()
      .from(offboardingCases)
      .where(eq(offboardingCases.id, item.caseId));

    const [task] = await db
      .insert(tasks)
      .values({ caseId: owner.id, title: "Devolver notebook", team: "TI", position: 99 })
      .returning({ id: tasks.id });

    await db.update(equipment).set({ status: "transit" }).where(eq(equipment.id, item.id));

    equipmentId = item.id;
    taskId = task.id;
    caseId = owner.id;

    context = {
      equipment: {
        id: item.id,
        tag: item.tag,
        item: item.item,
        status: "transit",
        caseId: owner.id,
      },
      task: { id: task.id, title: "Devolver notebook", status: "todo", caseId: owner.id },
      case: { id: owner.id, name: owner.name },
    };
  });

  it("skips a rule when a condition does not match", async () => {
    const result = await executeRule(
      rule([{ type: "update_task", set: { status: "done" } }], { "equipment.status": "received" }),
      context,
      engine,
    );

    expect(result).toEqual({ ruleId: "rule-1", matched: false, errors: [] });
    expect(await taskStatus()).toBe("todo");
  });

  it("matches nested context conditions", async () => {
    const action: RuleAction = { type: "update_task", set: { status: "done" } };

    const missing = await executeRule(
      rule([action], { "equipment.status": "transit", "task.missing.deep": "x" }),
      context,
      engine,
    );

    expect(missing.matched).toBe(false);

    const matched = await executeRule(
      rule([action], { "equipment.status": "transit", "case.id": caseId }),
      context,
      engine,
    );

    expect(matched).toEqual({ ruleId: "rule-1", matched: true, errors: [] });
    expect(await taskStatus()).toBe("done");
  });

  it("evaluates the all-equipment-received condition against the database", async () => {
    const conditions = { "case.allEquipmentReceived": true };
    const action: RuleAction = { type: "webhook", url: `${serverUrl}/hook` };

    expect((await executeRule(rule([action], conditions), context, engine)).matched).toBe(false);

    await db.update(equipment).set({ status: "received" }).where(eq(equipment.caseId, caseId));

    expect((await executeRule(rule([action], conditions), context, engine)).matched).toBe(true);

    expect(
      (await executeRule(rule([action], conditions), { equipment: context.equipment }, engine))
        .matched,
    ).toBe(false);
  });

  it("updates the task, skipping when it already has the target status", async () => {
    const action: RuleAction = { type: "update_task", set: { status: "done" } };

    await executeRule(
      rule([action]),
      { task: { id: taskId, title: "t", status: "done", caseId } },
      engine,
    );

    expect(await taskStatus()).toBe("todo");

    await executeRule(rule([action]), context, engine);

    expect(await taskStatus()).toBe("done");
  });

  it("reports invalid or unavailable update_task actions", async () => {
    const valid: RuleAction = { type: "update_task", set: { status: "done" } };

    expect(
      (
        await executeRule(
          rule([{ type: "update_task", set: { status: "bogus" } }]),
          context,
          engine,
        )
      ).errors,
    ).toEqual(["update_task: update_task requires set.status"]);

    expect((await executeRule(rule([valid]), { case: context.case }, engine)).errors).toEqual([
      "update_task: update_task requires a task in context",
    ]);

    expect(
      (
        await executeRule(
          rule([valid]),
          { task: { id: missingId, title: "gone", status: "todo", caseId } },
          engine,
        )
      ).errors,
    ).toEqual(["update_task: task not found"]);
  });

  it("updates the equipment and chains status_changed rules with the new context", async () => {
    await addRule("equipment.status_changed", [{ type: "webhook", url: `${serverUrl}/hook` }], {
      "equipment.status": "received",
      "equipment.previousStatus": "transit",
    });

    const result = await executeRule(
      rule([
        { type: "update_equipment", set: { status: "received" } },
        { type: "webhook", url: `${serverUrl}/after` },
      ]),
      context,
      engine,
    );

    expect(result.errors).toEqual([]);
    expect(await equipmentStatus()).toBe("received");
    expect(received.map((r) => r.url)).toEqual(["/hook", "/after"]);
    expect(JSON.parse(received[1].body).equipment.status).toBe("received");
  });

  it("chains task status_changed rules after update_task", async () => {
    await addRule("task.status_changed", [{ type: "webhook", url: `${serverUrl}/task-hook` }], {});

    await executeRule(rule([{ type: "update_task", set: { status: "done" } }]), context, engine);

    expect(received.map((r) => r.url)).toEqual(["/task-hook"]);
  });

  it("stops chaining at the maximum depth", async () => {
    await addRule("task.status_changed", [{ type: "update_task", set: { status: "todo" } }], {});
    await addRule("task.status_changed", [{ type: "update_task", set: { status: "done" } }], {});

    const results = await fireRulesForTrigger("task.status_changed", context, engine);

    expect(results).toHaveLength(2);
    expect(await fireRulesForTrigger("task.status_changed", context, engine, 4)).toEqual([]);
  });

  it("reports invalid or unavailable update_equipment actions", async () => {
    const valid: RuleAction = { type: "update_equipment", set: { status: "received" } };

    expect(
      (
        await executeRule(
          rule([{ type: "update_equipment", set: { status: "bogus" } }]),
          context,
          engine,
        )
      ).errors,
    ).toEqual(["update_equipment: update_equipment requires set.status"]);

    expect((await executeRule(rule([valid]), { case: context.case }, engine)).errors).toEqual([
      "update_equipment: update_equipment requires equipment in context",
    ]);

    const same = {
      equipment: { id: equipmentId, tag: "t", item: "i", status: "received", caseId },
    };

    expect((await executeRule(rule([valid]), same, engine)).errors).toEqual([]);
    expect(await equipmentStatus()).toBe("transit");

    const gone = { equipment: { ...same.equipment, id: missingId, status: "transit" } };

    expect((await executeRule(rule([valid]), gone, engine)).errors).toEqual([
      "update_equipment: equipment not found",
    ]);
  });

  it("sends a slack message through a webhook url with a rendered template", async () => {
    const result = await executeRule(
      rule([
        {
          type: "slack",
          webhookUrl: `${serverUrl}/slack-hook`,
          message: "{{tag}} de {{case}} ({{task}}) -> {{status}} {{equipment.caseId}} {{unknown}}",
        },
      ]),
      context,
      engine,
    );

    expect(result.errors).toEqual([]);
    expect(JSON.parse(received[0].body)).toEqual({
      text: `${context.equipment?.tag} de ${context.case?.name} (Devolver notebook) -> transit ${caseId} {{unknown}}`,
    });
  });

  it("renders status from the task when there is no equipment", async () => {
    await executeRule(
      rule([{ type: "slack", webhookUrl: `${serverUrl}/slack-hook`, message: "{{status}}" }]),
      { task: context.task },
      engine,
    );

    expect(JSON.parse(received[0].body)).toEqual({ text: "todo" });
  });

  it("sends a slack message through the bot token", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-env";

    const result = await executeRule(
      rule([{ type: "slack", channel: "#rh", message: "ok" }]),
      context,
      engine,
    );

    expect(result.errors).toEqual([]);
    expect(received[0].url).toBe("/chat.postMessage");
    expect(received[0].body).toContain("channel=%23rh");

    await executeRule(
      rule([{ type: "slack", botToken: "xoxb-inline", channel: "#rh", message: "ok" }]),
      context,
      engine,
    );

    expect(received).toHaveLength(2);
  });

  it("reports slack misconfiguration and failures", async () => {
    const errors = async (action: RuleAction) =>
      (await executeRule(rule([action]), context, engine)).errors;

    expect(await errors({ type: "slack" })).toEqual(["slack: slack requires message"]);
    expect(await errors({ type: "slack", message: "x" })).toEqual([
      "slack: slack requires webhookUrl or botToken and channel",
    ]);
    expect(await errors({ type: "slack", message: "x", channel: "#rh" })).toEqual([
      "slack: slack requires webhookUrl or botToken and channel",
    ]);
    expect(await errors({ type: "slack", message: "x", webhookUrl: `${serverUrl}/fail` })).toEqual([
      "slack: HTTP 500",
    ]);

    process.env.SLACK_API_URL = "http://127.0.0.1:1/";

    expect(
      (await errors({ type: "slack", message: "x", botToken: "t", channel: "#rh" }))[0],
    ).toContain("slack: ");
  });

  it("sends an email and reports failures", async () => {
    process.env.RESEND_API_KEY = "re_test";

    const ok = await executeRule(
      rule([{ type: "email", to: "rh@example.com", subject: "{{tag}}", body: "<p>{{case}}</p>" }]),
      context,
      engine,
    );

    expect(ok.errors).toEqual([]);
    expect(JSON.parse(received[0].body)).toMatchObject({
      to: "rh@example.com",
      subject: context.equipment?.tag,
      html: `<p>${context.case?.name}</p>`,
    });

    const defaults = await executeRule(
      rule([{ type: "email", to: "rh@example.com" }]),
      context,
      engine,
    );

    expect(defaults.errors).toEqual([]);
    expect(JSON.parse(received[1].body)).toMatchObject({ subject: "Offboard", html: "" });

    expect(
      (await executeRule(rule([{ type: "email", to: "fail@example.com" }]), context, engine))
        .errors,
    ).toEqual(["email: Invalid recipient"]);

    expect((await executeRule(rule([{ type: "email" }]), context, engine)).errors).toEqual([
      "email: email requires to",
    ]);

    delete process.env.RESEND_API_KEY;

    expect(
      (await executeRule(rule([{ type: "email", to: "rh@example.com" }]), context, engine)).errors,
    ).toEqual(["email: RESEND_API_KEY not configured"]);
  });

  it("calls a webhook with the context", async () => {
    const result = await executeRule(
      rule([
        { type: "webhook", url: `${serverUrl}/hook`, method: "PUT" },
        { type: "webhook", url: `${serverUrl}/fail` },
        { type: "webhook" },
      ]),
      context,
      engine,
    );

    expect(result.errors).toEqual(["webhook: HTTP 500", "webhook: webhook requires url"]);
    expect(received[0]).toMatchObject({ method: "PUT", url: "/hook" });
    expect(JSON.parse(received[0].body)).toEqual(context);
  });

  it("runs the correios check when available", async () => {
    const action: RuleAction = { type: "correios_check" };

    expect((await executeRule(rule([action]), context, engine)).errors).toEqual([]);
    expect(correiosChecks).toBe(1);

    expect((await executeRule(rule([action]), context, bare)).errors).toEqual([
      "correios_check: correios_check is not available",
    ]);
  });

  it("reports unknown action types and keeps running the remaining actions", async () => {
    const unknown: RuleAction = JSON.parse('{"type":"nope"}');

    const result = await executeRule(
      rule([unknown, { type: "webhook", url: `${serverUrl}/hook` }]),
      context,
      engine,
    );

    expect(result.errors).toEqual(["nope: unknown action type nope"]);
    expect(received).toHaveLength(1);
  });

  it("captures errors thrown by actions and conditions", async () => {
    const action = await executeRule(
      rule([{ type: "update_task", set: { status: "done" } }]),
      context,
      { ...engine, offboardings: broken.offboardings },
    );

    expect(action.errors).toHaveLength(1);
    expect(action.errors[0]).toContain("update_task: ");

    const condition = await executeRule(rule([], { "case.allEquipmentReceived": true }), context, {
      ...engine,
      equipment: broken.equipment,
    });

    expect(condition.matched).toBe(false);
    expect(condition.errors).toHaveLength(1);
  });

  it("fires every enabled rule for a trigger", async () => {
    const first = await addRule(
      "correios.delivered",
      [{ type: "webhook", url: `${serverUrl}/a` }],
      {},
    );

    const second = await addRule(
      "correios.delivered",
      [{ type: "webhook", url: `${serverUrl}/b` }],
      { "task.id": "other" },
    );

    const results = await fireRulesForTrigger("correios.delivered", context, engine);

    expect(results).toEqual([
      { ruleId: first.id, matched: true, errors: [] },
      { ruleId: second.id, matched: false, errors: [] },
    ]);
  });

  it("returns no results when rules cannot be loaded", async () => {
    expect(
      await fireRulesForTrigger("correios.delivered", context, {
        ...engine,
        automationRules: broken.automationRules,
      }),
    ).toEqual([]);
  });
});
