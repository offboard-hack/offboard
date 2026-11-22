import { cors } from "@elysia/cors";
import { node } from "@elysia/node";
import type { createRepositories } from "@offboard/db/repositories";
import { Elysia, t } from "elysia";
import { z } from "zod";
import { fireActions } from "./actions.js";
import { trackPackage } from "./correios.js";

export type Repositories = ReturnType<typeof createRepositories>;

const caseSummary = t.Object({
  id: t.String(),
  name: t.String(),
  role: t.String(),
  department: t.String(),
  deadline: t.String(),
  completed: t.Number(),
  total: t.Number(),
});

const taskStatus = t.Union([t.Literal("done"), t.Literal("in_progress"), t.Literal("todo")]);

const subtaskRow = t.Object({
  id: t.String(),
  title: t.String(),
  done: t.Boolean(),
});

const task = t.Object({
  id: t.String(),
  title: t.String(),
  team: t.String(),
  status: taskStatus,
  description: t.Union([t.String(), t.Null()]),
  dueDate: t.Union([t.String(), t.Null()]),
  trackingCode: t.Union([t.String(), t.Null()]),
  subtasks: t.Array(subtaskRow),
});

const offboardingCase = t.Composite([caseSummary, t.Object({ tasks: t.Array(task) })]);

const connectionStatus = t.Union([
  t.Literal("connected"),
  t.Literal("disconnected"),
  t.Literal("reconnect"),
]);

const integrationRow = t.Object({ name: t.String(), status: connectionStatus });

const actionPhase = t.Union([
  t.Literal("pre"),
  t.Literal("d0"),
  t.Literal("first-week"),
  t.Literal("second-week"),
  t.Literal("follow-up"),
]);

const actionConfigValues = t.Record(t.String(), t.Any());

const actionConfigRow = t.Object({
  id: t.String(),
  actionId: t.String(),
  enabled: t.Boolean(),
  config: actionConfigValues,
  phase: t.String(),
});

const notFound = t.Object({ error: t.String() });

const text = t.String({ minLength: 1 });

const uniqueViolation = z.object({ cause: z.object({ code: z.literal("23505") }) });

const CORREIOS_DEFAULT_URL = "https://proxyapp.correios.com.br";

