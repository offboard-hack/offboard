import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { seedCases } from "../src/offboarding.fixture.ts";
import { createRepositories } from "../src/repositories/index.ts";
import { tasks } from "../src/schema/index.ts";
import { seedDatabase } from "../src/seed-database.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const uuidPattern = /^[0-9a-f-]{36}$/;

describe.skipIf(!url)("repositories", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("seeds every fixture task in order", async () => {
    const allTasks = await db.select().from(tasks);
    expect(allTasks).toHaveLength(seedCases.reduce((sum, item) => sum + item.tasks.length, 0));

    const list = await repos.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes");
    const detail = await repos.getOffboarding(marina!.id);
    expect(detail?.tasks.map((task) => [task.team, task.title, task.status])).toEqual(
      seedCases[0].tasks.map(([team, title, status]) => [team, title, status]),
    );
  });

  it("lists cases with the CaseSummary shape and counts", async () => {
    const list = await repos.listOffboardings();

    expect(list.map((item) => item.name)).toEqual([
      "Marina Lopes",
      "Rafael Mendes",
      "Bianca Souza",
      "André Lima",
      "Nina Castro",
    ]);
    expect(list[0]).toEqual({
      id: expect.stringMatching(uuidPattern),
      name: "Marina Lopes",
      role: "Analista de marketing",
      department: "Marketing",
      deadline: "2026-11-13",
      completed: 15,
      total: 27,
    });
    expect(list[3]).toMatchObject({ name: "André Lima", completed: 1, total: 4 });
  });

  it("lists cases without tasks as zero of zero", async () => {
    await repos.createOffboarding({
      name: "Sem Tarefas",
      role: "QA",
      department: "Tecnologia",
      deadline: "2026-12-01",
    });

    const list = await repos.listOffboardings();
    expect(list.find((item) => item.name === "Sem Tarefas")).toMatchObject({
      completed: 0,
      total: 0,
    });
  });

  it("returns a case with its tasks", async () => {
    const list = await repos.listOffboardings();
    const rafael = list.find((c) => c.name === "Rafael Mendes")!;
    const found = await repos.getOffboarding(rafael.id);

    expect(found).toMatchObject({
      deadline: "2026-11-16",
      completed: 3,
      total: 6,
    });
    expect(found?.tasks).toHaveLength(6);
    expect(found?.tasks[0]).toEqual({
      id: expect.stringMatching(uuidPattern),
      title: "Comunicar desligamento e aviso prévio",
      team: "RH e DP",
      status: "done",
    });
  });

  it("returns null for an unknown id", async () => {
    expect(await repos.getOffboarding("00000000-0000-4000-8000-000000000001")).toBeNull();
  });

  it("creates a case", async () => {
    const input = {
      name: "João  D'Ávila",
      role: "Analista",
      department: "Operações",
      deadline: "2026-12-10",
    };

    const first = await repos.createOffboarding(input);

    expect(first).toEqual({
      id: expect.stringMatching(uuidPattern),
      ...input,
      completed: 0,
      total: 0,
    });
    expect(await repos.getOffboarding(first.id)).toMatchObject({ tasks: [], total: 0 });
  });

  it("bulk creates cases", async () => {
    expect(await repos.bulkCreateOffboardings([])).toEqual([]);

    const created = await repos.bulkCreateOffboardings([
      { name: "Marina Lopes 2", department: "Marketing" },
      { name: "Ana Paula", department: "RH" },
    ]);

    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({
      name: "Ana Paula",
      department: "RH",
      role: "Não informado",
      completed: 0,
      total: 0,
    });
    expect(created[1].deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await repos.listOffboardings()).toHaveLength(7);
  });

  it("updates a task status", async () => {
    const list = await repos.listOffboardings();
    const nina = list.find((c) => c.name === "Nina Castro")!;
    const before = await repos.getOffboarding(nina.id);
    const target = before!.tasks.find((task) => task.status === "todo")!;

    const updated = await repos.updateTaskStatus(target.id, "done");

    expect(updated).toEqual({ ...target, status: "done" });
    const after = await repos.getOffboarding(nina.id);
    expect(after?.tasks.find((task) => task.id === target.id)?.status).toBe("done");
    expect(after?.completed).toBe(before!.completed + 1);
  });

  it("returns null when updating an unknown task", async () => {
    expect(await repos.updateTaskStatus("00000000-0000-0000-0000-000000000000", "done")).toBeNull();
  });

  it("deletes tasks when their case is removed", async () => {
    const list = await repos.listOffboardings();
    const nina = list.find((c) => c.name === "Nina Castro")!;
    await db.$client.query(`DELETE FROM offboarding_cases WHERE id = '${nina.id}'`);
    const allTasks = await db.select().from(tasks);
    expect(allTasks).toHaveLength(seedCases.reduce((sum, item) => sum + item.tasks.length, 0) - 4);
  });
});

describe("createClient", () => {
  it("strips sslmode and disables certificate verification for cloud hosts", async () => {
    const cloud = createClient(
      "postgres://u:p@db.supabase.co:5432/db?sslmode=require&application_name=x",
    );

    const options = cloud.$client.options;
    expect(options.connectionString).toBe(
      "postgres://u:p@db.supabase.co:5432/db?application_name=x",
    );
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    await cloud.$client.end();

    const only = createClient("postgres://u:p@x.neon.tech/db?sslmode=require");
    expect(only.$client.options.connectionString).toBe("postgres://u:p@x.neon.tech/db");
    await only.$client.end();
  });

  it("leaves local urls untouched", async () => {
    const local = createClient("postgres://u:p@localhost:5432/db?sslmode=disable");
    expect(local.$client.options.connectionString).toBe(
      "postgres://u:p@localhost:5432/db?sslmode=disable",
    );
    expect(local.$client.options.ssl).toBeUndefined();
    await local.$client.end();
  });
});
