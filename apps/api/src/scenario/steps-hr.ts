import { z } from "zod";
import { correiosIntegration } from "../features/integrations/routes.js";
import { expectStatus, parseBody, type Context } from "./context.js";
import { waitForHit, type Receiver } from "./receiver.js";
import { listPlans, type Admin, type Person } from "./steps.js";

const assignments = z.array(
  z.object({
    id: z.string(),
    profileName: z.string(),
    assignedPlanName: z.string(),
    source: z.string(),
  }),
);

async function readAssignments(ctx: Context, admin: Admin) {
  return parseBody(
    expectStatus(
      await ctx.http("GET", "/benefit-assignments", { cookie: admin.session.cookie }),
      "Listing benefit assignments",
      200,
    ),
    "Benefit assignments",
    assignments,
  );
}

export async function overrideBenefit(ctx: Context, admin: Admin, name: string, planSlug: string) {
  const plan = (await listPlans(ctx, admin)).find((item) => item.slug === planSlug);
  const current = (await readAssignments(ctx, admin)).find((item) => item.profileName === name);

  if (!plan) throw new Error(`Plan ${planSlug} is not in the catalog`);

  if (!current) throw new Error(`${name} has no benefit to override`);

  expectStatus(
    await ctx.http("PUT", `/benefit-assignments/${current.id}`, {
      cookie: admin.session.cookie,
      body: { planId: plan.id },
    }),
    `Overriding the benefit of ${name}`,
    200,
  );

  ctx.log(`${name} benefit overridden manually to ${planSlug}`);

  return current.id;
}

export async function expectManualBenefit(ctx: Context, admin: Admin, name: string) {
  const current = (await readAssignments(ctx, admin)).find((item) => item.profileName === name);

  if (current?.source !== "manual") {
    throw new Error(`${name} lost the manual benefit (source ${current?.source ?? "none"})`);
  }

  ctx.log(
    `${name} still has the manual ${current.assignedPlanName} benefit after the policy ran again`,
  );
}

const equipmentList = z.array(
  z.object({ id: z.string(), tag: z.string(), person: z.string().nullable(), status: z.string() }),
);

export const inventoryItems = [
  { item: "Notebook Dell Latitude 5440", tag: "SCN-1001", returnMethod: "pickup" },
  { item: "Monitor Dell 27 polegadas", tag: "SCN-1002", returnMethod: "in_person" },
  { item: "Headset Jabra Evolve2", tag: "SCN-1003", returnMethod: "pickup" },
] as const;

export async function manageEquipment(ctx: Context, admin: Admin, person: Person) {
  const cookie = admin.session.cookie;

  const read = async () =>
    parseBody(
      expectStatus(await ctx.http("GET", "/equipment", { cookie }), "Listing equipment", 200),
      "Equipment",
      equipmentList,
    );

  for (const entry of inventoryItems) {
    const created = expectStatus(
      await ctx.http("POST", "/equipment", { cookie, body: { ...entry, caseId: person.caseId } }),
      `Adding ${entry.tag}`,
      201,
      409,
    );

    ctx.log(
      `${created.status === 201 ? "added" : "kept"} ${entry.item} (${entry.tag}) for ${person.name}`,
    );
  }

  const items = (await read()).filter((item) =>
    inventoryItems.some((entry) => entry.tag === item.tag),
  );

  const steps = [
    { tag: "SCN-1001", status: "received" },
    { tag: "SCN-1002", status: "transit" },
    { tag: "SCN-1003", status: "inventory" },
  ];

  for (const step of steps) {
    const found = items.find((item) => item.tag === step.tag);

    if (!found) throw new Error(`${step.tag} was not listed after creating it`);

    expectStatus(
      await ctx.http("PUT", `/equipment/${found.id}`, { cookie, body: { status: step.status } }),
      `Moving ${step.tag} to ${step.status}`,
      200,
    );
  }

  ctx.log(
    `${person.name}: SCN-1001 marked returned, SCN-1002 in transit, SCN-1003 back in inventory`,
  );
}

const integrationList = z.array(z.object({ name: z.string(), status: z.string() }));

