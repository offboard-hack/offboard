import { createHmac, timingSafeEqual } from "node:crypto";
import { cors } from "@elysia/cors";
import { node } from "@elysia/node";
import { createPortalAbility } from "@offboard/access";
import type { PortalPermission } from "@offboard/access";
import type { createRepositories } from "@offboard/db/repositories";
import { Elysia, t } from "elysia";
import { z } from "zod";
import { fireActions } from "./actions.js";
import type { PortalAuth } from "./auth.js";
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

const memberRole = t.Union([
  t.Literal("admin"),
  t.Literal("gestor"),
  t.Literal("rh"),
  t.Literal("visualizador"),
]);

const teamMemberRow = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  role: memberRole,
});

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

type AppOptions = {
  auth: PortalAuth;
  correiosBaseUrl?: string;
  cronSecret?: string;
  webhookSecret?: string;
  slackSigningSecret?: string;
};

const slackEvent = z.object({
  type: z.string(),
  challenge: z.string().optional(),
});

function matchesSecret(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;

  const left = Buffer.from(actual);
  const right = Buffer.from(expected);

  return left.length === right.length && timingSafeEqual(left, right);
}

function hasBearer(request: Request, secret: string | undefined) {
  return secret && matchesSecret(request.headers.get("authorization"), `Bearer ${secret}`);
}

function hasSlackSignature(request: Request, body: string, secret: string | undefined) {
  const timestamp = request.headers.get("x-slack-request-timestamp");

  if (!secret || !timestamp || !/^\d+$/.test(timestamp)) return false;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");

  return matchesSecret(request.headers.get("x-slack-signature"), `v0=${digest}`);
}

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const { auth, correiosBaseUrl = CORREIOS_DEFAULT_URL } = options;

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
    .macro({
      permit: (permission: PortalPermission) => ({
        async beforeHandle({ request, set, status }) {
          set.headers["cache-control"] = "no-store";
          const access = await auth.resolvePrincipal(request.headers);

          if (access.kind === "anonymous") return status(401, { error: "Unauthorized" });

          if (access.kind === "forbidden") return status(403, { error: "Forbidden" });

          const ability = createPortalAbility(access.principal.role);
          const isRead = request.method === "GET" || request.method === "HEAD";

          if (
            !ability.can(...permission) ||
            (!isRead && request.headers.get("origin") !== webOrigin)
          ) {
            return status(403, { error: "Forbidden" });
          }
        },
      }),
      machine: (caller: "cron" | "webhook") => ({
        beforeHandle({ request, status }) {
          const secret = caller === "cron" ? options.cronSecret : options.webhookSecret;

          if (!hasBearer(request, secret)) return status(401, { error: "Unauthorized" });
        },
      }),
    })
    .get("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
    .post("/auth/*", ({ request }) => auth.handler(request), { parse: "none" })
    .get(
      "/session",
      async ({ request, set, status }) => {
        set.headers["cache-control"] = "no-store";
        const access = await auth.resolvePrincipal(request.headers);

        if (access.kind === "anonymous") return status(401, { error: "Unauthorized" });

        if (access.kind === "forbidden") return status(403, { error: "Forbidden" });

        return access.principal;
      },
      { response: { 200: teamMemberRow, 401: notFound, 403: notFound } },
    )
    .get("/health", () => ({ status: "ok" }) satisfies { status: "ok" }, {
      response: t.Object({ status: t.Literal("ok") }),
    })
    .get("/offboardings", () => repos.listOffboardings(), {
      permit: ["read", "Offboarding"],
      response: t.Array(caseSummary),
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
        const found = await repos.getOffboarding(params.id);

        return found ?? status(404, { error: "Offboarding not found" });
      },
      {
        permit: ["read", "Offboarding"],
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
        permit: ["update", "Offboarding"],
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
        permit: ["update", "Offboarding"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 200: subtaskRow, 404: notFound },
      },
    )
    .get("/integrations", () => repos.listIntegrations(), {
      permit: ["read", "Integrations"],
      response: t.Array(integrationRow),
    })
    .put(
      "/integrations/:name",
      async ({ params, body }) => repos.upsertIntegration(params.name, body.status),
      {
        permit: ["manage", "Integrations"],
        params: t.Object({ name: t.String() }),
        body: t.Object({ status: connectionStatus }),
        response: integrationRow,
      },
    )
    .get("/action-configs", () => repos.listActionConfigs(), {
      permit: ["read", "Integrations"],
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
        permit: ["manage", "Integrations"],
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
        permit: ["manage", "Integrations"],
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
        permit: ["manage", "Integrations"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: notFound },
      },
    )
    .get("/team", () => repos.listTeamMembers(), {
      permit: ["read", "Team"],
      response: t.Array(teamMemberRow),
    })
    .post(
      "/team",
      async ({ body, set, status }) => {
        try {
          const created = await repos.createTeamMember(body);
          set.status = 201;

          return created;
        } catch (error) {
          if (uniqueViolation.safeParse(error).success) {
            return status(409, { error: "Team member already exists" });
          }

          throw error;
        }
      },
      {
        permit: ["manage", "Team"],
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 255 }),
          email: t.String({ format: "email", maxLength: 255 }),
          role: memberRole,
        }),
        response: { 201: teamMemberRow, 409: notFound },
      },
    )
    .delete(
      "/team/:id",
      async ({ params, status }) => {
        const removed = await repos.deleteTeamMember(params.id);

        return removed
          ? new Response(null, { status: 204 })
          : status(404, { error: "Team member not found" });
      },
      {
        permit: ["manage", "Team"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        response: { 204: t.Void(), 404: notFound },
      },
    )
    .post(
      "/integrations/slack/events",
      async ({ request, status }) => {
        const body = await request.text();

        if (!hasSlackSignature(request, body, options.slackSigningSecret)) {
          return status(401, { error: "Unauthorized" });
        }

        const parsed = z
          .string()
          .transform((text, context) => {
            try {
              return JSON.parse(text);
            } catch {
              context.addIssue({ code: "custom", message: "Invalid JSON" });

              return z.NEVER;
            }
          })
          .pipe(slackEvent)
          .safeParse(body);

        if (!parsed.success) return status(422, { error: "Invalid Slack event" });

        if (parsed.data.type === "url_verification" && parsed.data.challenge) {
          return { challenge: parsed.data.challenge };
        }

        return { ok: true } satisfies { ok: true };
      },
      {
        parse: "none",
        response: {
          200: t.Union([t.Object({ challenge: t.String() }), t.Object({ ok: t.Literal(true) })]),
          401: notFound,
          422: notFound,
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
        machine: "webhook",
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
          404: notFound,
        },
      },
    );
}

export type App = ReturnType<typeof createApp>;
