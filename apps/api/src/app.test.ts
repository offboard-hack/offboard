import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "@offboard/db/repositories";
import { seedDatabase } from "@offboard/db/seed-database";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingTaskId = "00000000-0000-4000-8000-000000000000";

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
    const res = await call("/offboardings/marina-lopes");
    const found = await res.json();

    expect(res.status).toBe(200);
    expect(found.id).toBe("marina-lopes");
    expect(found.tasks.length).toBe(found.total);
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await call("/offboardings/missing");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Offboarding not found" });
  });

  it("creates an offboarding", async () => {
    const body = { name: "Ana Souza", role: "Dev", department: "Eng", deadline: "2026-12-01" };
    const res = await call("/offboardings", "POST", body);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "ana-souza", ...body, completed: 0, total: 0 });
    expect((await call("/offboardings/ana-souza")).status).toBe(200);
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
    expect(created.map((item: { id: string }) => item.id)).toEqual(["bia-lima", "caio-reis"]);
  });

  it("rejects an invalid import", async () => {
    const res = await call("/offboardings/import", "POST", { rows: [{ name: "Bia" }] });

    expect(res.status).toBe(422);
  });

  it("updates a task status", async () => {
    const found = await (await call("/offboardings/marina-lopes")).json();
    const target = found.tasks.find((item: { status: string }) => item.status !== "inProgress");
    const res = await call(`/tasks/${target?.id}/status`, "PATCH", { status: "inProgress" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...target, status: "inProgress" });
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
});
