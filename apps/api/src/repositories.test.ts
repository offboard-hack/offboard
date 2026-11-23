import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "./repositories.js";
import { subtasks, tasks } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const uuidPattern = /^[0-9a-f-]{36}$/;

describe.skipIf(!url)("repositories", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("seeds every fixture task in order", async () => {
    const allTasks = await db.select().from(tasks);
    expect(allTasks).toHaveLength(
      testSeedFixtures.cases.reduce((sum, item) => sum + item.tasks.length, 0),
    );

    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes");
    const detail = await repos.offboardings.getOffboarding(marina!.id);
    expect(detail?.tasks.map((task) => [task.team, task.title, task.status])).toEqual(
      testSeedFixtures.cases[0].tasks.map((task) => [task.team, task.title, task.status]),
    );
  });

  it("lists cases with the CaseSummary shape and counts", async () => {
    const list = await repos.offboardings.listOffboardings();

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

  it("returns cases with the same ordered tasks as their detail records", async () => {
    const summary = await repos.offboardings.listOffboardings();
    const bundled = await repos.offboardings.listOffboardingsWithTasks();

    expect(bundled).toEqual(
      await Promise.all(summary.map(({ id }) => repos.offboardings.getOffboarding(id))),
    );
  });

  it("lists cases without tasks as zero of zero", async () => {
    await repos.offboardings.createOffboarding({
      name: "Sem Tarefas",
      role: "QA",
      department: "Tecnologia",
      deadline: "2026-12-01",
    });

    const list = await repos.offboardings.listOffboardings();
    expect(list.find((item) => item.name === "Sem Tarefas")).toMatchObject({
      completed: 0,
      total: 0,
    });
  });

  it("returns a case with its tasks including new fields", async () => {
    const list = await repos.offboardings.listOffboardings();
    const rafael = list.find((c) => c.name === "Rafael Mendes")!;
    const found = await repos.offboardings.getOffboarding(rafael.id);

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
      description: null,
      dueDate: null,
      trackingCode: null,
      subtasks: [],
    });
  });

  it("returns description and dueDate when set", async () => {
    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(marina.id);

    const calcular = detail?.tasks.find((t) => t.title === "Calcular a rescisão");
    expect(calcular?.dueDate).toBe("2026-11-13");
    expect(calcular?.subtasks).toHaveLength(4);
    expect(calcular?.subtasks[0]).toEqual({
      id: expect.stringMatching(uuidPattern),
      title: "Levantar saldo de férias",
      done: true,
    });

    const comunicar = detail?.tasks.find(
      (t) => t.title === "Comunicar desligamento e aviso prévio",
    );

    expect(comunicar?.description).toBe(
      "Agendar reunião com o gestor e comunicar formalmente o desligamento.",
    );
  });

  it("returns null for an unknown id", async () => {
    expect(
      await repos.offboardings.getOffboarding("00000000-0000-4000-8000-000000000001"),
    ).toBeNull();
  });

  it("creates a case", async () => {
    const input = {
      name: "João  D'Ávila",
      role: "Analista",
      department: "Operações",
      deadline: "2026-12-10",
    };

    const first = await repos.offboardings.createOffboarding(input);

    expect(first).toEqual({
      id: expect.stringMatching(uuidPattern),
      ...input,
      completed: 0,
      total: 0,
    });
    expect(await repos.offboardings.getOffboarding(first.id)).toMatchObject({
      tasks: [],
      total: 0,
    });
  });

  it("bulk creates cases", async () => {
    expect(await repos.offboardings.bulkCreateOffboardings([])).toEqual([]);

    const created = await repos.offboardings.bulkCreateOffboardings([
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
    expect(await repos.offboardings.listOffboardings()).toHaveLength(7);
  });

  it("updates a task status and returns new fields", async () => {
    const list = await repos.offboardings.listOffboardings();
    const nina = list.find((c) => c.name === "Nina Castro")!;
    const before = await repos.offboardings.getOffboarding(nina.id);
    const target = before!.tasks.find((task) => task.status === "todo")!;

    const updated = await repos.offboardings.updateTaskStatus(target.id, "done");

    expect(updated).toEqual({
      ...target,
      status: "done",
    });
    const after = await repos.offboardings.getOffboarding(nina.id);
    expect(after?.tasks.find((task) => task.id === target.id)?.status).toBe("done");
    expect(after?.completed).toBe(before!.completed + 1);
  });

  it("returns null when updating an unknown task", async () => {
    expect(
      await repos.offboardings.updateTaskStatus("00000000-0000-0000-0000-000000000000", "done"),
    ).toBeNull();
  });

  it("toggles a subtask", async () => {
    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(marina.id);
    const calcular = detail?.tasks.find((t) => t.title === "Calcular a rescisão");
    const sub = calcular?.subtasks.find((s) => s.title === "Calcular multa FGTS");

    expect(sub?.done).toBe(false);

    const toggled = await repos.offboardings.toggleSubtask(sub!.id);
    expect(toggled).toEqual({ id: sub!.id, title: "Calcular multa FGTS", done: true });

    const toggledBack = await repos.offboardings.toggleSubtask(sub!.id);
    expect(toggledBack?.done).toBe(false);
  });

  it("returns null when toggling an unknown subtask", async () => {
    expect(
      await repos.offboardings.toggleSubtask("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("deletes subtasks when their task is removed via cascade", async () => {
    const allSubtasks = await db.select().from(subtasks);
    expect(allSubtasks.length).toBeGreaterThan(0);

    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    await db.$client.query(`DELETE FROM offboarding_cases WHERE id = '${marina.id}'`);

    const remaining = await db.select().from(subtasks);

    const rafaelSubCount = testSeedFixtures.cases[1].tasks.reduce(
      (sum, t) => sum + (t.subtasks?.length ?? 0),
      0,
    );

    expect(remaining).toHaveLength(rafaelSubCount);
  });

  it("lists integrations", async () => {
    const list = await repos.integrations.listIntegrations();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({ name: expect.any(String), status: expect.any(String) });
  });

  it("lists equipment joined with the case name", async () => {
    const list = await repos.equipment.listEquipment();

    const tags = list.map((row) => row.tag);

    expect(tags).toEqual(tags.toSorted());
    expect(list.find((row) => row.tag === "AUR-0412")).toMatchObject({
      person: "Marina Lopes",
      returnMethod: "pickup",
      scheduledDate: "2026-11-10",
      status: "scheduled",
    });
  });

  it("updates equipment status and returns null for unknown ids", async () => {
    const [first] = await repos.equipment.listEquipment();

    expect(await repos.equipment.updateEquipmentStatus(first.id, "failed")).toMatchObject({
      id: first.id,
      status: "failed",
    });
    expect(
      await repos.equipment.updateEquipmentStatus("00000000-0000-4000-8000-000000000000", "failed"),
    ).toBeNull();
  });

  it("upserts an integration", async () => {
    const created = await repos.integrations.upsertIntegration("Test Repo", "connected");
    expect(created).toEqual({ name: "Test Repo", status: "connected" });

    const updated = await repos.integrations.upsertIntegration("Test Repo", "disconnected");
    expect(updated).toEqual({ name: "Test Repo", status: "disconnected" });
  });

  it("gets task phase", async () => {
    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(marina.id);
    const task = detail?.tasks.find((t) => t.title === "Calcular a rescisão");

    const phase = await repos.offboardings.getTaskPhase(task!.id);
    expect(phase).toBe("first-week");
  });

  it("returns null for unknown task phase", async () => {
    expect(
      await repos.offboardings.getTaskPhase("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("gets action configs by phase", async () => {
    const configs = await repos.actionConfigs.getActionConfigsByPhase("d0");
    expect(configs.length).toBeGreaterThanOrEqual(0);

    for (const config of configs) {
      expect(config.phase).toBe("d0");
      expect(config.enabled).toBe(true);
    }
  });

  it("lists action configs", async () => {
    const configs = await repos.actionConfigs.listActionConfigs();
    expect(configs.length).toBeGreaterThan(0);
  });

  it("gets a single action config", async () => {
    const configs = await repos.actionConfigs.listActionConfigs();
    const first = configs[0];
    const found = await repos.actionConfigs.getActionConfig(first.id);
    expect(found).toEqual(first);
  });

  it("returns null for unknown action config", async () => {
    expect(
      await repos.actionConfigs.getActionConfig("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("creates an action config", async () => {
    const created = await repos.actionConfigs.createActionConfig({
      actionId: "webhook:test-create",
      phase: "d0",
      config: { url: "https://example.com" },
    });

    expect(created).toMatchObject({
      actionId: "webhook:test-create",
      phase: "d0",
      enabled: true,
    });
  });

  it("updates an action config", async () => {
    const created = await repos.actionConfigs.createActionConfig({
      actionId: "webhook:test-update",
      phase: "d0",
    });

    const updated = await repos.actionConfigs.updateActionConfig(created.id, { enabled: false });
    expect(updated?.enabled).toBe(false);
  });

  it("returns null when updating unknown action config", async () => {
    expect(
      await repos.actionConfigs.updateActionConfig("00000000-0000-0000-0000-000000000000", {
        enabled: false,
      }),
    ).toBeNull();
  });

  it("deletes an action config", async () => {
    const created = await repos.actionConfigs.createActionConfig({
      actionId: "webhook:test-delete",
      phase: "d0",
    });

    expect(await repos.actionConfigs.deleteActionConfig(created.id)).toBe(true);
    expect(await repos.actionConfigs.deleteActionConfig(created.id)).toBe(false);
  });

  it("deletes tasks when their case is removed", async () => {
    const list = await repos.offboardings.listOffboardings();
    const nina = list.find((c) => c.name === "Nina Castro")!;
    await db.$client.query(`DELETE FROM offboarding_cases WHERE id = '${nina.id}'`);
    const allTasks = await db.select().from(tasks);
    const ninaTasks = testSeedFixtures.cases.find((c) => c.name === "Nina Castro")!.tasks.length;
    expect(allTasks).toHaveLength(
      testSeedFixtures.cases.reduce((sum, item) => sum + item.tasks.length, 0) - ninaTasks,
    );
  });

  it("sets and reads a tracking code", async () => {
    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(marina.id);
    const task = detail!.tasks[0];

    const result = await repos.offboardings.setTrackingCode(task.id, "AB123456789BR");
    expect(result).toEqual({ id: task.id, trackingCode: "AB123456789BR" });

    const info = await repos.offboardings.getTaskTrackingCode(task.id);
    expect(info).toMatchObject({ id: task.id, trackingCode: "AB123456789BR" });
  });

  it("returns null when setting tracking code on unknown task", async () => {
    expect(
      await repos.offboardings.setTrackingCode("00000000-0000-0000-0000-000000000000", "XX"),
    ).toBeNull();
  });

  it("returns null when reading tracking code on unknown task", async () => {
    expect(
      await repos.offboardings.getTaskTrackingCode("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("returns tracked tasks (not done, with tracking code)", async () => {
    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(marina.id);
    const todoTask = detail!.tasks.find((t) => t.status === "todo")!;
    const doneTask = detail!.tasks.find((t) => t.status === "done")!;

    await repos.offboardings.setTrackingCode(todoTask.id, "TRACK001BR");
    await repos.offboardings.setTrackingCode(doneTask.id, "TRACK002BR");

    const tracked = await repos.offboardings.getTrackedTasks();
    const ids = tracked.map((t) => t.id);

    expect(ids).toContain(todoTask.id);
    expect(ids).not.toContain(doneTask.id);
  });

  it("includes trackingCode in updateTaskStatus result", async () => {
    const list = await repos.offboardings.listOffboardings();
    const nina = list.find((c) => c.name === "Nina Castro")!;
    const detail = await repos.offboardings.getOffboarding(nina.id);
    const task = detail!.tasks.find((t) => t.status === "todo")!;

    await repos.offboardings.setTrackingCode(task.id, "TRACK003BR");
    const updated = await repos.offboardings.updateTaskStatus(task.id, "done");
    expect(updated?.trackingCode).toBe("TRACK003BR");
  });

  it("includes trackingCode in getOffboarding tasks", async () => {
    const list = await repos.offboardings.listOffboardings();
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(marina.id);
    const task = detail!.tasks[0];

    await repos.offboardings.setTrackingCode(task.id, "TRACK004BR");

    const refreshed = await repos.offboardings.getOffboarding(marina.id);
    expect(refreshed!.tasks.find((t) => t.id === task.id)!.trackingCode).toBe("TRACK004BR");
  });
});

describe.skipIf(!url)("team members", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("lists seeded members ordered by name", async () => {
    const members = await repos.team.listTeamMembers();

    expect(members.map(({ name, role }) => [name, role])).toEqual([
      ["Beatriz Castro", "admin"],
      ["Camila Rocha", "rh"],
      ["Diego Alves", "gestor"],
    ]);
    expect(members[0].id).toMatch(uuidPattern);
  });

  it("creates a member and lists it in order", async () => {
    const created = await repos.team.createTeamMember({
      name: "Ana Souza",
      email: "ana.souza@offboard.com",
      role: "visualizador",
    });

    expect(created).toEqual({
      id: expect.stringMatching(uuidPattern),
      name: "Ana Souza",
      email: "ana.souza@offboard.com",
      role: "visualizador",
    });
    expect((await repos.team.listTeamMembers())[0].name).toBe("Ana Souza");
  });

  it("rejects a duplicate email", async () => {
    await expect(
      repos.team.createTeamMember({ name: "Dup", email: "camila.rocha@offboard.com", role: "rh" }),
    ).rejects.toThrow();
  });

  it("deletes by id and reports whether a row was removed", async () => {
    const [first] = await repos.team.listTeamMembers();

    expect(await repos.team.deleteTeamMember(first.id)).toBe(true);
    expect(await repos.team.deleteTeamMember(first.id)).toBe(false);
    expect(await repos.team.listTeamMembers()).toHaveLength(2);
  });
});
