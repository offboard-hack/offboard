import {
  ruleActionTypes,
  ruleTriggers,
  type RuleAction,
  type RuleTrigger,
} from "@offboard/db/schema";
import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import { hasBearer } from "../../shared/machine-auth.js";
import type { RuleResult } from "./engine.js";
import type { AutomationRulesRepository } from "./repository.js";

const trigger = t.Unsafe<RuleTrigger>(t.Union(ruleTriggers.map((value) => t.Literal(value))));

const action = t.Unsafe<RuleAction>(
  t.Object(
    { type: t.Union(ruleActionTypes.map((value) => t.Literal(value))) },
    { additionalProperties: true },
  ),
);

const conditions = t.Record(t.String(), t.String());

const name = t.String({ minLength: 1, maxLength: 255 });

const cronSchedule = t.Nullable(t.String({ maxLength: 50 }));

const ruleRow = t.Object({
  id: t.String(),
  name: t.String(),
  trigger,
  conditions,
  actions: t.Array(action),
  enabled: t.Boolean(),
  cronSchedule: t.Nullable(t.String()),
  sourceRef: t.Nullable(t.String()),
});

const ruleId = t.Object({ id: t.String({ format: "uuid" }) });

const ruleResult = t.Object({
  ruleId: t.String(),
  matched: t.Boolean(),
  errors: t.Array(t.String()),
});

export function automationRulesRoutes(
  repos: AutomationRulesRepository,
  access: PortalAccessPlugin,
  runScheduled: () => Promise<RuleResult[]>,
  cronSecret: string | undefined,
) {
  return new Elysia()
    .use(access)
    .macro({
      machine: (_caller: "cron") => ({
        beforeHandle({ request, status }) {
          if (!hasBearer(request, cronSecret)) return status(401, { error: "Unauthorized" });
        },
      }),
    })
    .get("/automation-rules", ({ principal }) => repos.listRules(principal.orgId), {
      permit: ["read", "Integrations"],
      response: t.Array(ruleRow),
    })
    .post(
      "/automation-rules",
      async ({ body, principal, set }) => {
        const created = await repos.createRule(principal.orgId, body);
        set.status = 201;

        return created;
      },
      {
        permit: ["manage", "Integrations"],
        body: t.Object({
          name,
          trigger,
          conditions: t.Optional(conditions),
          actions: t.Array(action),
          enabled: t.Optional(t.Boolean()),
          cronSchedule: t.Optional(cronSchedule),
        }),
        response: { 201: ruleRow },
      },
    )
    .post("/automation-rules/run-scheduled", () => runScheduled(), {
      machine: "cron",
      response: t.Array(ruleResult),
    })
    .get(
      "/automation-rules/:id",
      async ({ params, principal, status }) =>
        (await repos.getRule(principal.orgId, params.id)) ??
        status(404, { error: "Rule not found" }),
      {
        permit: ["read", "Integrations"],
        params: ruleId,
        response: { 200: ruleRow, 404: errorResponse },
      },
    )
    .put(
      "/automation-rules/:id",
      async ({ params, body, principal, status }) =>
        (await repos.updateRule(principal.orgId, params.id, body)) ??
        status(404, { error: "Rule not found" }),
      {
        permit: ["manage", "Integrations"],
        params: ruleId,
        body: t.Object({
          name: t.Optional(name),
          trigger: t.Optional(trigger),
          conditions: t.Optional(conditions),
          actions: t.Optional(t.Array(action)),
          enabled: t.Optional(t.Boolean()),
          cronSchedule: t.Optional(cronSchedule),
        }),
        response: { 200: ruleRow, 404: errorResponse },
      },
    )
    .delete(
      "/automation-rules/:id",
      async ({ params, principal, status }) =>
        (await repos.deleteRule(principal.orgId, params.id))
          ? new Response(null, { status: 204 })
          : status(404, { error: "Rule not found" }),
      {
        permit: ["manage", "Integrations"],
        params: ruleId,
        response: { 204: t.Void(), 404: errorResponse },
      },
    );
}
