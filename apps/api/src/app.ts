import { cors } from "@elysia/cors";
import { node } from "@elysia/node";
import type { createRepositories } from "@offboard/db/repositories";
import { Elysia, t } from "elysia";

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
  subtasks: t.Array(subtaskRow),
});

const offboardingCase = t.Composite([caseSummary, t.Object({ tasks: t.Array(task) })]);

const connectionStatus = t.Union([
  t.Literal("connected"),
  t.Literal("disconnected"),
  t.Literal("reconnect"),
]);

const integrationRow = t.Object({ name: t.String(), status: connectionStatus });

const notFound = t.Object({ error: t.String() });

const text = t.String({ minLength: 1 });

export function createApp(webOrigin: string, repos: Repositories) {
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

        return updated ?? status(404, { error: "Task not found" });
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
    );
}

export type App = ReturnType<typeof createApp>;
