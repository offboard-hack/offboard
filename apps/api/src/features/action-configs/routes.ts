import type { ConfigValue } from "@offboard/db/schema";
import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { saveChecklistSchema } from "../../shared/checklist.js";
import { errorResponse, uniqueViolation } from "../../shared/http.js";
import type { ActionConfigsRepository } from "./repository.js";

const actionPhase = t.Union([
  t.Literal("pre"),
  t.Literal("d0"),
  t.Literal("first-week"),
  t.Literal("second-week"),
  t.Literal("follow-up"),
]);

const actionConfigValues = t.Record(t.String(), t.Unsafe<ConfigValue>(t.Unknown()));

const actionConfigRow = t.Object({
  id: t.String(),
  actionId: t.String(),
  enabled: t.Boolean(),
  config: actionConfigValues,
  phase: t.String(),
});

export function actionConfigsRoutes(repos: ActionConfigsRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get("/checklist-model", ({ principal }) => repos.readChecklist(principal.orgId), {
      permit: ["manage", "Integrations"],
    })
    .put(
      "/checklist-model",
      async ({ body, principal, status }) =>
        (await repos.saveChecklist(principal.orgId, body)) ??
        status(409, { error: "Checklist changed" }),
      { permit: ["manage", "Integrations"], body: saveChecklistSchema },
    )
    .get("/action-configs", ({ principal }) => repos.listActionConfigs(principal.orgId), {
      permit: ["read", "Integrations"],
      response: t.Array(actionConfigRow),
    })
    .post(
      "/action-configs",
      async ({ body, principal, set, status }) => {
        try {
          const created = await repos.createActionConfig(principal.orgId, body);
          set.status = 201;

          return created;
        } catch (error) {
          if (uniqueViolation.safeParse(error).success) {
            return status(409, { error: "Action config already exists" });
          }

          throw error;
        }
      },
      {
        permit: ["manage", "Integrations"],
        body: t.Object({
          actionId: t.String({ minLength: 1, maxLength: 100 }),
          phase: actionPhase,
          enabled: t.Optional(t.Boolean()),
          config: t.Optional(actionConfigValues),
        }),
        response: { 201: actionConfigRow, 409: errorResponse },
      },
    )
    .put(
      "/action-configs/:id",
      async ({ params, body, principal, status }) => {
        const updated = await repos.updateActionConfig(principal.orgId, params.id, body);

        return updated ?? status(404, { error: "Action config not found" });
      },
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          phase: t.Optional(actionPhase),
          enabled: t.Optional(t.Boolean()),
          config: t.Optional(actionConfigValues),
        }),
        response: { 200: actionConfigRow, 404: errorResponse },
      },
    )
    .delete(
      "/action-configs/:id",
      async ({ params, principal, status }) => {
        const removed = await repos.deleteActionConfig(principal.orgId, params.id);

        return removed
          ? new Response(null, { status: 204 })
          : status(404, { error: "Action config not found" });
      },
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: errorResponse },
      },
    );
}
