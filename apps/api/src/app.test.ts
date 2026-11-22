import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import type { ConfigValue } from "@offboard/db/schema";
import { seedDatabase } from "@offboard/db/seed-database";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingTaskId = "00000000-0000-4000-8000-000000000000";
const missingCaseId = "00000000-0000-4000-8000-000000000001";

describe.skipIf(!url)("api", () => {
  const db = createClient(url ?? "");
  const app = createApp("http://localhost:5173", createRepositories(db));

  type Payload = {
    name?: string;
    role?: string;
    department?: string;
    deadline?: string;
    status?: string;
    rows?: { name: string; department?: string }[];
    actionId?: string;
    enabled?: boolean;
    config?: Record<string, ConfigValue>;
    phase?: string;
  };

  function call(path: string, method = "GET", body?: Payload) {
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("reports health", async () => {
    const res = await call("/health");

    expect(await res.json()).toEqual({ status: "ok" });
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

  it("gets an offboarding with its tasks", async () => {
    const list = await (await call("/offboardings")).json();
    const first = list[0];
    const res = await call(`/offboardings/${first.id}`);
    const found = await res.json();

    expect(res.status).toBe(200);
    expect(found.id).toBe(first.id);
    expect(found.tasks.length).toBe(found.total);
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
    expect(await res.json()).toEqual({ ...target, status: "in_progress" });
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

  it("rejects invalid action config", async () => {
    const noAction = await call("/action-configs", "POST", { phase: "d0" });
    const noPhase = await call("/action-configs", "POST", { actionId: "test::x" });

    expect(noAction.status).toBe(422);
    expect(noPhase.status).toBe(422);
  });

  it("rethrows unexpected create errors", async () => {
    const failing = createApp("http://localhost:5173", {
      ...createRepositories(db),
      createActionConfig: () => Promise.reject(new Error("boom")),
    });

    const res = await failing.handle(
      new Request("http://localhost/api/action-configs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId: "x::y", phase: "d0" }),
      }),
    );

    expect(res.status).toBe(500);
  });
});
