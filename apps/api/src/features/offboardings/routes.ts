import { Elysia, t } from "elysia";
import { z } from "zod";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse, uniqueViolation } from "../../shared/http.js";
import { hasBearer } from "../../shared/machine-auth.js";
import type { ChecklistLayout } from "../../shared/checklist.js";
import type { DispatchAction } from "../../shared/action-dispatch.js";
import type { InviteEmployee } from "../../shared/employee-invite.js";
import type { FireRules } from "../../shared/rule-dispatch.js";
import { trackPackage, type TrackingConfig } from "./correios.js";
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

export function offboardingsRoutes(
  repos: OffboardingsRepository,
  access: PortalAccessPlugin,
  dispatchAction: DispatchAction,
  readChecklist: (orgId: string) => Promise<{ steps: ChecklistLayout }>,
  cronSecret: string | undefined,
  webhookSecret: string | undefined,
  inviteEmployee: InviteEmployee,
  trackingEnabled: (orgId: string) => Promise<boolean>,
  fireRules: FireRules,
  tracking?: TrackingConfig,
) {
  async function checkTrackedShipments() {
    const tracked = await repos.getTrackedTasks();
    const delivered: string[] = [];

    const results = await Promise.allSettled(
      tracked.map(async (task) => {
        if (!tracking || !(await trackingEnabled(task.orgId))) return;

        // WARNING: getTrackedTasks guarantees non-null trackingCode
        const result = await trackPackage(task.trackingCode as string, tracking);

        if (!result.delivered) return;

        const updated = await repos.updateTaskStatus(task.orgId, task.id, "done");

        if (!updated) return;

        delivered.push(task.id);

        if (task.stepId === "collect") {
          await repos.markEquipmentReturned(task.orgId, task.caseId);
        }

        if (task.phase) {
          await dispatchAction(
            {
              orgId: task.orgId,
              taskId: task.id,
              taskTitle: task.title,
              status: "done",
              phase: task.phase,
            },
            task.stepId,
          );
        }

        await fireRules("correios.delivered", {
          orgId: task.orgId,
          task: {
            id: task.id,
            title: task.title,
            status: "done",
            phase: task.phase ?? undefined,
            stepId: task.stepId ?? undefined,
          },
          case: { id: task.caseId, name: task.caseName },
        });
      }),
    );

    return { checked: results.length, delivered };
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
    .get("/offboardings", ({ principal }) => repos.listOffboardings(principal.orgId), {
      permit: ["read", "Offboarding"],
      response: t.Array(caseSummary),
    })
    .get(
      "/offboardings/with-tasks",
      ({ principal }) => repos.listOffboardingsWithTasks(principal.orgId),
      {
        permit: ["read", "Offboarding"],
        response: t.Array(offboardingCase),
      },
    )
    .post(
      "/offboardings",
      async ({ body: { invite, ...body }, principal, set, status }) => {
        try {
          const created = await repos.createOffboarding(
            principal.orgId,
            body,
            (await readChecklist(principal.orgId)).steps,
          );

          if (invite) await inviteEmployee(principal.orgId, created.id);

          set.status = 201;

          return created;
        } catch (error) {
          if (uniqueViolation.safeParse(error).success) {
            return status(409, { error: "Email already in use" });
          }

          throw error;
        }
      },
      {
        permit: ["create", "Offboarding"],
        body: t.Object({
          name: text,
          role: text,
          department: text,
          deadline: t.String({ format: "date" }),
          email: t.String({ format: "email" }),
          personalEmail: t.Optional(t.String({ format: "email" })),
          invite: t.Optional(t.Boolean()),
        }),
        response: { 201: caseSummary, 409: errorResponse },
      },
    )
    .post(
      "/offboardings/import",
      async ({ body, principal, set }) => {
        set.status = 201;

        return repos.bulkCreateOffboardings(
          principal.orgId,
          body.rows,
          (await readChecklist(principal.orgId)).steps,
        );
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
      async ({ params, principal, status }) => {
        if (!z.guid().safeParse(params.id).success)
          return status(404, { error: "Offboarding not found" });

        const found = await repos.getOffboarding(principal.orgId, params.id);

        return found ?? status(404, { error: "Offboarding not found" });
      },
      {
        permit: ["read", "Offboarding"],
        response: { 200: offboardingCase, 404: errorResponse },
      },
    )
    .post(
      "/offboardings/:id/checklist",
      async ({ params, principal, status }) => {
        const result = await repos.applyChecklist(
          principal.orgId,
          params.id,
          (await readChecklist(principal.orgId)).steps,
        );

        if (!result) return status(404, { error: "Offboarding not found" });

        if (result === "has-tasks") return status(409, { error: "Checklist already exists" });

        return result;
      },
      {
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
      },
    )
    .patch(
      "/tasks/:id/status",
      async ({ params, body, principal, status }) => {
        const { orgId } = principal;
        const updated = await repos.updateTaskStatus(orgId, params.id, body.status);

        if (!updated) return status(404, { error: "Task not found" });

        const action = await repos.getTaskAction(orgId, params.id);

        if (action?.phase) {
          dispatchAction(
            {
              orgId,
              taskId: params.id,
              taskTitle: updated.title,
              status: body.status,
              phase: action.phase,
            },
            action.stepId,
          ).catch(() => {});
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
      async ({ params, principal, status }) => {
        const toggled = await repos.toggleSubtask(principal.orgId, params.id);

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

        const orgId = await repos.getTaskOrgId(params.taskId);

        if (!orgId) return status(404, { error: "Task not found" });

        const updated = await repos.updateTaskStatus(orgId, params.taskId, "done");

        if (!updated) return status(404, { error: "Task not found" });

        const action = await repos.getTaskAction(orgId, params.taskId);

        if (action?.phase) {
          dispatchAction(
            {
              orgId,
              taskId: params.taskId,
              taskTitle: updated.title,
              status: "done",
              phase: action.phase,
            },
            action.stepId,
          ).catch(() => {});
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
      response: t.Object({
        checked: t.Number(),
        delivered: t.Array(t.String()),
      }),
    })
    .post("/correios/check", () => checkTrackedShipments(), {
      machine: "cron",
      response: t.Object({
        checked: t.Number(),
        delivered: t.Array(t.String()),
      }),
    })
    .get(
      "/tasks/:id/tracking",
      async ({ params, principal, status }) => {
        const row = await repos.getTaskTrackingCode(principal.orgId, params.id);

        if (!row) return status(404, { error: "Task not found" });

        if (!row.trackingCode) {
          return { trackingCode: null, tracking: null };
        }

        if (!tracking || !(await trackingEnabled(principal.orgId))) {
          return { trackingCode: row.trackingCode, tracking: null };
        }

        const result = await trackPackage(row.trackingCode, tracking);

        return { trackingCode: row.trackingCode, tracking: result };
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
