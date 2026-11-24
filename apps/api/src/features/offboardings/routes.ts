import { Elysia, t } from "elysia";
import { z } from "zod";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import { hasBearer } from "../../shared/machine-auth.js";
import type { DispatchAction } from "../../shared/action-dispatch.js";
import { trackPackage } from "./correios.js";
import type { OffboardingsRepository } from "./repository.js";

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

const text = t.String({ minLength: 1 });

const CORREIOS_DEFAULT_URL = "https://proxyapp.correios.com.br";

export type TrackedEquipment = {
  getEquipmentWithTracking(): Promise<
    { id: string; trackingCode: string; taskId: string | null }[]
  >;
  markReceived(id: string): Promise<void>;
};

const correiosCheckResponse = t.Object({
  checked: t.Number(),
  delivered: t.Array(t.String()),
  deliveredEquipment: t.Array(t.String()),
});

export function offboardingsRoutes(
  repos: OffboardingsRepository,
  trackedEquipment: TrackedEquipment,
  access: PortalAccessPlugin,
  dispatchAction: DispatchAction,
  cronSecret: string | undefined,
  webhookSecret: string | undefined,
  correiosBaseUrl = CORREIOS_DEFAULT_URL,
) {
  async function completeTask(taskId: string) {
    const updated = await repos.updateTaskStatus(taskId, "done");

    if (!updated) return false;

    const phase = await repos.getTaskPhase(taskId);

    if (phase) {
      await dispatchAction({ taskId, taskTitle: updated.title, status: "done", phase });
    }

    return true;
  }

  async function checkTrackedShipments() {
    const [tracked, equipmentTracked] = await Promise.all([
      repos.getTrackedTasks(),
      trackedEquipment.getEquipmentWithTracking(),
    ]);

    const delivered: string[] = [];
    const deliveredEquipment: string[] = [];

    const taskResults = await Promise.allSettled(
      tracked.map(async (task) => {
        // WARNING: getTrackedTasks guarantees non-null trackingCode
        const result = await trackPackage(task.trackingCode as string, correiosBaseUrl);

        if (!result.delivered) return;

        if (await completeTask(task.id)) delivered.push(task.id);
      }),
    );

    const equipmentResults = await Promise.allSettled(
      equipmentTracked.map(async (item) => {
        const result = await trackPackage(item.trackingCode, correiosBaseUrl);

        if (!result.delivered) return;

        await trackedEquipment.markReceived(item.id);

        deliveredEquipment.push(item.id);

        if (!item.taskId || delivered.includes(item.taskId)) return;

        if (await completeTask(item.taskId)) delivered.push(item.taskId);
      }),
    );

    return {
      checked: taskResults.length + equipmentResults.length,
      delivered,
      deliveredEquipment,
    };
  }

  return new Elysia()
    .use(access)
    .macro({
      machine: (caller: "cron" | "webhook") => ({
        beforeHandle({ request, status }) {
          const secret = caller === "cron" ? cronSecret : webhookSecret;

          if (!hasBearer(request, secret)) return status(401, { error: "Unauthorized" });
        },
      }),
    })
    .get("/offboardings", () => repos.listOffboardings(), {
      permit: ["read", "Offboarding"],
      response: t.Array(caseSummary),
    })
    .get("/offboardings/with-tasks", () => repos.listOffboardingsWithTasks(), {
      permit: ["read", "Offboarding"],
      response: t.Array(offboardingCase),
    })
    .post(
      "/offboardings",
      async ({ body, set }) => {
        set.status = 201;

        return repos.createOffboarding(body);
      },
      {
        permit: ["create", "Offboarding"],
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
        permit: ["create", "Offboarding"],
        body: t.Object({
          rows: t.Array(t.Object({ name: text, department: text })),
        }),
        response: { 201: t.Array(caseSummary) },
      },
    )
    .get(
      "/offboardings/:id",
      async ({ params, status }) => {
        if (!z.guid().safeParse(params.id).success)
          return status(404, { error: "Offboarding not found" });

        const found = await repos.getOffboarding(params.id);

        return found ?? status(404, { error: "Offboarding not found" });
      },
      {
        permit: ["read", "Offboarding"],
        response: { 200: offboardingCase, 404: errorResponse },
      },
    )
    .patch(
      "/tasks/:id/status",
      async ({ params, body, status }) => {
        const updated = await repos.updateTaskStatus(params.id, body.status);

        if (!updated) return status(404, { error: "Task not found" });

        const phase = await repos.getTaskPhase(params.id);

        if (phase) {
          dispatchAction({
            taskId: params.id,
            taskTitle: updated.title,
            status: body.status,
            phase,
          }).catch(() => {});
        }

        return updated;
      },
      {
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ status: taskStatus }),
        response: { 200: task, 404: errorResponse },
      },
    )
    .patch(
      "/subtasks/:id/toggle",
      async ({ params, status }) => {
        const toggled = await repos.toggleSubtask(params.id);

        return toggled ?? status(404, { error: "Subtask not found" });
      },
      {
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: subtaskRow, 404: errorResponse },
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
          dispatchAction({
            taskId: params.taskId,
            taskTitle: updated.title,
            status: "done",
            phase,
          }).catch(() => {});
        }

        return { accepted: true };
      },
      {
        machine: "webhook",
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          event: t.String(),
          payload: t.Optional(t.Any()),
        }),
        response: {
          200: t.Object({ accepted: t.Boolean(), reason: t.Optional(t.String()) }),
          404: errorResponse,
        },
      },
    )
    .get("/correios/check", () => checkTrackedShipments(), {
      machine: "cron",
      response: correiosCheckResponse,
    })
    .post("/correios/check", () => checkTrackedShipments(), {
      machine: "cron",
      response: correiosCheckResponse,
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
        permit: ["read", "Offboarding"],
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
          404: errorResponse,
        },
      },
    );
}
