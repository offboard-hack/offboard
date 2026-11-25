import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "./repositories.js";
import type { ConfigValue } from "@offboard/db/schema";
import { authSession, employeeAccess, tasks } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import {
  emptyEmployeePlan,
  employeeGrantHeader,
  employeeStateSchema,
  type EmployeeState,
} from "@offboard/employee";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "./app.ts";
import { createAuth, createRuntimeAuth } from "./features/auth/auth.js";
import type { PortalAuth } from "./shared/portal-auth.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const cronSecret = "test-cron-secret";
const webhookSecret = "test-webhook-secret";
const slackSigningSecret = "test-slack-secret";

const auth: PortalAuth = {
  async handler(request) {
    const payload = request.method === "POST" ? await request.text() : null;

    return Response.json({ path: new URL(request.url).pathname, payload });
  },
  resolvePrincipal(headers) {
    const session = headers.get("x-test-session");

    if (session === "anonymous") return Promise.resolve({ kind: "anonymous" });

    if (session === "revoked") return Promise.resolve({ kind: "forbidden" });

    const role =
      session === "rh" || session === "gestor" || session === "visualizador" ? session : "admin";

    return Promise.resolve({
      kind: "authenticated",
      principal: { id: "test-member", name: "Test Member", email: "member@example.com", role },
    });
  },
};

const appOptions = { auth, cronSecret, webhookSecret, slackSigningSecret };

const missingTaskId = "00000000-0000-4000-8000-000000000000";
const missingCaseId = "00000000-0000-4000-8000-000000000001";

type SurveyPayload = {
  caseId: string;
  npsScore: number;
  responses: Record<string, boolean>;
  topics: string[];
};

