import { ruleActionTypes, ruleTriggers, type ConfigValue } from "@offboard/db/schema";
import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { hasBearer } from "../../shared/machine-auth.js";
import { errorResponse } from "../../shared/http.js";
import type { AutomationRulesRepository } from "./repository.js";

const configValues = t.Record(t.String(), t.Unsafe<ConfigValue>(t.Unknown()));

const ruleAction = t.Intersect([
  t.Object({ type: t.UnionEnum([...ruleActionTypes]) }),
  configValues,
]);

const ruleTrigger = t.UnionEnum([...ruleTriggers]);

const cronSchedule = t.Nullable(t.String({ minLength: 1, maxLength: 50 }));

const ruleRow = t.Object({
  id: t.String(),
  name: t.String(),
  trigger: ruleTrigger,
  conditions: configValues,
  actions: t.Array(ruleAction),
  enabled: t.Boolean(),
  cronSchedule,
});

export function automationRulesRoutes(
  repos: AutomationRulesRepository,
  access: PortalAccessPlugin,
  runScheduled: () => Promise<{ ran: number; failed: number }>,
  cronSecret: string | undefined,
) {
  return new Elysia()
    .use(access)
    .get("/automation-rules", () => repos.listRules(), {
      permit: ["manage", "Integrations"],
      response: t.Array(ruleRow),
    })
    .post("/automation-rules/run-scheduled", () => runScheduled(), {
      beforeHandle({ request, status }) {
        if (!hasBearer(request, cronSecret)) return status(401, { error: "Unauthorized" });
      },
      response: {
        200: t.Object({ ran: t.Number(), failed: t.Number() }),
        401: errorResponse,
      },
    })
    .get(
      "/automation-rules/:id",
      async ({ params, status }) => {
        const rule = await repos.getRule(params.id);

        return rule ?? status(404, { error: "Automation rule not found" });
      },
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: ruleRow, 404: errorResponse },
      },
    )
    .post(
      "/automation-rules",
      async ({ body, set }) => {
        const created = await repos.createRule({
          name: body.name,
          trigger: body.trigger,
          conditions: body.conditions ?? {},
          actions: body.actions,
          enabled: body.enabled ?? true,
          cronSchedule: body.cronSchedule ?? null,
        });

        set.status = 201;

        return created;
      },
      {
        permit: ["manage", "Integrations"],
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 255 }),
          trigger: ruleTrigger,
          conditions: t.Optional(configValues),
          actions: t.Array(ruleAction),
          enabled: t.Optional(t.Boolean()),
          cronSchedule: t.Optional(cronSchedule),
        }),
        response: { 201: ruleRow },
      },
    )
    .put(
      "/automation-rules/:id",
      async ({ params, body, status }) => {
        const updated = await repos.updateRule(params.id, body);

        return updated ?? status(404, { error: "Automation rule not found" });
      },
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
          trigger: t.Optional(ruleTrigger),
          conditions: t.Optional(configValues),
          actions: t.Optional(t.Array(ruleAction)),
          enabled: t.Optional(t.Boolean()),
          cronSchedule: t.Optional(cronSchedule),
        }),
        response: { 200: ruleRow, 404: errorResponse },
      },
    )
    .delete(
      "/automation-rules/:id",
      async ({ params, status }) => {
        const removed = await repos.deleteRule(params.id);

        return removed
          ? new Response(null, { status: 204 })
          : status(404, { error: "Automation rule not found" });
      },
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: errorResponse },
      },
    );
}