export const integrationPlan = [
  { name: "E-mail", status: "connected" },
  { name: "Sistema de folha", status: "connected" },
  { name: "Sistema de ponto", status: "reconnect" },
  { name: "Google Workspace", status: "connected" },
  { name: "HubSpot", status: "connected" },
  { name: correiosIntegration, status: "connected" },
  { name: "Clínica ocupacional", status: "connected" },
  { name: "Operadora do plano de saúde", status: "disconnected" },
] as const;

export async function connectIntegrations(ctx: Context, admin: Admin) {
  const cookie = admin.session.cookie;

  for (const entry of integrationPlan) {
    expectStatus(
      await ctx.http("PUT", `/integrations/${encodeURIComponent(entry.name)}`, {
        cookie,
        body: { status: entry.status },
      }),
      `Setting ${entry.name}`,
      200,
    );
  }

  const listed = parseBody(
    expectStatus(await ctx.http("GET", "/integrations", { cookie }), "Listing integrations", 200),
    "Integrations",
    integrationList,
  );

  const connected = listed.filter((item) => item.status === "connected").length;

  ctx.log(`${integrationPlan.length} integrations configured, ${connected} connected`);
  ctx.log(
    "skipped: Slack needs a real bot token because the API verifies it with Slack before saving",
  );
}

const ruleRows = z.array(z.object({ id: z.string(), name: z.string() }));

export const actionSteps = [
  { stepId: "point", phase: "d0", title: "Fechar ponto e banco de horas" },
  { stepId: "access", phase: "d0", title: "Bloquear acessos" },
] as const;

const caseTasks = z.object({
  tasks: z.array(z.object({ id: z.string(), title: z.string(), status: z.string() })),
});

export async function configureActions(
  ctx: Context,
  admin: Admin,
  person: Person,
  receiver: Receiver,
  waitMs = 5000,
) {
  const cookie = admin.session.cookie;

  const existing = parseBody(
    expectStatus(await ctx.http("GET", "/automation-rules", { cookie }), "Listing rules", 200),
    "Rules",
    ruleRows,
  );

  const ids: string[] = [];

  for (const { stepId } of actionSteps) {
    const name = `webhook:${stepId}`;
    const actions = [{ type: "webhook", url: receiver.url, method: "POST" }];
    const found = existing.find((item) => item.name === name);

    const reply = found
      ? await ctx.http("PUT", `/automation-rules/${found.id}`, {
          cookie,
          body: { enabled: true, actions },
        })
      : await ctx.http("POST", "/automation-rules", {
          cookie,
          body: {
            name,
            trigger: "task.status_changed",
            conditions: { "task.stepId": stepId },
            actions,
          },
        });

    ids.push(
      parseBody(
        expectStatus(reply, `Configuring ${name}`, 200, 201),
        "Rule",
        z.object({ id: z.string() }),
      ).id,
    );
  }

  ctx.log(`${actionSteps.length} webhook rules point at the local receiver ${receiver.url}`);

  const detail = parseBody(
    expectStatus(
      await ctx.http("GET", `/offboardings/${person.caseId}`, { cookie }),
      "Reading the offboarding",
      200,
    ),
    "Offboarding",
    caseTasks,
  );

  const task = detail.tasks.find((item) => item.title === actionSteps[0].title);

  if (!task) throw new Error(`${person.name} has no task "${actionSteps[0].title}"`);

  expectStatus(
    await ctx.http("PATCH", `/tasks/${task.id}/status`, { cookie, body: { status: "done" } }),
    "Completing a task",
    200,
  );

  const hit = await waitForHit(receiver, task.id, waitMs);

  if (!hit) throw new Error(`The webhook action did not fire for "${task.title}"`);

  ctx.log(
    `completing "${task.title}" fired the webhook (phase ${hit.phase}, status ${hit.status})`,
  );

  for (const id of ids) {
    expectStatus(
      await ctx.http("PUT", `/automation-rules/${id}`, { cookie, body: { enabled: false } }),
      "Disabling a rule",
      200,
    );
  }

  ctx.log("rules left disabled because the local receiver stops with this run");
}
