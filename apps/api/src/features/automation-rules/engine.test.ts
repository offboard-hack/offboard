import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import type { RuleAction, RuleTrigger } from "@offboard/db/schema";
import {
  automationRules,
  defaultOrgId,
  equipment,
  offboardingCases,
  organizations,
  tasks,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import {
  executeRule,
  fireRulesForTrigger,
  matchesConditions,
  MAX_CHAIN_DEPTH,
  renderTemplate,
  runScheduledRules,
  type EngineRepos,
  type Rule,
  type RuleContext,
} from "./engine.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

type Received = { method: string; url: string; body: string };

const otherOrgId = "00000000-0000-0000-0000-0000000000a2";
const missingId = "00000000-0000-4000-8000-000000000000";

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

  const received: Received[] = [];
  let serverUrl = "";
  let correiosChecks: string[] = [];
  let tokenOrgs: string[] = [];
  let emailOn = true;

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

      if (req.url === "/slack-error/chat.postMessage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "channel_not_found" }));

        return;
      }

      res.writeHead(200);
      res.end("ok");
    });
  });

  const engine = {
    automationRules: {
      getEnabledRulesByTrigger: (orgId, trigger) =>
        db
          .select()
          .from(automationRules)
          .where(
            and(
              eq(automationRules.orgId, orgId),
              eq(automationRules.trigger, trigger),
              eq(automationRules.enabled, true),
            ),
          ),
      getAllCronRules: () =>
        db
          .select()
          .from(automationRules)
          .where(
            and(eq(automationRules.trigger, "schedule.cron"), eq(automationRules.enabled, true)),
          ),
    },
    offboardings: repos.offboardings,
    equipment: {
      updateEquipmentStatus: repos.equipment.updateEquipmentStatus,
      areAllCaseEquipmentReceived: async (orgId, caseId) => {
        const rows = await db
          .select({ status: equipment.status })
          .from(equipment)
          .where(and(eq(equipment.orgId, orgId), eq(equipment.caseId, caseId)));

        return rows.length > 0 && rows.every((row) => row.status === "received");
      },
    },
    runCorreiosCheck: async (orgId) => {
      correiosChecks.push(orgId);
    },
    slack: {
      apiUrl: "",
      readToken: async (orgId) => {
        tokenOrgs.push(orgId);

        return undefined;
      },
    },
    emailEnabled: async () => emailOn,
  } satisfies EngineRepos;

  const bare: EngineRepos = { ...engine, runCorreiosCheck: undefined };

  let context: RuleContext = { orgId: defaultOrgId };
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

  async function addRule(
    trigger: RuleTrigger,
    actions: RuleAction[],
    conditions: Record<string, string> = {},
    orgId = defaultOrgId,
    enabled = true,
  ) {
    const [row] = await db
      .insert(automationRules)
      .values({
        orgId,
        name: `${trigger}-${actions.length}`,
        trigger,
        conditions,
        actions,
        enabled,
      })
      .returning();

    return row;
  }

  async function withEmailEnv(run: () => Promise<void>) {
    process.env.RESEND_API_KEY = "re_test_fake";
    process.env.RESEND_BASE_URL = serverUrl;

    try {
      await run();
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_BASE_URL;
    }
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
        engine.slack.apiUrl = `${serverUrl}/`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    server.close();
    await db.delete(automationRules);
    await db.delete(organizations).where(eq(organizations.id, otherOrgId));
    await db.$client.end();
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
    await db.delete(automationRules);
    await db
      .insert(organizations)
      .values({ id: otherOrgId, name: "Other", slug: "other-org" })
      .onConflictDoNothing();

    received.length = 0;
    correiosChecks = [];
    tokenOrgs = [];
    emailOn = true;
    engine.slack.apiUrl = `${serverUrl}/`;

    const [task] = await db.select().from(tasks).limit(1);
    const [item] = await db.select().from(equipment).limit(1);
    const [kase] = await db.select().from(offboardingCases).limit(1);

    taskId = task.id;
    equipmentId = item.id;
    caseId = kase.id;

    await db.update(tasks).set({ status: "todo" }).where(eq(tasks.id, taskId));
    await db.update(equipment).set({ status: "transit" }).where(eq(equipment.id, equipmentId));

    context = {
      orgId: defaultOrgId,
      task: { id: taskId, title: "Bloquear acessos", status: "todo", phase: "d0" },
      equipment: { id: equipmentId, tag: "NB-1", item: "Notebook", status: "transit" },
      case: { id: caseId, name: "Marina Lopes" },
    };
  });

  it("fires matching rules for a trigger", async () => {
    const created = await addRule("correios.delivered", [
      { type: "webhook", url: `${serverUrl}/hook` },
    ]);

    const results = await fireRulesForTrigger("correios.delivered", context, engine);

    expect(results).toEqual([{ ruleId: created.id, matched: true, errors: [] }]);
    expect(received.some((r) => r.url === "/hook")).toBe(true);
  });

  it("only fires rules of the context org", async () => {
    await addRule(
      "correios.delivered",
      [{ type: "webhook", url: `${serverUrl}/other` }],
      {},
      otherOrgId,
    );

    const results = await fireRulesForTrigger("correios.delivered", context, engine);

    expect(results).toEqual([]);
    expect(received).toEqual([]);
  });

  it("skips disabled rules", async () => {
    await addRule(
      "correios.delivered",
      [{ type: "webhook", url: `${serverUrl}/hook` }],
      {},
      defaultOrgId,
      false,
    );

    expect(await fireRulesForTrigger("correios.delivered", context, engine)).toEqual([]);
    expect(received).toEqual([]);
  });

  it("evaluates conditions — matches", async () => {
    const created = await addRule(
      "equipment.status_changed",
      [{ type: "webhook", url: `${serverUrl}/cond` }],
      { "equipment.status": "transit" },
    );

    const results = await fireRulesForTrigger("equipment.status_changed", context, engine);

    expect(results).toEqual([{ ruleId: created.id, matched: true, errors: [] }]);
    expect(received.some((r) => r.url === "/cond")).toBe(true);
  });

  it("evaluates conditions — rejects", async () => {
    const created = await addRule(
      "equipment.status_changed",
      [{ type: "webhook", url: `${serverUrl}/cond` }],
      { "equipment.status": "received" },
    );

    const results = await fireRulesForTrigger("equipment.status_changed", context, engine);

    expect(results).toEqual([{ ruleId: created.id, matched: false, errors: [] }]);
    expect(received).toEqual([]);
  });

  it("evaluates case.allEquipmentReceived against the case equipment", async () => {
    const conditions = { "case.allEquipmentReceived": "true" };

    expect(await matchesConditions(conditions, context, engine)).toBe(false);

    await db.update(equipment).set({ status: "received" }).where(eq(equipment.caseId, caseId));

    expect(await matchesConditions(conditions, context, engine)).toBe(true);
    expect(await matchesConditions(conditions, { orgId: defaultOrgId }, engine)).toBe(false);
  });

  it("reports a failure while evaluating conditions", async () => {
    const failing: EngineRepos = {
      ...engine,
      equipment: {
        ...engine.equipment,
        areAllCaseEquipmentReceived: async () => {
          throw new Error("db down");
        },
      },
    };

    const result = await executeRule(
      rule([{ type: "webhook", url: `${serverUrl}/x` }], { "case.allEquipmentReceived": "true" }),
      context,
      failing,
    );

    expect(result).toEqual({ ruleId: "rule-1", matched: false, errors: ["Error: db down"] });
  });

  it("renders templates with groups and aliases", () => {
    expect(
      renderTemplate(
        "{{task.title}}|{{ task }}|{{tag}}|{{item}}|{{status}}|{{case}}|{{case.name}}|{{equipment.tag}}|{{task.stepId}}|{{nope}}",
        context,
      ),
    ).toBe(
      "Bloquear acessos|Bloquear acessos|NB-1|Notebook|transit|Marina Lopes|Marina Lopes|NB-1|{{task.stepId}}|{{nope}}",
    );

    expect(renderTemplate("{{status}}", { orgId: defaultOrgId, task: context.task })).toBe("todo");
  });

  it("renders templates in Slack message", async () => {
    await addRule("task.status_changed", [
      {
        type: "slack",
        webhookUrl: `${serverUrl}/slack`,
        message: "{{task.title}} em {{task.phase}}",
      },
    ]);

    const results = await fireRulesForTrigger("task.status_changed", context, engine);

    expect(results[0].errors).toEqual([]);
    expect(JSON.parse(received.find((r) => r.url === "/slack")!.body)).toEqual({
      text: "Bloquear acessos em d0",
    });
  });

  it("chains update_task to task.status_changed rules", async () => {
    await addRule("correios.delivered", [{ type: "update_task", set: { status: "done" } }]);
    await addRule("task.status_changed", [{ type: "webhook", url: `${serverUrl}/chained` }], {
      "task.status": "done",
      "task.previousStatus": "todo",
    });

    const results = await fireRulesForTrigger("correios.delivered", context, engine);

    expect(results[0].errors).toEqual([]);
    expect(await taskStatus()).toBe("done");
    expect(received.some((r) => r.url === "/chained")).toBe(true);
  });

  it("chains update_equipment to equipment.status_changed rules", async () => {
    await addRule("correios.delivered", [
      { type: "update_equipment", set: { status: "received" } },
    ]);
    await addRule("equipment.status_changed", [{ type: "webhook", url: `${serverUrl}/eq` }], {
      "equipment.status": "received",
      "equipment.previousStatus": "transit",
    });

    await fireRulesForTrigger("correios.delivered", context, engine);

    expect(await equipmentStatus()).toBe("received");
    expect(received.some((r) => r.url === "/eq")).toBe(true);
  });

  it("stops chaining at MAX_CHAIN_DEPTH", async () => {
    expect(MAX_CHAIN_DEPTH).toBe(3);

    const hook = `${serverUrl}/depth`;

    await addRule(
      "task.status_changed",
      [
        { type: "webhook", url: hook },
        { type: "update_task", set: { status: "in_progress" } },
      ],
      { "task.status": "todo" },
    );
    await addRule(
      "task.status_changed",
      [
        { type: "webhook", url: hook },
        { type: "update_task", set: { status: "done" } },
      ],
      { "task.status": "in_progress" },
    );
    await addRule(
      "task.status_changed",
      [
        { type: "webhook", url: hook },
        { type: "update_task", set: { status: "todo" } },
      ],
      { "task.status": "done" },
    );

    const results = await fireRulesForTrigger("task.status_changed", context, engine);

    expect(received.filter((r) => r.url === "/depth")).toHaveLength(3);
    expect(results.filter((r) => r.matched)).toHaveLength(1);
    expect(await taskStatus()).toBe("todo");
    expect(await fireRulesForTrigger("task.status_changed", context, engine, 3)).toEqual([]);
  });

  it("runs scheduled rules across multiple orgs", async () => {
    await addRule("schedule.cron", [{ type: "correios_check" }], {}, defaultOrgId);
    await addRule("schedule.cron", [{ type: "correios_check" }], {}, otherOrgId);
    await addRule("schedule.cron", [{ type: "correios_check" }], {}, otherOrgId, false);
    await addRule("correios.delivered", [{ type: "correios_check" }], {}, otherOrgId);

    const results = await runScheduledRules(engine);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.matched && r.errors.length === 0)).toBe(true);
    expect(correiosChecks.sort()).toEqual([defaultOrgId, otherOrgId].sort());
  });

  it("handles Slack webhook action", async () => {
    const results = await executeRule(
      rule([{ type: "slack", webhookUrl: `${serverUrl}/slack`, message: "oi" }]),
      context,
      engine,
    );

    expect(results.errors).toEqual([]);
    expect(JSON.parse(received.find((r) => r.url === "/slack")!.body)).toEqual({ text: "oi" });
  });

  it("reports Slack webhook HTTP failure", async () => {
    const result = await executeRule(
      rule([{ type: "slack", webhookUrl: `${serverUrl}/fail`, message: "oi" }]),
      context,
      engine,
    );

    expect(result.errors).toEqual(["slack: HTTP 500"]);
  });

  it("handles Slack bot action", async () => {
    const result = await executeRule(
      rule([{ type: "slack", botToken: "xoxb-1", channel: "#rh", message: "{{task.title}}" }]),
      context,
      engine,
    );

    expect(result.errors).toEqual([]);

    const params = new URLSearchParams(received.find((r) => r.url === "/chat.postMessage")!.body);

    expect(params.get("channel")).toBe("#rh");
    expect(params.get("text")).toBe("Bloquear acessos");
    expect(tokenOrgs).toEqual([]);
  });

  it("uses the organization's Slack token when the action has none", async () => {
    const withToken: EngineRepos = {
      ...engine,
      slack: {
        apiUrl: engine.slack.apiUrl,
        readToken: async (orgId) => {
          tokenOrgs.push(orgId);

          return "xoxb-org";
        },
      },
    };

    const result = await executeRule(
      rule([{ type: "slack", channel: "#ops", message: "oi" }]),
      context,
      withToken,
    );

    expect(result.errors).toEqual([]);
    expect(tokenOrgs).toEqual([defaultOrgId]);
  });

  it("reports Slack bot API errors", async () => {
    const result = await executeRule(
      rule([{ type: "slack", botToken: "xoxb-1", channel: "#x", message: "oi" }]),
      context,
      { ...engine, slack: { ...engine.slack, apiUrl: `${serverUrl}/slack-error/` } },
    );

    expect(result.errors).toEqual(["slack: channel_not_found"]);
  });

  it("reports Slack misconfiguration", async () => {
    expect((await executeRule(rule([{ type: "slack" }]), context, engine)).errors).toEqual([
      "slack: slack requires message",
    ]);

    expect(
      (await executeRule(rule([{ type: "slack", message: "oi" }]), context, engine)).errors,
    ).toEqual(["slack: slack requires webhookUrl or botToken and channel"]);

    expect(
      (await executeRule(rule([{ type: "slack", botToken: "t", message: "oi" }]), context, engine))
        .errors,
    ).toEqual(["slack: slack requires webhookUrl or botToken and channel"]);
  });

  it("handles email action", async () => {
    await withEmailEnv(async () => {
      const result = await executeRule(
        rule([
          {
            type: "email",
            to: "dev@example.com",
            subject: "{{tag}} devolvido",
            body: "<p>{{case.name}}</p>",
          },
        ]),
        context,
        engine,
      );

      expect(result.errors).toEqual([]);

      const parsed = JSON.parse(received.find((r) => r.url === "/emails")!.body);

      expect(parsed.from).toBe("Offboard <onboarding@resend.dev>");
      expect(parsed.to).toBe("dev@example.com");
      expect(parsed.subject).toBe("NB-1 devolvido");
      expect(parsed.html).toBe("<p>Marina Lopes</p>");
    });
  });

  it("uses default email subject and body", async () => {
    await withEmailEnv(async () => {
      await executeRule(rule([{ type: "email", to: "dev@example.com" }]), context, engine);

      const parsed = JSON.parse(received.find((r) => r.url === "/emails")!.body);

      expect(parsed.subject).toBe("Offboard");
      expect(parsed.html).toBe("");
    });
  });

  it("reports email failures", async () => {
    await withEmailEnv(async () => {
      expect(
        (await executeRule(rule([{ type: "email", to: "fail@example.com" }]), context, engine))
          .errors,
      ).toEqual(["email: Invalid recipient"]);

      expect((await executeRule(rule([{ type: "email" }]), context, engine)).errors).toEqual([
        "email: email requires to",
      ]);

      emailOn = false;

      expect(
        (await executeRule(rule([{ type: "email", to: "a@example.com" }]), context, engine)).errors,
      ).toEqual(["email: E-mail disabled"]);
    });

    emailOn = true;

    expect(
      (await executeRule(rule([{ type: "email", to: "a@example.com" }]), context, engine)).errors,
    ).toEqual(["email: RESEND_API_KEY not configured"]);
  });

  it("handles webhook action", async () => {
    const result = await executeRule(
      rule([{ type: "webhook", url: `${serverUrl}/hook`, method: "PUT" }]),
      context,
      engine,
    );

    const req = received.find((r) => r.url === "/hook")!;

    expect(result.errors).toEqual([]);
    expect(req.method).toBe("PUT");
    expect(JSON.parse(req.body).task.title).toBe("Bloquear acessos");
    expect(JSON.parse(req.body).orgId).toBeUndefined();
  });

  it("defaults the webhook method and reports failures", async () => {
    await executeRule(rule([{ type: "webhook", url: `${serverUrl}/default` }]), context, engine);

    expect(received.find((r) => r.url === "/default")?.method).toBe("POST");

    expect(
      (await executeRule(rule([{ type: "webhook", url: `${serverUrl}/fail` }]), context, engine))
        .errors,
    ).toEqual(["webhook: HTTP 500"]);

    expect((await executeRule(rule([{ type: "webhook" }]), context, engine)).errors).toEqual([
      "webhook: webhook requires url",
    ]);
  });

  it("catches thrown errors from unreachable hosts", async () => {
    const result = await executeRule(
      rule([{ type: "webhook", url: "http://127.0.0.1:1/unreachable" }]),
      context,
      engine,
    );

    expect(result.matched).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^webhook: /);
  });

  it("handles correios_check action", async () => {
    const result = await executeRule(rule([{ type: "correios_check" }]), context, engine);

    expect(result.errors).toEqual([]);
    expect(correiosChecks).toEqual([defaultOrgId]);

    expect((await executeRule(rule([{ type: "correios_check" }]), context, bare)).errors).toEqual([
      "correios_check: correios_check is not available",
    ]);
  });

  it("validates update_task and update_equipment actions", async () => {
    const noTask = { orgId: defaultOrgId };

    const run = async (actions: RuleAction[], ctx: RuleContext) =>
      (await executeRule(rule(actions), ctx, engine)).errors;

    expect(await run([{ type: "update_task" }], context)).toEqual([
      "update_task: update_task requires set.status",
    ]);
    expect(await run([{ type: "update_task", set: { status: "done" } }], noTask)).toEqual([
      "update_task: update_task requires a task in context",
    ]);
    expect(await run([{ type: "update_task", set: { status: "todo" } }], context)).toEqual([]);
    expect(
      await run([{ type: "update_task", set: { status: "done" } }], {
        ...context,
        task: { ...context.task!, id: missingId },
      }),
    ).toEqual(["update_task: task not found"]);

    expect(await run([{ type: "update_equipment" }], context)).toEqual([
      "update_equipment: update_equipment requires set.status",
    ]);
    expect(await run([{ type: "update_equipment", set: { status: "received" } }], noTask)).toEqual([
      "update_equipment: update_equipment requires equipment in context",
    ]);
    expect(await run([{ type: "update_equipment", set: { status: "transit" } }], context)).toEqual(
      [],
    );
    expect(
      await run([{ type: "update_equipment", set: { status: "received" } }], {
        ...context,
        equipment: { ...context.equipment!, id: missingId },
      }),
    ).toEqual(["update_equipment: equipment not found"]);

    expect(await taskStatus()).toBe("todo");
    expect(await equipmentStatus()).toBe("transit");
  });

  it("does not update rows of another org", async () => {
    const result = await executeRule(
      rule([{ type: "update_task", set: { status: "done" } }]),
      { ...context, orgId: otherOrgId },
      engine,
    );

    expect(result.errors).toEqual(["update_task: task not found"]);
    expect(await taskStatus()).toBe("todo");
  });

  it("returns error for unknown action type", async () => {
    const result = await executeRule(
      { ...rule([]), actions: JSON.parse('[{"type":"explode"}]') },
      context,
      engine,
    );

    expect(result).toEqual({
      ruleId: "rule-1",
      matched: true,
      errors: ["explode: unknown action type explode"],
    });
  });

  it("survives a broken DB on fireRulesForTrigger", async () => {
    const brokenDb = createClient("postgres://offboard@127.0.0.1:1/none");

    try {
      const broken: EngineRepos = {
        ...engine,
        automationRules: {
          ...engine.automationRules,
          getEnabledRulesByTrigger: () => brokenDb.select().from(automationRules),
        },
      };

      expect(await fireRulesForTrigger("task.status_changed", context, broken)).toEqual([]);
    } finally {
      await brokenDb.$client.end().catch(() => undefined);
    }
  });
});