describe.skipIf(!url)("api", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  let correiosBody = "";
  let correiosStatus = 200;

  const correiosServer = createServer((_req, res) => {
    res.writeHead(correiosStatus, { "content-type": "application/json" });
    res.end(correiosBody);
  });

  let correiosBaseUrl: string;

  const app = createApp(webOrigin, repos, appOptions);

  type Payload = {
    name?: string;
    email?: string;
    role?: string;
    department?: string;
    deadline?: string;
    status?: string;
    rows?: { name: string; department?: string }[];
    actionId?: string;
    enabled?: boolean;
    config?: Record<string, ConfigValue>;
    phase?: string;
    event?: string | { type: string; user?: string };
    payload?: unknown;
    type?: string;
    challenge?: string;
    token?: string;
    team_id?: string;
    api_app_id?: string;
    event_id?: string;
    event_time?: number;
  };

  function call(path: string, method = "GET", body?: Payload) {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const headers = new Headers({ "content-type": "application/json", origin: webOrigin });

    if (path.startsWith("/webhooks/inbound/")) {
      headers.set("authorization", `Bearer ${webhookSecret}`);
    }

    if (path === "/integrations/slack/events") {
      return app.handle(slackRequest(encoded ?? ""));
    }

    return app.handle(
      new Request(`http://localhost/api${path}`, { method, headers, body: encoded }),
    );
  }

  function slackRequest(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    const signature = createHmac("sha256", slackSigningSecret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex");

    return new Request("http://localhost/api/integrations/slack/events", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${signature}`,
      },
    });
  }

  function cronRequest(method = "GET") {
    return new Request("http://localhost/api/correios/check", {
      method,
      headers: { authorization: `Bearer ${cronSecret}` },
    });
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });

    await new Promise<void>((resolve) => {
      correiosServer.listen(0, "127.0.0.1", resolve);
    });

    // WARNING: listen(0) guarantees AddressInfo with a port
    const addr = correiosServer.address() as AddressInfo;
    correiosBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      correiosServer.close(() => resolve());
    });

    await db.$client.end();
  });

  it("reports health", async () => {
    const res = await call("/health");

    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("forwards magic link requests through the API prefix without consuming the body", async () => {
    const verification = await call("/auth/magic-link/verify");
    expect(await verification.json()).toEqual({
      path: "/api/auth/magic-link/verify",
      payload: null,
    });

    const requested = await call("/auth/sign-in/magic-link", "POST", {
      email: "member@example.com",
    });

    expect(await requested.json()).toEqual({
      path: "/api/auth/sign-in/magic-link",
      payload: JSON.stringify({ email: "member@example.com" }),
    });
  });

  it.each([
    ["anonymous", 401],
    ["revoked", 403],
  ])("denies a %s session before reading protected records", async (session, expected) => {
    const headers = { "x-test-session": session };
    const principal = await app.handle(new Request("http://localhost/api/session", { headers }));
    const cases = await app.handle(new Request("http://localhost/api/offboardings", { headers }));

    const bundled = await app.handle(
      new Request("http://localhost/api/offboardings/with-tasks", { headers }),
    );

    expect(bundled.status).toBe(expected);
    expect(bundled.headers.get("cache-control")).toBe("no-store");
    expect(principal.status).toBe(expected);
    expect(cases.status).toBe(expected);
    expect(principal.headers.get("cache-control")).toBe("no-store");
    expect(cases.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["admin", 201, 200],
    ["rh", 201, 403],
    ["gestor", 403, 403],
    ["visualizador", 403, 403],
  ])("enforces the %s permission matrix on the API", async (role, createStatus, teamStatus) => {
    const headers = {
      "x-test-session": role,
      origin: webOrigin,
      "content-type": "application/json",
    };

    const principal = await app.handle(new Request("http://localhost/api/session", { headers }));
    const cases = await app.handle(new Request("http://localhost/api/offboardings", { headers }));
    const team = await app.handle(new Request("http://localhost/api/team", { headers }));

    const created = await app.handle(
      new Request("http://localhost/api/offboardings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Test",
          role: "Analyst",
          department: "RH",
          deadline: "2026-12-01",
          email: `matrix-${role}-${randomUUID()}@offboard.example`,
        }),
      }),
    );

    expect(principal.status).toBe(200);
    expect(await principal.json()).toMatchObject({ role });
    expect(cases.status).toBe(200);
    expect(team.status).toBe(teamStatus);
    expect(created.status).toBe(createStatus);
  });

  it("rejects an otherwise authorized request from another origin", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/team", {
        method: "POST",
        headers: { origin: "https://another.example", "content-type": "application/json" },
        body: JSON.stringify({ name: "Test", email: "test@example.com", role: "rh" }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects missing and incorrect machine credentials", async () => {
    const noSecret = createApp(webOrigin, repos, { auth });
    const cronWithoutConfig = await noSecret.handle(cronRequest());

    const webhookWithoutCredential = await app.handle(
      new Request(`http://localhost/api/webhooks/inbound/${missingTaskId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"event":"delivered"}',
      }),
    );

    const wrongCredential = await app.handle(
      new Request("http://localhost/api/correios/check", {
        headers: { authorization: "Bearer test-cron-wrong!" },
      }),
    );

    expect(cronWithoutConfig.status).toBe(401);
    expect(webhookWithoutCredential.status).toBe(401);
    expect(wrongCredential.status).toBe(401);
  });

  it("rejects an unsigned Slack event and a correctly signed event with an expired timestamp", async () => {
    const request = slackRequest('{"type":"event_callback"}');
    request.headers.delete("x-slack-signature");

    expect((await app.handle(request)).status).toBe(401);
    expect((await app.handle(slackRequest('{"type":"event_callback"}', "1"))).status).toBe(401);

    const noSecret = createApp(webOrigin, repos, { auth });
    expect((await noSecret.handle(slackRequest('{"type":"event_callback"}'))).status).toBe(401);
  });

  it("rejects incorrectly formatted Slack bodies even when the signature is valid", async () => {
    expect((await app.handle(slackRequest("{"))).status).toBe(422);
    expect((await app.handle(slackRequest("{}"))).status).toBe(422);
  });

  it("lists offboardings", async () => {
    const res = await call("/offboardings");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      role: expect.any(String),
      department: expect.any(String),
      deadline: expect.any(String),
      completed: expect.any(Number),
      total: expect.any(Number),
    });
  });

  it("lists offboardings with their tasks for an authorized session", async () => {
    const res = await call("/offboardings/with-tasks");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list).toContainEqual(
      expect.objectContaining({
        name: "Marina Lopes",
        tasks: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
      }),
    );
  });

  it("returns not found for a malformed offboarding id", async () => {
    const res = await call("/offboardings/not-a-uuid");

    expect(res.status).toBe(404);
  });

  it("gets an offboarding with its tasks", async () => {
    const list = await (await call("/offboardings")).json();
    const first = list[0];
    const res = await call(`/offboardings/${first.id}`);
    const found = await res.json();

    expect(res.status).toBe(200);
    expect(found.id).toBe(first.id);
    expect(found.tasks.length).toBe(found.total);
  });

  it("returns task details with description, dueDate and subtasks", async () => {
    const list = await (await call("/offboardings")).json();
    const marina = list.find((c: { name: string }) => c.name === "Marina Lopes");
    const res = await call(`/offboardings/${marina.id}`);
    const found = await res.json();

    const calcular = found.tasks.find((t: { title: string }) => t.title === "Calcular a rescisão");
    expect(calcular.dueDate).toBe("2026-11-13");
    expect(calcular.subtasks).toHaveLength(4);
    expect(calcular.subtasks[0]).toEqual({
      id: expect.any(String),
      title: "Levantar saldo de férias",
      done: true,
    });
  });

  it("returns 404 for an unknown id", async () => {
    const res = await call(`/offboardings/${missingCaseId}`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Offboarding not found" });
  });

  it("creates an offboarding", async () => {
    const email = `ana-${randomUUID()}@offboard.example`;

    const body = {
      name: "Ana Souza",
      role: "Dev",
      department: "Eng",
      deadline: "2026-12-01",
      email,
    };

    const res = await call("/offboardings", "POST", body);
    const created = await res.json();

    expect(res.status).toBe(201);
    expect(created).toEqual({
      id: expect.any(String),
      name: body.name,
      role: body.role,
      department: body.department,
      deadline: body.deadline,
      completed: 0,
      total: 0,
    });
    expect((await call(`/offboardings/${created.id}`)).status).toBe(200);
  });

  it("creates an offboarding with employee email and normalizes case", async () => {
    const body = {
      name: "Lúcia Pires",
      role: "Designer",
      department: "Produto",
      deadline: "2026-12-15",
      email: "Lucia@Offboard.Example",
    };

    const res = await call("/offboardings", "POST", body);
    const created = await res.json();

    expect(res.status).toBe(201);
    expect(created).toEqual({
      id: expect.any(String),
      name: body.name,
      role: body.role,
      department: body.department,
      deadline: body.deadline,
      completed: 0,
      total: 0,
    });

    const [access] = await db
      .select({ email: employeeAccess.email })
      .from(employeeAccess)
      .where(eq(employeeAccess.caseId, created.id));

    expect(access.email).toBe("lucia@offboard.example");
  });

  it("rejects duplicate employee email on offboarding creation without leaving an orphan case", async () => {
    const email = `dup-${randomUUID()}@offboard.example`;
    const before = await (await call("/offboardings")).json();

    await call("/offboardings", "POST", {
      name: "Primeira",
      role: "Dev",
      department: "TI",
      deadline: "2026-12-20",
      email,
    });

    const duplicate = await call("/offboardings", "POST", {
      name: "Segunda",
      role: "Dev",
      department: "TI",
      deadline: "2026-12-20",
      email,
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "Email already in use" });

    const after = await (await call("/offboardings")).json();
    expect(after.length).toBe(before.length + 1);
  });

  it.each([
    { name: "", role: "Dev", department: "Eng", deadline: "2026-12-01" },
    { name: "Ana", role: "Dev", department: "Eng", deadline: "tomorrow" },
    { name: "Ana" },
  ])("rejects an invalid offboarding %j", async (body) => {
    const res = await call("/offboardings", "POST", body);

    expect(res.status).toBe(422);
  });

  it("rethrows unexpected offboarding create errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        offboardings: {
          ...repos.offboardings,
          createOffboarding: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/offboardings", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({
          name: "Test",
          role: "Dev",
          department: "Eng",
          deadline: "2026-12-01",
          email: `rethrow-${randomUUID()}@offboard.example`,
        }),
      }),
    );

    expect(res.status).toBe(500);
  });

  it("imports offboardings in bulk", async () => {
    const rows = [
      { name: "Bia Lima", department: "Ops" },
      { name: "Caio Reis", department: "Ops" },
    ];

    const res = await call("/offboardings/import", "POST", { rows });
    const created = await res.json();

    expect(res.status).toBe(201);
    expect(created.length).toBe(2);
    expect(created[0]).toMatchObject({ name: "Bia Lima", department: "Ops" });
    expect(created[1]).toMatchObject({ name: "Caio Reis", department: "Ops" });
  });

  it("rejects an invalid import", async () => {
    const res = await call("/offboardings/import", "POST", { rows: [{ name: "Bia" }] });

    expect(res.status).toBe(422);
  });

  it("updates a task status", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const target = detail.tasks.find((item: { status: string }) => item.status !== "in_progress");
    const res = await call(`/tasks/${target?.id}/status`, "PATCH", { status: "in_progress" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(target.id);
    expect(body.status).toBe("in_progress");
    expect(body).toHaveProperty("subtasks");
  });

  it("returns 404 for an unknown task", async () => {
    const res = await call(`/tasks/${missingTaskId}/status`, "PATCH", { status: "done" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("rejects an invalid task status or id", async () => {
    const badStatus = await call(`/tasks/${missingTaskId}/status`, "PATCH", { status: "blocked" });
    const badId = await call("/tasks/not-a-uuid/status", "PATCH", { status: "done" });

    expect(badStatus.status).toBe(422);
    expect(badId.status).toBe(422);
  });

  it("toggles a subtask", async () => {
    const list = await (await call("/offboardings")).json();
    const marina = list.find((c: { name: string }) => c.name === "Marina Lopes");
    const detail = await (await call(`/offboardings/${marina.id}`)).json();
    const calcular = detail.tasks.find((t: { title: string }) => t.title === "Calcular a rescisão");
    const sub = calcular.subtasks.find((s: { title: string }) => s.title === "Calcular multa FGTS");

    expect(sub.done).toBe(false);

    const res = await call(`/subtasks/${sub.id}/toggle`, "PATCH");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: sub.id, title: "Calcular multa FGTS", done: true });
  });

  it("returns 404 for an unknown subtask toggle", async () => {
    const res = await call(`/subtasks/${missingTaskId}/toggle`, "PATCH");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Subtask not found" });
  });

  it("rejects an invalid subtask id", async () => {
    const res = await call("/subtasks/not-a-uuid/toggle", "PATCH");

    expect(res.status).toBe(422);
  });

  it("lists integrations from seed", async () => {
    const res = await call("/integrations");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({ name: expect.any(String), status: expect.any(String) });
  });

  it("creates an integration via upsert", async () => {
    const res = await call("/integrations/Test%20System", "PUT", { status: "connected" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Test System", status: "connected" });
  });

  it("updates an existing integration status", async () => {
    await call("/integrations/Test%20Toggle", "PUT", { status: "connected" });
    const res = await call("/integrations/Test%20Toggle", "PUT", { status: "disconnected" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Test Toggle", status: "disconnected" });
  });

  it("lists equipment with the person name", async () => {
    const res = await call("/equipment");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({
      id: expect.any(String),
      item: expect.any(String),
      tag: expect.any(String),
      person: expect.any(String),
      returnMethod: expect.stringMatching(/^(pickup|in_person)$/),
      scheduledDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      status: expect.any(String),
    });
  });

  it("updates an equipment status", async () => {
    const [{ person: _person, ...first }] = await (await call("/equipment")).json();
    const res = await call(`/equipment/${first.id}`, "PUT", { status: "received" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...first, status: "received" });
  });

  it("returns 404 when updating unknown equipment", async () => {
    const res = await call(`/equipment/${missingTaskId}`, "PUT", { status: "received" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Equipment not found" });
  });

  it("lets visualizador read but not update equipment", async () => {
    const headers = { "x-test-session": "visualizador", origin: webOrigin };
    const list = await app.handle(new Request("http://localhost/api/equipment", { headers }));

    const update = await app.handle(
      new Request(`http://localhost/api/equipment/${missingTaskId}`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ status: "received" }),
      }),
    );

    expect(list.status).toBe(200);
    expect(update.status).toBe(403);
  });

  it("rejects an invalid equipment status", async () => {
    const res = await call(`/equipment/${missingTaskId}`, "PUT", { status: "invalid" });

    expect(res.status).toBe(422);
  });

  it("lists exit surveys with case names, newest first", async () => {
    const res = await call("/exit-surveys");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ caseName: "Nina Castro", npsScore: 6 });
  });

  it("aggregates exit surveys", async () => {
    const res = await call("/exit-surveys/aggregates");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      totalResponses: 5,
      averageNps: 6.6,
      nps: -20,
      completionRate: 100,
      activationsByMonth: [
        { label: "Jun", value: 1 },
        { label: "Jul", value: 1 },
        { label: "Ago", value: 1 },
        { label: "Set", value: 1 },
        { label: "Out", value: 1 },
      ],
      topTopics: [
        { label: "Clareza de prazos", value: 3 },
        { label: "Respeito na comunicação", value: 3 },
        { label: "Apoio emocional", value: 2 },
        { label: "Devolução de equipamentos", value: 2 },
        { label: "Acesso a benefícios", value: 1 },
      ],
    });
  });

  it("returns zeroed aggregates without surveys", async () => {
    await db.$client.query("DELETE FROM exit_surveys");
    const res = await call("/exit-surveys/aggregates");

    expect(await res.json()).toEqual({
      totalResponses: 0,
      averageNps: 0,
      nps: 0,
      completionRate: 0,
      activationsByMonth: [],
      topTopics: [],
    });
  });

  it("submits and resubmits a survey for a case", async () => {
    const [first] = await (await call("/offboardings")).json();
    await db.$client.query("DELETE FROM exit_surveys");
    const payload = { caseId: first.id, npsScore: 10, responses: { ok: true }, topics: ["A"] };

    const created = await app.handle(
      new Request("http://localhost/api/exit-surveys", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify(payload),
      }),
    );

    const again = await app.handle(
      new Request("http://localhost/api/exit-surveys", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ ...payload, npsScore: 2 }),
      }),
    );

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ caseId: first.id, npsScore: 10 });
    expect(again.status).toBe(201);
    expect(await (await call("/exit-surveys")).json()).toHaveLength(1);
  });

  it("rejects surveys for unknown cases and out-of-range scores", async () => {
    const post = (body: SurveyPayload) =>
      app.handle(
        new Request("http://localhost/api/exit-surveys", {
          method: "POST",
          headers: { "content-type": "application/json", origin: webOrigin },
          body: JSON.stringify(body),
        }),
      );

    const unknown = await post({ caseId: missingCaseId, npsScore: 5, responses: {}, topics: [] });
    const invalid = await post({ caseId: missingCaseId, npsScore: 11, responses: {}, topics: [] });

    expect(unknown.status).toBe(404);
    expect(invalid.status).toBe(422);
  });

  it("restricts survey reads to admin and rh while any role can submit", async () => {
    const send = (role: string, path: string, method = "GET", body?: SurveyPayload) =>
      app.handle(
        new Request(`http://localhost/api${path}`, {
          method,
          headers: {
            "x-test-session": role,
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );

    expect((await send("rh", "/exit-surveys")).status).toBe(200);
    expect((await send("gestor", "/exit-surveys")).status).toBe(403);
    expect((await send("visualizador", "/exit-surveys/aggregates")).status).toBe(403);

    const submit = await send("visualizador", "/exit-surveys", "POST", {
      caseId: missingCaseId,
      npsScore: 5,
      responses: {},
      topics: [],
    });

    expect(submit.status).toBe(404);
  });

  it("rejects an invalid integration status", async () => {
    const res = await call("/integrations/Whatever", "PUT", { status: "invalid" });

    expect(res.status).toBe(422);
  });

  it("lists action configs from seed", async () => {
    const res = await call("/action-configs");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({
      id: expect.any(String),
      actionId: expect.any(String),
      enabled: expect.any(Boolean),
      config: expect.any(Object),
      phase: expect.any(String),
    });
  });

  it("creates an action config", async () => {
    const res = await call("/action-configs", "POST", {
      actionId: "google::transfer_files",
      phase: "first-week",
      config: { target: "manager" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: expect.any(String),
      actionId: "google::transfer_files",
      enabled: true,
      config: { target: "manager" },
      phase: "first-week",
    });
  });

  it("rejects a duplicate action_id", async () => {
    await call("/action-configs", "POST", { actionId: "dup::test", phase: "d0" });
    const res = await call("/action-configs", "POST", { actionId: "dup::test", phase: "d0" });

    expect(res.status).toBe(409);
  });

  it("updates an action config", async () => {
    const created = await (
      await call("/action-configs", "POST", { actionId: "upd::test", phase: "d0" })
    ).json();

    const res = await call(`/action-configs/${created.id}`, "PUT", {
      enabled: false,
      phase: "pre",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, enabled: false, phase: "pre" });
  });

  it("returns 404 when updating unknown config", async () => {
    const res = await call(`/action-configs/${missingCaseId}`, "PUT", { enabled: false });

    expect(res.status).toBe(404);
  });

  it("deletes an action config", async () => {
    const created = await (
      await call("/action-configs", "POST", { actionId: "del::test", phase: "d0" })
    ).json();

    const res = await call(`/action-configs/${created.id}`, "DELETE");

    expect(res.status).toBe(204);
  });

  it("returns 404 when deleting unknown config", async () => {
    const res = await call(`/action-configs/${missingCaseId}`, "DELETE");

    expect(res.status).toBe(404);
  });

  it("lists seeded team members ordered by name", async () => {
    const res = await call("/team");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: expect.any(String), name: "Beatriz Castro", email: expect.any(String), role: "admin" },
      { id: expect.any(String), name: "Camila Rocha", email: expect.any(String), role: "rh" },
      { id: expect.any(String), name: "Diego Alves", email: expect.any(String), role: "gestor" },
    ]);
  });

  it("creates a team member", async () => {
    const res = await call("/team", "POST", {
      name: "Eva Dias",
      email: "eva.dias@offboard.com",
      role: "visualizador",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: expect.any(String),
      name: "Eva Dias",
      email: "eva.dias@offboard.com",
      role: "visualizador",
    });
  });

  it("rejects a duplicate team member email", async () => {
    const res = await call("/team", "POST", {
      name: "Outra Pessoa",
      email: "camila.rocha@offboard.com",
      role: "rh",
    });

    expect(res.status).toBe(409);
  });

  it("rejects invalid team member payloads", async () => {
    const badEmail = await call("/team", "POST", { name: "A", email: "nope", role: "rh" });
    const badRole = await call("/team", "POST", { name: "A", email: "a@b.com", role: "root" });
    const noName = await call("/team", "POST", { email: "a@b.com", role: "rh" });

    expect(badEmail.status).toBe(422);
    expect(badRole.status).toBe(422);
    expect(noName.status).toBe(422);
  });

  it("deletes a team member", async () => {
    const [first] = await (await call("/team")).json();

    const res = await call(`/team/${first.id}`, "DELETE");

    expect(res.status).toBe(204);
    expect(await (await call("/team")).json()).toHaveLength(2);
  });

  it("updates a team member role", async () => {
    const [first] = await (await call("/team")).json();
    const res = await call(`/team/${first.id}`, "PUT", { role: "visualizador" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...first, role: "visualizador" });
  });

  it("returns 404 when updating unknown team member role", async () => {
    const res = await call(`/team/${missingCaseId}`, "PUT", { role: "rh" });

    expect(res.status).toBe(404);
  });

  it("rejects invalid role on update", async () => {
    const [first] = await (await call("/team")).json();
    const res = await call(`/team/${first.id}`, "PUT", { role: "root" });

    expect(res.status).toBe(422);
  });

  it("prevents changing your own role", async () => {
    const members = await (await call("/team")).json();
    const self = members.find((m: { email: string }) => m.email === "member@example.com");

    if (!self) {
      await call("/team", "POST", {
        name: "Test Member",
        email: "member@example.com",
        role: "admin",
      });
    }

    const updated = await (await call("/team")).json();
    const me = updated.find((m: { email: string }) => m.email === "member@example.com");

    const selfAuth: PortalAuth = {
      handler: auth.handler,
      resolvePrincipal: () =>
        Promise.resolve({
          kind: "authenticated" as const,
          principal: {
            id: me.id,
            name: "Test Member",
            email: "member@example.com",
            role: "admin" as const,
          },
        }),
    };

    const selfApp = createApp(webOrigin, repos, {
      ...appOptions,
      auth: selfAuth,
    });

    const res = await selfApp.handle(
      new Request(`http://localhost/api/team/${me.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ role: "rh" }),
      }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cannot change your own role" });
  });

  it("returns 404 when deleting unknown team member", async () => {
    const res = await call(`/team/${missingCaseId}`, "DELETE");

    expect(res.status).toBe(404);
  });

  it("rejects invalid action config", async () => {
    const noAction = await call("/action-configs", "POST", { phase: "d0" });
    const noPhase = await call("/action-configs", "POST", { actionId: "test::x" });

    expect(noAction.status).toBe(422);
    expect(noPhase.status).toBe(422);
  });

  it("rethrows unexpected create errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        actionConfigs: {
          ...repos.actionConfigs,
          createActionConfig: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/action-configs", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ actionId: "x::y", phase: "d0" }),
      }),
    );

    expect(res.status).toBe(500);
  });

  it("rethrows unexpected team member create errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        team: {
          ...repos.team,
          createTeamMember: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/team", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ name: "A", email: "a@b.com", role: "rh" }),
      }),
    );

    expect(res.status).toBe(500);
  });

  it("responds to slack url_verification challenge", async () => {
    const res = await call("/integrations/slack/events", "POST", {
      type: "url_verification",
      challenge: "test-challenge-abc123",
      token: "test-token",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "test-challenge-abc123" });
  });

  it("returns ok when url_verification lacks challenge", async () => {
    const res = await call("/integrations/slack/events", "POST", {
      type: "url_verification",
      token: "test-token",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts slack event_callback with 200", async () => {
    const res = await call("/integrations/slack/events", "POST", {
      type: "event_callback",
      token: "test-token",
      team_id: "T12345",
      api_app_id: "A12345",
      event: { type: "member_joined_channel", user: "U12345" },
      event_id: "Ev12345",
      event_time: 1234567890,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts a delivered inbound webhook and marks task done", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    const res = await call(`/webhooks/inbound/${todo.id}`, "POST", {
      event: "delivered",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("done");
  });

  it("ignores non-delivered/completed webhook events", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    const res = await call(`/webhooks/inbound/${todo.id}`, "POST", {
      event: "in_transit",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: false, reason: "event ignored" });
  });

  it("returns 404 for inbound webhook on unknown task", async () => {
    const res = await call(`/webhooks/inbound/${missingTaskId}`, "POST", {
      event: "delivered",
    });

    expect(res.status).toBe(404);
  });

  it("fires actions when task status changes to done", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();

    const todo = detail.tasks.find(
      (t: { status: string; title: string }) =>
        t.status === "todo" && t.title === "Enviar desligamento ao eSocial",
    );

    const res = await call(`/tasks/${todo.id}/status`, "PATCH", { status: "done" });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("done");
  });

  it("returns tracking info for a task with tracking code", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "RO",
              tipo: "01",
              descricao: "Objeto em trânsito",
              dtHrCriado: "2026-11-18T16:00:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "AB123456789BR" }).where(eq(tasks.id, task.id));

    const res = await correiosApp.handle(
      new Request(`http://localhost/api/tasks/${task.id}/tracking`),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trackingCode).toBe("AB123456789BR");
    expect(body.tracking).toEqual({
      delivered: false,
      lastEvent: "Objeto em trânsito",
      lastUpdate: "2026-11-18T16:00:00",
    });
  });

  it("returns null tracking for a task without tracking code", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks[0];

    const res = await app.handle(new Request(`http://localhost/api/tasks/${task.id}/tracking`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trackingCode: null, tracking: null });
  });

  it("returns 404 for tracking on unknown task", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/tasks/${missingTaskId}/tracking`),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("checks tracked shipments via GET and marks delivered tasks done", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "01",
              descricao: "Objeto entregue ao destinatário",
              dtHrCriado: "2026-11-20T10:30:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "CD987654321BR" }).where(eq(tasks.id, todo.id));

    const res = await correiosApp.handle(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBeGreaterThanOrEqual(1);
    expect(body.delivered).toContain(todo.id);

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("done");
  });

  it("checks tracked shipments via POST", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({ objetos: [] });

    const res = await correiosApp.handle(cronRequest("POST"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBeGreaterThanOrEqual(0);
    expect(body.delivered).toEqual([]);
  });

  it("does not mark non-delivered tracked tasks as done", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "RO",
              tipo: "01",
              descricao: "Objeto em trânsito",
              dtHrCriado: "2026-11-18T16:00:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "EF111222333BR" }).where(eq(tasks.id, todo.id));

    const res = await correiosApp.handle(cronRequest());

    const body = await res.json();
    expect(body.delivered).toEqual([]);

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("todo");
  });

  it("fires actions for delivered tasks with a phase", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "01",
              descricao: "Objeto entregue",
              dtHrCriado: "2026-11-21T09:00:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();

    const detail = await (await call(`/offboardings/${list[0].id}`)).json();

    const taskWithPhase = detail.tasks.find(
      (t: { status: string; title: string }) =>
        t.status === "todo" && t.title === "Enviar desligamento ao eSocial",
    );

    await db
      .update(tasks)
      .set({ trackingCode: "GH444555666BR" })
      .where(eq(tasks.id, taskWithPhase.id));

    const res = await correiosApp.handle(cronRequest());

    const body = await res.json();
    expect(body.delivered).toContain(taskWithPhase.id);
  });

  it("includes trackingCode in task details", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks[0];

    expect(task).toHaveProperty("trackingCode");
  });

  it("handles task deletion during correios check gracefully", async () => {
    const stubbedApp = createApp(
      webOrigin,
      {
        ...repos,
        offboardings: {
          ...repos.offboardings,
          getTrackedTasks: () =>
            Promise.resolve([
              { id: missingTaskId, title: "Gone", phase: "d0", trackingCode: "ZZ999999999BR" },
            ]),
        },
      },
      { ...appOptions, correiosBaseUrl },
    );

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "01",
              descricao: "Entregue",
              dtHrCriado: "2026-11-21T10:00:00",
            },
          ],
        },
      ],
    });

    const res = await stubbedApp.handle(cronRequest());

    const body = await res.json();
    expect(body.checked).toBe(1);
    expect(body.delivered).toEqual([]);
  });

  it("rethrows unexpected create errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        actionConfigs: {
          ...repos.actionConfigs,
          createActionConfig: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/action-configs", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ actionId: "x::y", phase: "d0" }),
      }),
    );

    expect(res.status).toBe(500);
  });
});

describe.skipIf(!url)("employee journey with PostgreSQL and Better Auth", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const codes = new Map<string, string>();
  const links = new Map<string, string>();
  const grants = new Map<string, string>();
  let requests = 0;

  const employeeAuth = createAuth({
    db,
    origin: webOrigin,
    secret: randomUUID() + randomUUID(),
    ipAddressHeaders: ["x-test-employee-ip"],
    sendLink: async ({ email, url }) => {
      links.set(email, url);
    },
    sendCode: async ({ email, code }) => {
      codes.set(email, code);
    },
  });

  const app = createApp(webOrigin, repos, { auth: employeeAuth });

  type EmployeeSettings = Parameters<typeof repos.employee.saveSettings>[1];

  function request(
    path: string,
    method = "GET",
    cookie?: string,
    body?:
      | { email: string; type: "sign-in" }
      | { email: string; otp: string }
      | { email: string }
      | EmployeeState
      | EmployeeSettings,
    origin = webOrigin,
    nativeOrigin?: string,
    grantId = cookie ? grants.get(cookie) : undefined,
  ) {
    requests += 1;
    const headers = new Headers({ "x-test-employee-ip": `192.0.2.${requests}` });

    if (nativeOrigin) headers.set("expo-origin", nativeOrigin);
    else headers.set("origin", origin);

    if (cookie) headers.set("cookie", cookie);

    if (grantId) headers.set(employeeGrantHeader, grantId);

    if (body) headers.set("content-type", "application/json");

    return app.handle(
      new Request(webOrigin + "/api" + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  }

  async function sendCode(email: string) {
    return request("/auth/email-otp/send-verification-otp", "POST", undefined, {
      email,
      type: "sign-in",
    });
  }

  async function signIn(email: string, code: string, nativeOrigin?: string) {
    return request(
      "/auth/sign-in/email-otp",
      "POST",
      undefined,
      { email, otp: code },
      webOrigin,
      nativeOrigin,
    );
  }

  async function rememberGrant(cookie: string) {
    const session = await request("/employee/session", "GET", cookie);
    expect(session.status).toBe(200);
    const grantId = z.object({ grantId: z.uuid() }).parse(await session.json()).grantId;
    grants.set(cookie, grantId);

    return grantId;
  }

  async function authenticate(email: string) {
    expect((await sendCode(email)).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No code delivered");

    const response = await signIn(email, code);
    expect(response.status).toBe(200);

    const session = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="));

    expect(session).toContain("HttpOnly");

    const cookie = session?.split(";")[0] ?? "";
    await rememberGrant(cookie);

    return cookie;
  }

  beforeAll(() =>
    migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    }),
  );
  afterAll(() => db.$client.end());

  it("does not expose employee access settings through fallback portal authentication", async () => {
    const fallbackApp = createApp(webOrigin, repos, { auth });
    const target = webOrigin + "/api/employee-access/" + missingCaseId;
    expect((await fallbackApp.handle(new Request(target))).status).toBe(503);
    expect(
      (
        await fallbackApp.handle(
          new Request(target, {
            method: "PUT",
            headers: { origin: webOrigin, "content-type": "application/json" },
            body: JSON.stringify({ email: null, plan: emptyEmployeePlan, revision: 0 }),
          }),
        )
      ).status,
    ).toBe(503);
  });

  it("separates employee sessions from HR and shares confirmed, revisioned progress only with the owner", async () => {
    const email = `employee-${randomUUID()}@offboard.example`;
    const secondEmail = `employee-${randomUUID()}@offboard.example`;

    const first = await repos.offboardings.createOffboarding({
      name: "Primeira Pessoa",
      role: "Analista",
      department: "RH",
      deadline: "2027-02-01",
    });

    const second = await repos.offboardings.createOffboarding({
      name: "Segunda Pessoa",
      role: "Analista",
      department: "TI",
      deadline: "2027-02-02",
    });

    const plan = {
      ...emptyEmployeePlan,
      bookingDays: ["2027-01-25"],
      equipment: [{ title: "Notebook", code: "123", model: "" }],
    };

    await repos.team.createTeamMember({ email, name: "RH com o mesmo e-mail", role: "admin" });
    await repos.employee.saveSettings(first.id, { email, plan, revision: 0 });
    await repos.employee.saveSettings(second.id, {
      email: secondEmail,
      plan: emptyEmployeePlan,
      revision: 0,
    });

    const anonymous = await sendCode(`unknown-${randomUUID()}@offboard.example`);
    expect(anonymous.status).toBe(200);
    expect(codes.size).toBe(0);
    expect((await request("/employee/session")).status).toBe(401);
    expect(
      (
        await request(
          "/auth/email-otp/send-verification-otp",
          "POST",
          undefined,
          { email, type: "sign-in" },
          "https://foreign.example",
        )
      ).status,
    ).toBe(403);

    const cookie = await authenticate(email);
    const secondCookie = await authenticate(secondEmail);
    expect((await signIn(email, codes.get(email) ?? "")).status).toBe(400);
    expect((await request("/session", "GET", cookie)).status).toBe(403);
    expect((await request(`/employee-access/${second.id}`, "GET", cookie)).status).toBe(403);
    const journeyBeforeConsent = await request("/employee/journey", "GET", cookie);
    expect(journeyBeforeConsent.status).toBe(200);
    expect(journeyBeforeConsent.headers.get("cache-control")).toBe("private, no-store");
    expect(await journeyBeforeConsent.json()).toMatchObject({ deadline: first.deadline, plan });

    const initialConsent = await request("/employee/state/consent", "GET", cookie);
    expect(await initialConsent.json()).toEqual({
      key: "consent",
      revision: 0,
      value: { accepted: false },
    });
    const careerBeforeConsent = await request("/employee/state/career", "GET", cookie);
    expect(careerBeforeConsent.status).toBe(200);
    expect(await careerBeforeConsent.json()).toMatchObject({
      key: "career",
      revision: 0,
      value: { base: { name: first.name }, versions: [], applications: [] },
    });

    const blockedDeparture: EmployeeState = {
      key: "departure-v1",
      revision: 0,
      value: {
        booking: null,
        handoffCompleted: [],
        examAttended: false,
        feedback: null,
      },
    };

    expect((await request("/employee/state", "PUT", cookie, blockedDeparture)).status).toBe(403);

    const consent = { key: "consent", revision: 0, value: { accepted: true } } as const;
    expect(
      (await request("/employee/state", "PUT", cookie, consent, "https://foreign.example")).status,
    ).toBe(403);
    expect((await request("/employee/state", "PUT", cookie, consent)).status).toBe(200);
    expect((await request("/employee/state", "PUT", secondCookie, consent)).status).toBe(200);
    const firstGrant = grants.get(cookie);
    expect(
      (
        await request(
          "/employee/journey",
          "GET",
          secondCookie,
          undefined,
          webOrigin,
          undefined,
          firstGrant,
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await request(
          "/employee/state",
          "PUT",
          secondCookie,
          blockedDeparture,
          webOrigin,
          undefined,
          firstGrant,
        )
      ).status,
    ).toBe(412);

    const firstJourney = await request("/employee/journey", "GET", cookie);
    expect(firstJourney.headers.get("cache-control")).toBe("private, no-store");
    expect(await firstJourney.json()).toMatchObject({ deadline: first.deadline, plan });
    expect(await (await request("/employee/journey", "GET", secondCookie)).json()).toMatchObject({
      plan: emptyEmployeePlan,
    });

    expect(await (await request("/employee/state/career", "GET", cookie)).json()).toMatchObject({
      key: "career",
      revision: 0,
      value: { base: { name: first.name }, versions: [], applications: [] },
    });

    const current = employeeStateSchema.parse(
      await (await request("/employee/state/departure-v1", "GET", cookie)).json(),
    );

    if (current.key !== "departure-v1") throw new Error("Unexpected journey state kind");

    const booking = {
      method: "pickup",
      day: "2027-01-25",
      slot: "morning",
      address: "Rua Brasileira, 123, São Paulo",
    } as const;

    expect(
      (
        await request("/employee/state", "PUT", cookie, {
          ...current,
          value: {
            ...current.value,
            booking: { method: "office", day: booking.day, slot: booking.slot },
          },
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await request("/employee/state", "PUT", cookie, {
          ...current,
          value: { ...current.value, examAttended: true },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request("/employee/state", "PUT", cookie, {
          ...current,
          value: { ...current.value, handoffCompleted: ["unknown"] },
        })
      ).status,
    ).toBe(422);

    const draft = { ...current, value: { ...current.value, booking } };
    const saved = await request("/employee/state", "PUT", cookie, draft);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ revision: 1, value: { booking } });
    expect((await request("/employee/state", "PUT", cookie, draft)).status).toBe(200);

    const different = {
      ...draft,
      value: { ...draft.value, booking: { ...booking, slot: "afternoon" as const } },
    };

    expect((await request("/employee/state", "PUT", cookie, different)).status).toBe(409);
    expect(
      await (await request("/employee/state/departure-v1", "GET", secondCookie)).json(),
    ).toMatchObject({ revision: 0, value: { booking: null } });

    const next = { ...draft, revision: 1, value: { ...draft.value, booking: null } };
    expect(await (await request("/employee/state", "PUT", cookie, next)).json()).toMatchObject({
      revision: 2,
      value: { booking: null },
    });
    expect((await request("/employee/state", "PUT", cookie, different)).status).toBe(409);

    await repos.employee.saveSettings(first.id, { email: null, plan, revision: 1 });
    expect((await request("/employee/session", "GET", cookie)).status).toBe(401);
    await repos.employee.saveSettings(first.id, { email, plan, revision: 2 });
    expect((await request("/employee/session", "GET", cookie)).status).toBe(401);
    expect((await request("/employee/session", "GET", secondCookie)).status).toBe(200);
  });

  it("lets HR provision a case and accepts only the supported native origins", async () => {
    const email = `native-${randomUUID()}@offboard.example`;
    const admin = `admin-${randomUUID()}@offboard.example`;

    const first = await repos.offboardings.createOffboarding({
      name: "Pessoa no app",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
    });

    const second = await repos.offboardings.createOffboarding({
      name: "Outro caso",
      role: "Analista",
      department: "TI",
      deadline: "2027-02-02",
    });

    await repos.team.createTeamMember({ email: admin, name: "RH", role: "admin" });

    expect(
      (await request("/auth/sign-in/magic-link", "POST", undefined, { email: admin })).status,
    ).toBe(200);
    const link = links.get(admin);

    if (!link) throw new Error("No HR link delivered");

    const verified = await app.handle(new Request(link));

    const hrCookie = verified.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="))
      ?.split(";")[0];

    expect(hrCookie).toBeTruthy();
    expect((await request("/employee/session", "GET", hrCookie)).status).toBe(401);

    const target = `/employee-access/${first.id}`;

    const plan = {
      ...emptyEmployeePlan,
      exam: { day: "2027-01-26", time: "10:00", clinic: "Clínica", address: "Rua da Clínica" },
    };

    expect(await (await request(target, "GET", hrCookie)).json()).toEqual({
      email: null,
      plan: emptyEmployeePlan,
      revision: 0,
    });
    expect((await request(`/employee-access/${missingCaseId}`, "GET", hrCookie)).status).toBe(404);
    expect(
      (
        await request(`/employee-access/${missingCaseId}`, "PUT", hrCookie, {
          email,
          plan,
          revision: 0,
        })
      ).status,
    ).toBe(404);
    expect((await request(target, "PUT", hrCookie, { email, plan, revision: 0 })).status).toBe(200);
    expect(await (await request(target, "GET", hrCookie)).json()).toEqual({
      email,
      plan,
      revision: 1,
    });
    expect((await request(target, "PUT", hrCookie, { email, plan, revision: 0 })).status).toBe(409);
    const firstVersion = { email, plan, revision: 1 };
    expect((await request(target, "PUT", hrCookie, { ...firstVersion, email: null })).status).toBe(
      200,
    );
    const conflict = await request(target, "PUT", hrCookie, firstVersion);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "settings-changed" });
    expect(await (await request(target, "GET", hrCookie)).json()).toMatchObject({
      email: null,
      revision: 2,
    });
    expect((await request(target, "PUT", hrCookie, { ...firstVersion, revision: 2 })).status).toBe(
      200,
    );
    expect(
      (
        await request(`/employee-access/${second.id}`, "PUT", hrCookie, {
          email,
          plan,
          revision: 0,
        })
      ).status,
    ).toBe(409);
    await expect(
      repos.employee.saveSettings("invalid-case-id", { email, plan, revision: 0 }),
    ).rejects.toThrow();

    const otpRequest = { email, type: "sign-in" } as const;

    const requestedFrom = (origin: string) =>
      request(
        "/auth/email-otp/send-verification-otp",
        "POST",
        undefined,
        otpRequest,
        webOrigin,
        origin,
      );

    expect((await requestedFrom("https://foreign.example")).status).toBe(403);
    expect(
      (
        await employeeAuth.handler(
          new Request(webOrigin + "/api/auth/email-otp/send-verification-otp", {
            method: "POST",
            body: JSON.stringify(otpRequest),
            headers: { "content-type": "application/json" },
          }),
        )
      ).status,
    ).toBe(403);
    expect((await requestedFrom("exp://127.0.0.1:8103/--/")).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No native code delivered");

    const response = await signIn(email, code, "offboard://");
    expect(response.status).toBe(200);

    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="))
      ?.split(";")[0];

    expect(cookie).toBeTruthy();
    await rememberGrant(cookie ?? "");
    expect(
      (
        await request(
          "/employee/state",
          "PUT",
          cookie,
          { key: "consent", revision: 0, value: { accepted: true } },
          webOrigin,
          "offboard:///",
        )
      ).status,
    ).toBe(200);

    const initial: EmployeeState = {
      key: "departure-v1",
      revision: 0,
      value: { handoffCompleted: [], examAttended: true, feedback: null, booking: null },
    };

    expect((await request("/employee/state", "PUT", cookie, initial)).status).toBe(200);
    expect(
      (await request("/employee/state", "PUT", cookie, { ...initial, revision: 1 })).status,
    ).toBe(200);

    expect((await request(target, "PUT", hrCookie, { email, plan, revision: 3 })).status).toBe(200);
    expect((await request("/employee/session", "GET", cookie)).status).toBe(200);

    await db.delete(employeeAccess).where(eq(employeeAccess.caseId, first.id));
    expect((await request("/employee/session", "GET", cookie)).status).toBe(401);
    expect(await repos.employee.saveSettings(first.id, { email, plan, revision: 1 })).toBe(
      "changed",
    );
    expect(await repos.employee.saveSettings(missingCaseId, { email, plan, revision: 1 })).toBe(
      "missing-case",
    );
  });

  it("rejects a previously delivered code if the case is revoked before verification", async () => {
    const email = `revoked-new-${randomUUID()}@offboard.example`;

    const first = await repos.offboardings.createOffboarding({
      name: "Pessoa removida",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
    });

    await repos.employee.saveSettings(first.id, { email, plan: emptyEmployeePlan, revision: 0 });
    expect((await sendCode(email)).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No code delivered");

    await repos.employee.saveSettings(first.id, {
      email: null,
      plan: emptyEmployeePlan,
      revision: 1,
    });
    expect((await signIn(email, code)).headers.getSetCookie()).toHaveLength(0);

    await repos.employee.saveSettings(first.id, { email, plan: emptyEmployeePlan, revision: 2 });
    await authenticate(email);
    expect((await sendCode(email)).status).toBe(200);
    const subsequentCode = codes.get(email);

    if (!subsequentCode) throw new Error("No code delivered");

    await repos.employee.saveSettings(first.id, {
      email: null,
      plan: emptyEmployeePlan,
      revision: 3,
    });
    expect((await signIn(email, subsequentCode)).headers.getSetCookie()).toHaveLength(0);
  });

  it("binds a pending code to the grant that issued it", async () => {
    const email = "reassigned-" + randomUUID() + "@offboard.example";

    const person = {
      name: "Pessoa realocada",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
    };

    const first = await repos.offboardings.createOffboarding(person);
    const second = await repos.offboardings.createOffboarding(person);
    const plan = emptyEmployeePlan;

    expect(await repos.employee.saveSettings(first.id, { email, plan, revision: 0 })).toBe("saved");
    expect((await sendCode(email)).status).toBe(200);
    const priorCode = codes.get(email);

    if (!priorCode) throw new Error("No code delivered");

    expect(await repos.employee.saveSettings(first.id, { email: null, plan, revision: 1 })).toBe(
      "saved",
    );
    expect(await repos.employee.saveSettings(second.id, { email, plan, revision: 0 })).toBe(
      "saved",
    );
    expect((await signIn(email, priorCode)).status).toBe(400);

    await db
      .update(employeeAccess)
      .set({ email: email.toUpperCase() })
      .where(eq(employeeAccess.caseId, second.id));

    const cookie = await authenticate(email);
    expect(await (await request("/employee/session", "GET", cookie)).json()).toMatchObject({
      caseId: second.id,
    });
  });

  it("clears a session if the grant is revoked while Better Auth is creating it", async () => {
    const email = "revoked-at-issue-" + randomUUID() + "@offboard.example";

    const record = await repos.offboardings.createOffboarding({
      name: "Pessoa com acesso removido no login",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
    });

    await repos.employee.saveSettings(record.id, { email, plan: emptyEmployeePlan, revision: 0 });
    expect((await sendCode(email)).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No code delivered");

    await db.execute(sql`
      CREATE FUNCTION offboard_test_revoke_grant() RETURNS trigger AS $$
      BEGIN
        UPDATE employee_access SET email = NULL, grant_id = gen_random_uuid(), revision = revision + 1
        WHERE case_id = NEW.employee_case_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    try {
      await db.execute(sql`
        CREATE TRIGGER offboard_test_revoke_grant AFTER INSERT ON auth_session
        FOR EACH ROW WHEN (NEW.employee_case_id IS NOT NULL)
        EXECUTE FUNCTION offboard_test_revoke_grant()
      `);
      const result = await signIn(email, code);
      expect(result.status).toBe(400);
      expect(result.headers.getSetCookie()).toEqual([]);
      expect(
        await db.select().from(authSession).where(eq(authSession.employeeCaseId, record.id)),
      ).toEqual([]);
    } finally {
      await db.execute(sql`DROP FUNCTION offboard_test_revoke_grant() CASCADE`);
    }
  });

  it("rechecks the grant inside the transaction for reads and writes already authorized by the guard", async () => {
    const email = "revocation-" + randomUUID() + "@offboard.example";

    const record = await repos.offboardings.createOffboarding({
      name: "Pessoa com acesso removido",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
    });

    const plan = emptyEmployeePlan;
    await repos.employee.saveSettings(record.id, { email, plan, revision: 0 });

    const cookie = await authenticate(email);
    const consent: EmployeeState = { key: "consent", revision: 0, value: { accepted: true } };
    expect((await request("/employee/state", "PUT", cookie, consent)).status).toBe(200);

    const atGuard: (() => void)[] = [];
    const resumeGuard = new Set<() => void>();

    const started = Array.from(
      { length: 3 },
      () => new Promise<void>((resolve) => atGuard.push(resolve)),
    );

    const delayedApp = createApp(webOrigin, repos, {
      auth: {
        ...employeeAuth,
        async resolveEmployee(headers) {
          const principal = await employeeAuth.resolveEmployee(headers);

          await new Promise<void>((resume) => {
            resumeGuard.add(resume);
            atGuard.shift()?.();
          });

          return principal;
        },
      },
    });

    const boundHeaders = {
      cookie,
      origin: webOrigin,
      "content-type": "application/json",
      [employeeGrantHeader]: grants.get(cookie) ?? "",
    };

    const pending = [
      delayedApp.handle(
        new Request(webOrigin + "/api/employee/journey", { headers: boundHeaders }),
      ),
      delayedApp.handle(
        new Request(webOrigin + "/api/employee/state/consent", { headers: boundHeaders }),
      ),
      delayedApp.handle(
        new Request(webOrigin + "/api/employee/state", {
          method: "PUT",
          headers: boundHeaders,
          body: JSON.stringify({ ...consent, revision: 1, value: { accepted: false } }),
        }),
      ),
    ];

    try {
      await Promise.all(started);
      expect(await repos.employee.saveSettings(record.id, { email: null, plan, revision: 1 })).toBe(
        "saved",
      );
    } finally {
      resumeGuard.forEach((resume) => resume());
    }

    expect((await Promise.all(pending)).map((response) => response.status)).toEqual([
      401, 401, 401,
    ]);
    await repos.employee.saveSettings(record.id, { email, plan, revision: 2 });
    const freshCookie = await authenticate(email);
    expect(await (await request("/employee/state/consent", "GET", freshCookie)).json()).toEqual({
      key: "consent",
      revision: 1,
      value: { accepted: true },
    });
  });

  it("sends code mail through the configured provider and never trusts Expo Go origins in production", async () => {
    const email = `runtime-${randomUUID()}@offboard.example`;

    const record = await repos.offboardings.createOffboarding({
      name: "Pessoa na produção",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
    });

    await repos.employee.saveSettings(record.id, { email, plan: emptyEmployeePlan, revision: 0 });
    const delivered: string[] = [];

    const { auth: production } = createRuntimeAuth(db, undefined, {
      env: {
        BETTER_AUTH_URL: "https://offboard.example",
        BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
        EMAIL_PROVIDER: "cloudflare",
        AUTH_EMAIL_FROM: "login@offboard.example",
      },
      cloudflareEmail: {
        async send(message) {
          expect(message.to).toBe(email);
          expect(message.subject).toBe("Seu código de acesso ao Offboard");
          delivered.push(message.text);

          return { messageId: "test-email" };
        },
      },
    });

    function send(origin: Record<string, string>) {
      return production.handler(
        new Request("https://offboard.example/api/auth/email-otp/send-verification-otp", {
          method: "POST",
          headers: { ...origin, "content-type": "application/json" },
          body: JSON.stringify({ email, type: "sign-in" }),
        }),
      );
    }

    expect((await send({ "expo-origin": "exp://localhost:8103/--/" })).status).toBe(403);
    expect((await send({ "expo-origin": "offboard:///" })).status).toBe(200);
    expect(delivered[0]).toMatch(/\b\d{6}\b/);
  });
});
