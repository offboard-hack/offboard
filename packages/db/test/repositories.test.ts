import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/client.ts";
import { seedCases } from "../src/offboarding.fixture.ts";
import { createRepositories, slugify } from "../src/repositories/index.ts";
import { offboardingTasks } from "../src/schema/index.ts";
import { seedDatabase } from "../src/seed-database.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

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
    const tasks = await db.select().from(offboardingTasks);
    expect(tasks).toHaveLength(seedCases.reduce((sum, item) => sum + item.tasks.length, 0));

    const marina = await repos.getOffboarding("marina-lopes");
    expect(marina?.tasks.map((task) => [task.team, task.title, task.status])).toEqual(
      seedCases[0].tasks.map((task) => [...task]),
    );
  });

  it("lists cases with the CaseSummary shape and counts", async () => {
    const list = await repos.listOffboardings();

    expect(list.map((item) => item.id)).toEqual([
      "marina-lopes",
      "rafael-mendes",
      "bianca-souza",
      "andre-lima",
      "nina-castro",
    ]);
    expect(list[0]).toEqual({
      id: "marina-lopes",
      name: "Marina Lopes",
      role: "Analista de marketing",
      department: "Marketing",
      deadline: "2026-11-13",
      completed: 15,
      total: 27,
    });
    expect(list[3]).toMatchObject({ id: "andre-lima", completed: 1, total: 4 });
  });

  it("lists cases without tasks as zero of zero", async () => {
    await repos.createOffboarding({
      name: "Sem Tarefas",
      role: "QA",
      department: "Tecnologia",
      deadline: "2026-12-01",
    });

    const list = await repos.listOffboardings();
    expect(list.find((item) => item.id === "sem-tarefas")).toMatchObject({
      completed: 0,
      total: 0,
    });
  });

  it("returns a case with its tasks", async () => {
    const found = await repos.getOffboarding("rafael-mendes");

    expect(found).toMatchObject({
      id: "rafael-mendes",
      deadline: "2026-11-16",
      completed: 3,
      total: 6,
    });
    expect(found?.tasks).toHaveLength(6);
    expect(found?.tasks[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: "Comunicar desligamento e aviso prévio",
      team: "RH e DP",
      status: "done",
    });
  });

  it("returns null for an unknown slug", async () => {
    expect(await repos.getOffboarding("nobody")).toBeNull();
  });

  it("creates a case with an accent-free slug and avoids collisions", async () => {
    const input = {
      name: "João  D'Ávila",
      role: "Analista",
      department: "Operações",
      deadline: "2026-12-10",
    };

    const first = await repos.createOffboarding(input);
    const second = await repos.createOffboarding(input);

    expect(first).toEqual({ id: "joao-d-avila", ...input, completed: 0, total: 0 });
    expect(second.id).toBe("joao-d-avila-2");
    expect(await repos.getOffboarding("joao-d-avila")).toMatchObject({ tasks: [], total: 0 });
  });

  it("bulk creates cases and deduplicates slugs within the batch", async () => {
    expect(await repos.bulkCreateOffboardings([])).toEqual([]);

    const created = await repos.bulkCreateOffboardings([
      { name: "Marina Lopes", department: "Marketing" },
      { name: "Marina Lopes", department: "Marketing" },
      { name: "Ana Paula", department: "RH" },
    ]);

    expect(created.map((item) => item.id)).toEqual([
      "marina-lopes-2",
      "marina-lopes-3",
      "ana-paula",
    ]);
    expect(created[2]).toMatchObject({
      name: "Ana Paula",
      department: "RH",
      role: "Não informado",
      completed: 0,
      total: 0,
    });
    expect(created[2].deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await repos.listOffboardings()).toHaveLength(8);
  });

  it("falls back to a default slug when the name has no letters", async () => {
    const created = await repos.createOffboarding({
      name: "!!!",
      role: "x",
      department: "y",
      deadline: "2026-12-01",
    });

    expect(created.id).toBe("desligamento");
  });

  it("updates a task status", async () => {
    const before = await repos.getOffboarding("nina-castro");
    const target = before!.tasks.find((task) => task.status === "todo")!;

    const updated = await repos.updateTaskStatus(target.id, "done");

    expect(updated).toEqual({ ...target, status: "done" });
    const after = await repos.getOffboarding("nina-castro");
    expect(after?.tasks.find((task) => task.id === target.id)?.status).toBe("done");
    expect(after?.completed).toBe(before!.completed + 1);
  });

  it("returns null when updating an unknown task", async () => {
    expect(await repos.updateTaskStatus("00000000-0000-0000-0000-000000000000", "done")).toBeNull();
  });

  it("deletes tasks when their case is removed", async () => {
    await db.$client.query("delete from offboarding_cases where slug = 'nina-castro'");
    const tasks = await db.select().from(offboardingTasks);
    expect(tasks).toHaveLength(seedCases.reduce((sum, item) => sum + item.tasks.length, 0) - 4);
  });
});

describe("slugify", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(slugify("  André Lima-Souza! ")).toBe("andre-lima-souza");
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
