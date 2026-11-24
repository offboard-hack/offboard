import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "./repositories.js";
import type { ConfigValue } from "@offboard/db/schema";
import { tasks } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
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
    item?: string;
    tag?: string;
    serialNumber?: string;
    assignedTo?: string;
    assignedEmail?: string;
    returnMethod?: string;
    trackingCode?: string;
    scheduledDate?: string;
    notes?: string;
    caseId?: string | null;
    taskId?: string | null;
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
    const body = { name: "Ana Souza", role: "Dev", department: "Eng", deadline: "2026-12-01" };
    const res = await call("/offboardings", "POST", body);
    const created = await res.json();

    expect(res.status).toBe(201);
    expect(created).toEqual({ id: expect.any(String), ...body, completed: 0, total: 0 });
    expect((await call(`/offboardings/${created.id}`)).status).toBe(200);
  });

  it.each([
    { name: "", role: "Dev", department: "Eng", deadline: "2026-12-01" },
    { name: "Ana", role: "Dev", department: "Eng", deadline: "tomorrow" },
    { name: "Ana" },
  ])("rejects an invalid offboarding %j", async (body) => {
    const res = await call("/offboardings", "POST", body);

    expect(res.status).toBe(422);
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

  const emptyEquipment = {
    id: expect.any(String),
    item: expect.any(String),
    tag: expect.any(String),
    serialNumber: null,
    assignedTo: null,
    assignedEmail: null,
    status: "in_inventory",
    returnMethod: null,
    trackingCode: null,
    scheduledDate: null,
    caseId: null,
    taskId: null,
    notes: null,
  };

  async function marinaCase() {
    const list = await (await call("/offboardings")).json();

    return list.find((entry: { name: string }) => entry.name === "Marina Lopes");
  }

  it("lists the full equipment inventory ordered by tag", async () => {
    const res = await call("/equipment");
    const list = await res.json();
    const tags = list.map((row: { tag: string }) => row.tag);

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(tags).toEqual([...tags].sort());
    expect(list.find((row: { tag: string }) => row.tag === "PAT-0412")).toMatchObject({
      item: "Notebook Dell Latitude 5440",
      assignedTo: "Marina Lopes",
      status: "pending_return",
      returnMethod: "pickup",
      scheduledDate: "2026-11-10",
    });
  });

  it("filters equipment by status and assignee", async () => {
    const byStatus = await (await call("/equipment?status=in_inventory")).json();
    const byPerson = await (await call("/equipment?assignedTo=Marina%20Lopes")).json();

    expect(byStatus.length).toBeGreaterThan(0);
    expect(byStatus.every((row: { status: string }) => row.status === "in_inventory")).toBe(true);
    expect(byPerson.length).toBeGreaterThan(0);
    expect(byPerson.every((row: { assignedTo: string }) => row.assignedTo === "Marina Lopes")).toBe(
      true,
    );
  });

  it("filters equipment by case and lists it per case", async () => {
    const marina = await marinaCase();

    const filtered = await (await call(`/equipment?caseId=${marina.id}`)).json();
    const byCase = await (await call(`/equipment/by-case/${marina.id}`)).json();

    expect(filtered.length).toBeGreaterThan(0);
    expect(byCase).toEqual(filtered);
    expect(await (await call(`/equipment/by-case/${missingCaseId}`)).json()).toEqual([]);
  });

  it("rejects invalid equipment filters", async () => {
    expect((await call("/equipment?status=nope")).status).toBe(422);
    expect((await call("/equipment?caseId=nope")).status).toBe(422);
    expect((await call("/equipment/by-case/nope")).status).toBe(422);
  });

  it("gets one equipment item and returns 404 for unknown ids", async () => {
    const [first] = await (await call("/equipment")).json();
    const found = await call(`/equipment/${first.id}`);
    const missing = await call(`/equipment/${missingTaskId}`);

    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(first);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Equipment not found" });
  });

  it("creates equipment and rejects a duplicate tag", async () => {
    const created = await call("/equipment", "POST", {
      item: "Mouse Logitech MX",
      tag: "PAT-9001",
    });

    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      ...emptyEquipment,
      item: "Mouse Logitech MX",
      tag: "PAT-9001",
    });

    const duplicate = await call("/equipment", "POST", { item: "Outro", tag: "PAT-9001" });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "Equipment tag already exists" });
  });

  it("rejects equipment creation with an invalid body", async () => {
    expect((await call("/equipment", "POST", { item: "", tag: "PAT-9002" })).status).toBe(422);
    expect(
      (await call("/equipment", "POST", { item: "X", tag: "PAT-9002", status: "invalid" })).status,
    ).toBe(422);
  });

  it("updates equipment fields", async () => {
    const created = await (
      await call("/equipment", "POST", { item: "Webcam", tag: "PAT-9003" })
    ).json();

    const res = await call(`/equipment/${created.id}`, "PUT", {
      status: "in_use",
      assignedTo: "Camila Rocha",
      assignedEmail: "camila.rocha@offboard.com",
      returnMethod: "correios",
      trackingCode: "BR111222333BR",
      scheduledDate: "2026-12-01",
      notes: "Entregue",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: created.id,
      status: "in_use",
      assignedTo: "Camila Rocha",
      returnMethod: "correios",
      trackingCode: "BR111222333BR",
      scheduledDate: "2026-12-01",
    });
  });

  it("unlinks a case and task through an update", async () => {
    const linked = (await (await call("/equipment?status=pending_return")).json()).find(
      (row: { caseId: string | null }) => row.caseId,
    );

    const res = await call(`/equipment/${linked.id}`, "PUT", { caseId: null, taskId: null });

    expect(await res.json()).toMatchObject({ caseId: null, taskId: null });
  });

  it("returns 404 when updating unknown equipment", async () => {
    const res = await call(`/equipment/${missingTaskId}`, "PUT", { status: "received" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Equipment not found" });
  });

  it("rejects renaming equipment to an existing tag", async () => {
    const [first, second] = await (await call("/equipment")).json();
    const res = await call(`/equipment/${first.id}`, "PUT", { tag: second.tag });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Equipment tag already exists" });
  });

  it("rejects an invalid equipment status", async () => {
    const res = await call(`/equipment/${missingTaskId}`, "PUT", { status: "invalid" });

    expect(res.status).toBe(422);
  });

  it("deletes only inventory or decommissioned equipment", async () => {
    const [inUse] = await (await call("/equipment?status=in_use")).json();
    const [stocked] = await (await call("/equipment?status=in_inventory")).json();

    const blocked = await call(`/equipment/${inUse.id}`, "DELETE");
    const removed = await call(`/equipment/${stocked.id}`, "DELETE");
    const missing = await call(`/equipment/${missingTaskId}`, "DELETE");

    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({
      error: "Only decommissioned or in-inventory equipment can be deleted",
    });
    expect(removed.status).toBe(204);
    expect((await call(`/equipment/${stocked.id}`)).status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it("assigns equipment to a case and task", async () => {
    const marina = await marinaCase();
    const detail = await (await call(`/offboardings/${marina.id}`)).json();
    const [stocked] = await (await call("/equipment?status=in_inventory")).json();
    const [inUse] = await (await call("/equipment?status=in_use")).json();

    const withTask = await call(`/equipment/${stocked.id}/assign-case`, "POST", {
      caseId: marina.id,
      taskId: detail.tasks[0].id,
    });

    const fromUse = await call(`/equipment/${inUse.id}/assign-case`, "POST", {
      caseId: marina.id,
    });

    expect(withTask.status).toBe(200);
    expect(await withTask.json()).toMatchObject({
      caseId: marina.id,
      taskId: detail.tasks[0].id,
      status: "in_inventory",
    });
    expect(await fromUse.json()).toMatchObject({
      caseId: marina.id,
      taskId: null,
      status: "pending_return",
    });
  });

  it("returns 404 when assigning unknown equipment, case or task", async () => {
    const marina = await marinaCase();
    const [item] = await (await call("/equipment")).json();

    const noEquipment = await call(`/equipment/${missingTaskId}/assign-case`, "POST", {
      caseId: marina.id,
    });

    const noCase = await call(`/equipment/${item.id}/assign-case`, "POST", {
      caseId: missingCaseId,
    });

    const noTask = await call(`/equipment/${item.id}/assign-case`, "POST", {
      caseId: marina.id,
      taskId: missingTaskId,
    });

    expect(noEquipment.status).toBe(404);
    expect(await noEquipment.json()).toEqual({ error: "Equipment not found" });
    expect(await noCase.json()).toEqual({ error: "Offboarding not found" });
    expect(await noTask.json()).toEqual({ error: "Task not found" });
  });

  it("limits equipment writes by role", async () => {
    const send = (path: string, method: string, session: string, body = "{}") =>
      app.handle(
        new Request(`http://localhost/api${path}`, {
          method,
          headers: {
            "x-test-session": session,
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: method === "GET" || method === "DELETE" ? undefined : body,
        }),
      );

    expect((await send("/equipment", "GET", "visualizador")).status).toBe(200);
    expect((await send(`/equipment/${missingTaskId}`, "PUT", "visualizador")).status).toBe(403);
    expect((await send(`/equipment/${missingTaskId}`, "PUT", "rh")).status).toBe(404);
    expect((await send("/equipment", "POST", "rh", '{"item":"x","tag":"y"}')).status).toBe(403);
    expect((await send(`/equipment/${missingTaskId}`, "DELETE", "rh")).status).toBe(403);
    expect(
      (
        await send(
          `/equipment/${missingTaskId}/assign-case`,
          "POST",
          "visualizador",
          JSON.stringify({ caseId: missingCaseId }),
        )
      ).status,
    ).toBe(403);
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

  it("rethrows unexpected equipment write errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        equipment: {
          ...repos.equipment,
          createEquipment: () => Promise.reject(new Error("boom")),
          updateEquipment: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const send = (path: string, method: string, body: Payload) =>
      failing.handle(
        new Request(`http://localhost/api${path}`, {
          method,
          headers: { "content-type": "application/json", origin: webOrigin },
          body: JSON.stringify(body),
        }),
      );

    expect((await send("/equipment", "POST", { item: "x", tag: "y" })).status).toBe(500);
    expect((await send(`/equipment/${missingTaskId}`, "PUT", {})).status).toBe(500);
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

  const deliveredBody = JSON.stringify({
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

  async function equipmentByTag(tag: string) {
    const list = await (await call("/equipment")).json();

    return list.find((row: { tag: string }) => row.tag === tag);
  }

  it("marks in-transit equipment as received and completes its linked task once", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });
    const before = await equipmentByTag("PAT-0398");

    correiosStatus = 200;
    correiosBody = deliveredBody;

    const res = await correiosApp.handle(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deliveredEquipment).toContain(before.id);
    expect(body.delivered.filter((id: string) => id === before.taskId)).toHaveLength(1);
    expect(await equipmentByTag("PAT-0398")).toMatchObject({ status: "received" });
    expect((await db.select().from(tasks).where(eq(tasks.id, before.taskId)))[0].status).toBe(
      "done",
    );
  });

  it("completes the linked task when only the equipment carries the tracking code", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });
    const before = await equipmentByTag("PAT-0377");

    await db.update(tasks).set({ trackingCode: null }).where(eq(tasks.id, before.taskId));

    correiosStatus = 200;
    correiosBody = deliveredBody;

    const body = await (await correiosApp.handle(cronRequest("POST"))).json();

    expect(body.deliveredEquipment).toContain(before.id);
    expect(body.delivered).toContain(before.taskId);
    expect((await db.select().from(tasks).where(eq(tasks.id, before.taskId)))[0].status).toBe(
      "done",
    );
  });

  it("does not re-complete a linked task that is already done", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });
    const before = await equipmentByTag("PAT-0398");

    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, before.taskId));

    correiosStatus = 200;
    correiosBody = deliveredBody;

    const body = await (await correiosApp.handle(cronRequest())).json();

    expect(body.deliveredEquipment).toContain(before.id);
    expect(body.delivered).not.toContain(before.taskId);
  });

  it("receives tracked equipment that has no linked task", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    const created = await (
      await call("/equipment", "POST", {
        item: "Monitor",
        tag: "PAT-9100",
        status: "in_transit",
        returnMethod: "correios",
        trackingCode: "BR000111222BR",
      })
    ).json();

    correiosStatus = 200;
    correiosBody = deliveredBody;

    const body = await (await correiosApp.handle(cronRequest())).json();

    expect(body.deliveredEquipment).toContain(created.id);
    expect(await equipmentByTag("PAT-9100")).toMatchObject({ status: "received" });
  });

  it("keeps equipment in transit until Correios reports delivery", async () => {
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

    const body = await (await correiosApp.handle(cronRequest())).json();

    expect(body.deliveredEquipment).toEqual([]);
    expect(await equipmentByTag("PAT-0398")).toMatchObject({ status: "in_transit" });
  });

  it("ignores a deleted task linked to delivered equipment", async () => {
    const stubbedApp = createApp(
      webOrigin,
      {
        ...repos,
        offboardings: { ...repos.offboardings, getTrackedTasks: () => Promise.resolve([]) },
        equipment: {
          ...repos.equipment,
          getEquipmentWithTracking: () =>
            Promise.resolve([
              { id: missingTaskId, trackingCode: "ZZ999999999BR", taskId: missingCaseId },
            ]),
        },
      },
      { ...appOptions, correiosBaseUrl },
    );

    correiosStatus = 200;
    correiosBody = deliveredBody;

    const body = await (await stubbedApp.handle(cronRequest())).json();

    expect(body).toEqual({ checked: 1, delivered: [], deliveredEquipment: [missingTaskId] });
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
        equipment: { ...repos.equipment, getEquipmentWithTracking: () => Promise.resolve([]) },
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

  it("rethrows unexpected equipment write errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        equipment: {
          ...repos.equipment,
          createEquipment: () => Promise.reject(new Error("boom")),
          updateEquipment: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const send = (path: string, method: string, body: Payload) =>
      failing.handle(
        new Request(`http://localhost/api${path}`, {
          method,
          headers: { "content-type": "application/json", origin: webOrigin },
          body: JSON.stringify(body),
        }),
      );

    expect((await send("/equipment", "POST", { item: "x", tag: "y" })).status).toBe(500);
    expect((await send(`/equipment/${missingTaskId}`, "PUT", {})).status).toBe(500);
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