export function createApp(
  webOrigin: string,
  repos: Repositories,
  correiosBaseUrl = CORREIOS_DEFAULT_URL,
) {
  async function checkTrackedShipments() {
    const tracked = await repos.getTrackedTasks();
    const delivered: string[] = [];

    const results = await Promise.allSettled(
      tracked.map(async (task) => {
        // WARNING: getTrackedTasks guarantees non-null trackingCode
        const result = await trackPackage(task.trackingCode as string, correiosBaseUrl);

        if (!result.delivered) return;

        const updated = await repos.updateTaskStatus(task.id, "done");

        if (!updated) return;

        delivered.push(task.id);

        if (task.phase) {
          await fireActions(repos, {
            taskId: task.id,
            taskTitle: task.title,
            status: "done",
            phase: task.phase,
          });
        }
      }),
    );

    return { checked: results.length, delivered };
  }

  return new Elysia({ adapter: node(), prefix: "/api" })
    .use(cors({ origin: webOrigin, credentials: false }))
    .get("/health", () => ({ status: "ok" }) satisfies { status: "ok" }, {
      response: t.Object({ status: t.Literal("ok") }),
    })
    .get("/offboardings", () => repos.listOffboardings(), {
      response: t.Array(caseSummary),
    })
    .post(
      "/offboardings",
      async ({ body, set }) => {
        set.status = 201;

        return repos.createOffboarding(body);
      },
      {
        body: t.Object({
          name: text,
          role: text,
          department: text,
          deadline: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
        }),
        response: { 201: caseSummary },
      },
    )
    .post(
      "/offboardings/import",
      async ({ body, set }) => {
        set.status = 201;

        return repos.bulkCreateOffboardings(body.rows);
      },
      {
        body: t.Object({
          rows: t.Array(t.Object({ name: text, department: text })),
        }),
        response: { 201: t.Array(caseSummary) },
      },
    )
    .get(
      "/offboardings/:id",
      async ({ params, status }) => {
        const found = await repos.getOffboarding(params.id);

        return found ?? status(404, { error: "Offboarding not found" });
      },
      {
        response: { 200: offboardingCase, 404: notFound },
      },
    )
    .patch(
      "/tasks/:id/status",
      async ({ params, body, status }) => {
        const updated = await repos.updateTaskStatus(params.id, body.status);

        if (!updated) return status(404, { error: "Task not found" });

        const phase = await repos.getTaskPhase(params.id);

        if (phase) {
          fireActions(repos, {
            taskId: params.id,
            taskTitle: updated.title,
            status: body.status,
            phase,
          }).catch(() => {});
        }

        return updated;
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ status: taskStatus }),
        response: { 200: task, 404: notFound },
      },
    )
    .patch(
      "/subtasks/:id/toggle",
      async ({ params, status }) => {
        const toggled = await repos.toggleSubtask(params.id);

        return toggled ?? status(404, { error: "Subtask not found" });
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: subtaskRow, 404: notFound },
      },
    )
    .get("/integrations", () => repos.listIntegrations(), {
      response: t.Array(integrationRow),
    })
    .put(
      "/integrations/:name",
      async ({ params, body }) => repos.upsertIntegration(params.name, body.status),
      {
        params: t.Object({ name: t.String() }),
        body: t.Object({ status: connectionStatus }),
        response: integrationRow,
      },
    )
    .get("/action-configs", () => repos.listActionConfigs(), {
      response: t.Array(actionConfigRow),
    })
    .post(
      "/action-configs",
      async ({ body, set, status }) => {
        try {
          const created = await repos.createActionConfig(body);
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
        body: t.Object({
          actionId: t.String({ minLength: 1, maxLength: 100 }),
          phase: actionPhase,
          enabled: t.Optional(t.Boolean()),
          config: t.Optional(actionConfigValues),
        }),
        response: { 201: actionConfigRow, 409: notFound },
      },
    )
    .put(
      "/action-configs/:id",
      async ({ params, body, status }) => {
        const updated = await repos.updateActionConfig(params.id, body);

        return updated ?? status(404, { error: "Action config not found" });
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({
          phase: t.Optional(actionPhase),
          enabled: t.Optional(t.Boolean()),
          config: t.Optional(actionConfigValues),
        }),
        response: { 200: actionConfigRow, 404: notFound },
      },
    )
    .delete(
      "/action-configs/:id",
      async ({ params, status }) => {
        const removed = await repos.deleteActionConfig(params.id);

        return removed
          ? new Response(null, { status: 204 })
          : status(404, { error: "Action config not found" });
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: notFound },
      },
    )
    .post(
      "/integrations/slack/events",
      ({ body }) => {
        if (body.type === "url_verification" && body.challenge) {
          return { challenge: body.challenge };
        }

        console.log("slack event:", body.type);

        return { ok: true } satisfies { ok: true };
      },
      {
        body: t.Object({
          type: t.String(),
          challenge: t.Optional(t.String()),
          event: t.Optional(t.Any()),
          token: t.Optional(t.String()),
          team_id: t.Optional(t.String()),
          api_app_id: t.Optional(t.String()),
          event_id: t.Optional(t.String()),
          event_time: t.Optional(t.Number()),
        }),
        response: {
          200: t.Union([t.Object({ challenge: t.String() }), t.Object({ ok: t.Literal(true) })]),
        },
      },
    )
    .post(
      "/webhooks/inbound/:taskId",
      async ({ params, body, status }) => {
        if (body.event !== "delivered" && body.event !== "completed") {
          return { accepted: false, reason: "event ignored" };
        }

        const updated = await repos.updateTaskStatus(params.taskId, "done");

        if (!updated) return status(404, { error: "Task not found" });

        const phase = await repos.getTaskPhase(params.taskId);

        if (phase) {
          fireActions(repos, {
            taskId: params.taskId,
            taskTitle: updated.title,
            status: "done",
            phase,
          }).catch(() => {});
        }

        return { accepted: true };
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          event: t.String(),
          payload: t.Optional(t.Any()),
        }),
        response: {
          200: t.Object({ accepted: t.Boolean(), reason: t.Optional(t.String()) }),
          404: notFound,
        },
      },
    )
    .get("/correios/check", () => checkTrackedShipments(), {
      response: t.Object({
        checked: t.Number(),
        delivered: t.Array(t.String()),
      }),
    })
    .post("/correios/check", () => checkTrackedShipments(), {
      response: t.Object({
        checked: t.Number(),
        delivered: t.Array(t.String()),
      }),
    })
    .get(
      "/tasks/:id/tracking",
      async ({ params, status }) => {
        const row = await repos.getTaskTrackingCode(params.id);

        if (!row) return status(404, { error: "Task not found" });

        if (!row.trackingCode) {
          return { trackingCode: null, tracking: null };
        }

        const tracking = await trackPackage(row.trackingCode, correiosBaseUrl);

        return { trackingCode: row.trackingCode, tracking };
      },
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: {
          200: t.Object({
            trackingCode: t.Union([t.String(), t.Null()]),
            tracking: t.Union([
              t.Object({
                delivered: t.Boolean(),
                lastEvent: t.String(),
                lastUpdate: t.String(),
              }),
              t.Null(),
            ]),
          }),
          404: notFound,
        },
      },
    );
}

export type App = ReturnType<typeof createApp>;
