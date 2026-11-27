import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "./repositories.js";
import {
  actionConfigs,
  automationRules,
  defaultOrgId,
  employeeAccess,
  equipment,
  exitSurveys,
  integrations,
  invoices,
  offboardingCases,
  organizations,
  plans,
  subscriptions,
  subtasks,
  tasks,
  teamMembers,
} from "@offboard/db/schema";
import { emptyEmployeePlan } from "@offboard/employee";
import { eq } from "drizzle-orm";
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

    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const marina = list.find((c) => c.name === "Marina Lopes");
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, marina!.id);
    expect(detail?.tasks.map((task) => [task.team, task.title, task.status])).toEqual(
      testSeedFixtures.cases[0].tasks.map((task) => [task.team, task.title, task.status]),
    );
  });

  it("lists cases with the CaseSummary shape and counts", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);

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
    const summary = await repos.offboardings.listOffboardings(defaultOrgId);
    const bundled = await repos.offboardings.listOffboardingsWithTasks(defaultOrgId);

    expect(bundled).toEqual(
      await Promise.all(
        summary.map(({ id }) => repos.offboardings.getOffboarding(defaultOrgId, id)),
      ),
    );
  });

  it("lists cases without tasks as zero of zero", async () => {
    await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Sem Tarefas",
      role: "QA",
      department: "Tecnologia",
      deadline: "2026-12-01",
      email: "sem-tarefas@example.com",
    });

    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    expect(list.find((item) => item.name === "Sem Tarefas")).toMatchObject({
      completed: 0,
      total: 0,
    });
  });

  it("returns a case with its tasks including new fields", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const rafael = list.find((c) => c.name === "Rafael Mendes")!;
    const found = await repos.offboardings.getOffboarding(defaultOrgId, rafael.id);

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
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, marina.id);

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
      await repos.offboardings.getOffboarding(defaultOrgId, "00000000-0000-4000-8000-000000000001"),
    ).toBeNull();
  });

  it("creates a case", async () => {
    const input = {
      name: "João  D'Ávila",
      role: "Analista",
      department: "Operações",
      deadline: "2026-12-10",
      email: "joao.davila@example.com",
    };

    const first = await repos.offboardings.createOffboarding(defaultOrgId, input);
    const { email: _, ...expected } = input;

    expect(first).toEqual({
      id: expect.stringMatching(uuidPattern),
      ...expected,
      completed: 0,
      total: 0,
    });
    expect(await repos.offboardings.getOffboarding(defaultOrgId, first.id)).toMatchObject({
      tasks: [],
      total: 0,
    });
  });

  it("bulk creates cases", async () => {
    expect(await repos.offboardings.bulkCreateOffboardings(defaultOrgId, [])).toEqual([]);

    const created = await repos.offboardings.bulkCreateOffboardings(defaultOrgId, [
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
    expect(await repos.offboardings.listOffboardings(defaultOrgId)).toHaveLength(7);
  });

  it("updates a task status and returns new fields", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const nina = list.find((c) => c.name === "Nina Castro")!;
    const before = await repos.offboardings.getOffboarding(defaultOrgId, nina.id);
    const target = before!.tasks.find((task) => task.status === "todo")!;

    const updated = await repos.offboardings.updateTaskStatus(defaultOrgId, target.id, "done");

    expect(updated).toEqual({
      ...target,
      status: "done",
    });
    const after = await repos.offboardings.getOffboarding(defaultOrgId, nina.id);
    expect(after?.tasks.find((task) => task.id === target.id)?.status).toBe("done");
    expect(after?.completed).toBe(before!.completed + 1);
  });

  it("returns null when updating an unknown task", async () => {
    expect(
      await repos.offboardings.updateTaskStatus(
        defaultOrgId,
        "00000000-0000-0000-0000-000000000000",
        "done",
      ),
    ).toBeNull();
  });

  it("toggles a subtask", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, marina.id);
    const calcular = detail?.tasks.find((t) => t.title === "Calcular a rescisão");
    const sub = calcular?.subtasks.find((s) => s.title === "Calcular multa FGTS");

    expect(sub?.done).toBe(false);

    const toggled = await repos.offboardings.toggleSubtask(defaultOrgId, sub!.id);
    expect(toggled).toEqual({ id: sub!.id, title: "Calcular multa FGTS", done: true });

    const toggledBack = await repos.offboardings.toggleSubtask(defaultOrgId, sub!.id);
    expect(toggledBack?.done).toBe(false);
  });

  it("returns null when toggling an unknown subtask", async () => {
    expect(
      await repos.offboardings.toggleSubtask(defaultOrgId, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("deletes subtasks when their task is removed via cascade", async () => {
    const allSubtasks = await db.select().from(subtasks);
    expect(allSubtasks.length).toBeGreaterThan(0);

    const list = await repos.offboardings.listOffboardings(defaultOrgId);
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
    const list = await repos.integrations.listIntegrations(defaultOrgId);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({ name: expect.any(String), status: expect.any(String) });
  });

  it("lists equipment joined with the case name", async () => {
    const list = await repos.equipment.listEquipment(defaultOrgId);

    const tags = list.map((row) => row.tag);

    expect(tags).toEqual([...tags].sort());
    expect(list.find((row) => row.tag === "AUR-0412")).toMatchObject({
      person: "Marina Lopes",
      returnMethod: "pickup",
      scheduledDate: "2026-11-10",
      status: "scheduled",
    });
  });

  it("updates equipment status and returns null for unknown ids", async () => {
    const [first] = await repos.equipment.listEquipment(defaultOrgId);

    expect(
      await repos.equipment.updateEquipmentStatus(defaultOrgId, first.id, "failed"),
    ).toMatchObject({
      id: first.id,
      status: "failed",
    });
    expect(
      await repos.equipment.updateEquipmentStatus(
        defaultOrgId,
        "00000000-0000-4000-8000-000000000000",
        "failed",
      ),
    ).toBeNull();
  });

  it("upserts an integration", async () => {
    const created = await repos.integrations.upsertIntegration(
      defaultOrgId,
      "Test Repo",
      "connected",
    );

    expect(created).toEqual({ name: "Test Repo", status: "connected" });

    const updated = await repos.integrations.upsertIntegration(
      defaultOrgId,
      "Test Repo",
      "disconnected",
    );

    expect(updated).toEqual({ name: "Test Repo", status: "disconnected" });
  });

  it("gets task phase", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, marina.id);
    const task = detail?.tasks.find((t) => t.title === "Calcular a rescisão");

    const phase = await repos.offboardings.getTaskPhase(defaultOrgId, task!.id);
    expect(phase).toBe("first-week");
  });

  it("returns null for unknown task phase", async () => {
    expect(
      await repos.offboardings.getTaskPhase(defaultOrgId, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("gets action configs by phase", async () => {
    const configs = await repos.actionConfigs.getActionConfigsByPhase(defaultOrgId, "d0");
    expect(configs.length).toBeGreaterThanOrEqual(0);

    for (const config of configs) {
      expect(config.phase).toBe("d0");
      expect(config.enabled).toBe(true);
    }
  });

  it("lists action configs", async () => {
    const configs = await repos.actionConfigs.listActionConfigs(defaultOrgId);
    expect(configs.length).toBeGreaterThan(0);
  });

  it("gets a single action config", async () => {
    const configs = await repos.actionConfigs.listActionConfigs(defaultOrgId);
    const first = configs[0];
    const found = await repos.actionConfigs.getActionConfig(defaultOrgId, first.id);
    expect(found).toEqual(first);
  });

  it("returns null for unknown action config", async () => {
    expect(
      await repos.actionConfigs.getActionConfig(
        defaultOrgId,
        "00000000-0000-0000-0000-000000000000",
      ),
    ).toBeNull();
  });

  it("creates an action config", async () => {
    const created = await repos.actionConfigs.createActionConfig(defaultOrgId, {
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
    const created = await repos.actionConfigs.createActionConfig(defaultOrgId, {
      actionId: "webhook:test-update",
      phase: "d0",
    });

    const updated = await repos.actionConfigs.updateActionConfig(defaultOrgId, created.id, {
      enabled: false,
    });

    expect(updated?.enabled).toBe(false);
  });

  it("returns null when updating unknown action config", async () => {
    expect(
      await repos.actionConfigs.updateActionConfig(
        defaultOrgId,
        "00000000-0000-0000-0000-000000000000",
        {
          enabled: false,
        },
      ),
    ).toBeNull();
  });

  it("deletes an action config", async () => {
    const created = await repos.actionConfigs.createActionConfig(defaultOrgId, {
      actionId: "webhook:test-delete",
      phase: "d0",
    });

    expect(await repos.actionConfigs.deleteActionConfig(defaultOrgId, created.id)).toBe(true);
    expect(await repos.actionConfigs.deleteActionConfig(defaultOrgId, created.id)).toBe(false);
  });

  it("deletes tasks when their case is removed", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const nina = list.find((c) => c.name === "Nina Castro")!;
    await db.$client.query(`DELETE FROM offboarding_cases WHERE id = '${nina.id}'`);
    const allTasks = await db.select().from(tasks);
    const ninaTasks = testSeedFixtures.cases.find((c) => c.name === "Nina Castro")!.tasks.length;
    expect(allTasks).toHaveLength(
      testSeedFixtures.cases.reduce((sum, item) => sum + item.tasks.length, 0) - ninaTasks,
    );
  });

  it("sets and reads a tracking code", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, marina.id);
    const task = detail!.tasks[0];

    const result = await repos.offboardings.setTrackingCode(defaultOrgId, task.id, "AB123456789BR");
    expect(result).toEqual({ id: task.id, trackingCode: "AB123456789BR" });

    const info = await repos.offboardings.getTaskTrackingCode(defaultOrgId, task.id);
    expect(info).toMatchObject({ id: task.id, trackingCode: "AB123456789BR" });
  });

  it("returns null when setting tracking code on unknown task", async () => {
    expect(
      await repos.offboardings.setTrackingCode(
        defaultOrgId,
        "00000000-0000-0000-0000-000000000000",
        "XX",
      ),
    ).toBeNull();
  });

  it("returns null when reading tracking code on unknown task", async () => {
    expect(
      await repos.offboardings.getTaskTrackingCode(
        defaultOrgId,
        "00000000-0000-0000-0000-000000000000",
      ),
    ).toBeNull();
  });

  it("returns tracked tasks (not done, with tracking code)", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, marina.id);
    const todoTask = detail!.tasks.find((t) => t.status === "todo")!;
    const doneTask = detail!.tasks.find((t) => t.status === "done")!;

    await repos.offboardings.setTrackingCode(defaultOrgId, todoTask.id, "TRACK001BR");
    await repos.offboardings.setTrackingCode(defaultOrgId, doneTask.id, "TRACK002BR");

    const tracked = await repos.offboardings.getTrackedTasks();
    const ids = tracked.map((t) => t.id);

    expect(ids).toContain(todoTask.id);
    expect(ids).not.toContain(doneTask.id);
  });

  it("includes trackingCode in updateTaskStatus result", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const nina = list.find((c) => c.name === "Nina Castro")!;
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, nina.id);
    const task = detail!.tasks.find((t) => t.status === "todo")!;

    await repos.offboardings.setTrackingCode(defaultOrgId, task.id, "TRACK003BR");
    const updated = await repos.offboardings.updateTaskStatus(defaultOrgId, task.id, "done");
    expect(updated?.trackingCode).toBe("TRACK003BR");
  });

  it("includes trackingCode in getOffboarding tasks", async () => {
    const list = await repos.offboardings.listOffboardings(defaultOrgId);
    const marina = list.find((c) => c.name === "Marina Lopes")!;
    const detail = await repos.offboardings.getOffboarding(defaultOrgId, marina.id);
    const task = detail!.tasks[0];

    await repos.offboardings.setTrackingCode(defaultOrgId, task.id, "TRACK004BR");

    const refreshed = await repos.offboardings.getOffboarding(defaultOrgId, marina.id);
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
    const members = await repos.team.listTeamMembers(defaultOrgId);

    expect(members.map(({ name, role }) => [name, role])).toEqual([
      ["Beatriz Castro", "admin"],
      ["Camila Rocha", "rh"],
      ["Diego Alves", "gestor"],
    ]);
    expect(members[0].id).toMatch(uuidPattern);
  });

  it("updates a member's role", async () => {
    const [, camila] = await repos.team.listTeamMembers(defaultOrgId);

    expect(await repos.team.updateTeamMemberRole(defaultOrgId, camila.id, "gestor")).toEqual({
      ...camila,
      role: "gestor",
    });
  });

  it("refuses to demote the last admin but allows it with another admin", async () => {
    const [admin, camila] = await repos.team.listTeamMembers(defaultOrgId);

    expect(await repos.team.updateTeamMemberRole(defaultOrgId, admin.id, "rh")).toBe("last-admin");
    expect(await repos.team.updateTeamMemberRole(defaultOrgId, admin.id, "admin")).toMatchObject({
      role: "admin",
    });

    await repos.team.updateTeamMemberRole(defaultOrgId, camila.id, "admin");

    expect(await repos.team.updateTeamMemberRole(defaultOrgId, admin.id, "rh")).toMatchObject({
      role: "rh",
    });
  });

  it("creates a member and lists it in order", async () => {
    const created = await repos.team.createTeamMember(defaultOrgId, {
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
    expect((await repos.team.listTeamMembers(defaultOrgId))[0].name).toBe("Ana Souza");
  });

  it("rejects a duplicate email", async () => {
    await expect(
      repos.team.createTeamMember(defaultOrgId, {
        name: "Dup",
        email: "camila.rocha@offboard.com",
        role: "rh",
      }),
    ).rejects.toThrow();
  });

  it("deletes by id and reports whether a row was removed", async () => {
    const [first] = await repos.team.listTeamMembers(defaultOrgId);

    expect(await repos.team.deleteTeamMember(defaultOrgId, first.id)).toBe(true);
    expect(await repos.team.deleteTeamMember(defaultOrgId, first.id)).toBe(false);
    expect(await repos.team.listTeamMembers(defaultOrgId)).toHaveLength(2);
  });
});

describe.skipIf(!url)("multi-tenant isolation", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const orgA = defaultOrgId;
  const orgB = "00000000-0000-0000-0000-0000000000b2";
  const missing = "00000000-0000-4000-8000-000000000000";

  let caseB: string;
  let taskB: string;
  let subtaskB: string;
  let equipmentB: string;
  let actionConfigB: string;
  let memberB: string;
  let subscriptionB: string;
  let invoiceB: string;

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
    await db
      .insert(organizations)
      .values({ id: orgB, name: "Org B", slug: "org-b" })
      .onConflictDoNothing();

    [{ id: caseB }] = await db
      .insert(offboardingCases)
      .values({
        orgId: orgB,
        name: "Case B",
        role: "Dev",
        department: "Eng",
        deadline: "2026-12-01",
      })
      .returning({ id: offboardingCases.id });
    [{ id: taskB }] = await db
      .insert(tasks)
      .values({ orgId: orgB, caseId: caseB, team: "TI", title: "Task B", phase: "d0", position: 0 })
      .returning({ id: tasks.id });
    [{ id: subtaskB }] = await db
      .insert(subtasks)
      .values({ orgId: orgB, taskId: taskB, title: "Sub B", position: 0 })
      .returning({ id: subtasks.id });
    [{ id: equipmentB }] = await db
      .insert(equipment)
      .values({
        orgId: orgB,
        caseId: caseB,
        item: "Laptop B",
        tag: "B-0001",
        returnMethod: "pickup",
        status: "scheduled",
      })
      .returning({ id: equipment.id });
    await db
      .insert(exitSurveys)
      .values({ orgId: orgB, caseId: caseB, npsScore: 10, responses: {}, topics: ["Cultura"] });
    await db.insert(integrations).values({ orgId: orgB, name: "Org B Slack", status: "connected" });
    [{ id: actionConfigB }] = await db
      .insert(actionConfigs)
      .values({ orgId: orgB, actionId: "webhook:org-b", phase: "d0" })
      .returning({ id: actionConfigs.id });
    [{ id: memberB }] = await db
      .insert(teamMembers)
      .values({ orgId: orgB, name: "Member B", email: "member.b@orgb.example", role: "admin" })
      .returning({ id: teamMembers.id });

    const [plan] = await db.select().from(plans).limit(1);
    [{ id: subscriptionB }] = await db
      .insert(subscriptions)
      .values({
        orgId: orgB,
        planId: plan.id,
        currentPeriodStart: "2026-11-01",
        currentPeriodEnd: "2026-12-01",
      })
      .returning({ id: subscriptions.id });
    [{ id: invoiceB }] = await db
      .insert(invoices)
      .values({
        orgId: orgB,
        subscriptionId: subscriptionB,
        amountCents: 1000,
        dueDate: "2026-11-15",
        abacatepayBillingId: "bill-org-b",
      })
      .returning({ id: invoices.id });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("scopes offboarding reads to the organization", async () => {
    const listA = await repos.offboardings.listOffboardings(orgA);
    const listB = await repos.offboardings.listOffboardings(orgB);

    expect(listA).toHaveLength(5);
    expect(listA.map((item) => item.name)).not.toContain("Case B");
    expect(listB.map((item) => item.name)).toEqual(["Case B"]);
    expect(await repos.offboardings.listOffboardingsWithTasks(orgB)).toHaveLength(1);
    expect(await repos.offboardings.listOffboardingsWithTasks(orgA)).toHaveLength(5);
    expect(await repos.offboardings.getOffboarding(orgA, caseB)).toBeNull();
    expect(await repos.offboardings.getOffboarding(orgB, caseB)).toMatchObject({ total: 1 });
  });

  it("stores created cases under the given organization", async () => {
    const data = {
      name: "Novo",
      role: "QA",
      department: "TI",
      deadline: "2026-12-10",
      email: "novo@example.com",
    };

    const created = await repos.offboardings.createOffboarding(orgA, data);

    const [bulk] = await repos.offboardings.bulkCreateOffboardings(orgB, [
      { name: "Em lote", department: "TI" },
    ]);

    const owner = async (id: string) =>
      (await db.select().from(offboardingCases).where(eq(offboardingCases.id, id)))[0].orgId;

    expect(await owner(created.id)).toBe(orgA);
    expect(await owner(bulk.id)).toBe(orgB);
    expect(await repos.offboardings.getOffboarding(orgB, created.id)).toBeNull();
  });

  it("rejects cross-organization task and subtask changes", async () => {
    expect(await repos.offboardings.getTaskPhase(orgA, taskB)).toBeNull();
    expect(await repos.offboardings.getTaskPhase(orgB, taskB)).toBe("d0");
    expect(await repos.offboardings.updateTaskStatus(orgA, taskB, "done")).toBeNull();
    expect(await repos.offboardings.toggleSubtask(orgA, subtaskB)).toBeNull();
    expect(await repos.offboardings.setTrackingCode(orgA, taskB, "XX")).toBeNull();
    expect(await repos.offboardings.getTaskTrackingCode(orgA, taskB)).toBeNull();

    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskB));
    expect(row).toMatchObject({ status: "todo", trackingCode: null });
    expect(await repos.offboardings.updateTaskStatus(orgB, taskB, "done")).toMatchObject({
      status: "done",
    });
    expect(await repos.offboardings.toggleSubtask(orgB, subtaskB)).toMatchObject({ done: true });
  });

  it("exposes task ownership to machine callers", async () => {
    await repos.offboardings.setTrackingCode(orgB, taskB, "ORGB123BR");

    const tracked = await repos.offboardings.getTrackedTasks();

    expect(tracked.find((task) => task.id === taskB)).toMatchObject({ orgId: orgB });
    expect(await repos.offboardings.getTaskOrgId(taskB)).toBe(orgB);
    expect(await repos.offboardings.getTaskOrgId(missing)).toBeNull();
  });

  it("scopes team members to the organization", async () => {
    expect((await repos.team.listTeamMembers(orgB)).map(({ id }) => id)).toEqual([memberB]);
    expect(await repos.team.listTeamMembers(orgA)).toHaveLength(3);

    const created = await repos.team.createTeamMember(orgB, {
      name: "Outro B",
      email: "other.b@orgb.example",
      role: "rh",
    });

    expect(await repos.team.listTeamMembers(orgB)).toHaveLength(2);
    expect(await repos.team.listTeamMembers(orgA)).toHaveLength(3);
    expect(await repos.team.deleteTeamMember(orgA, memberB)).toBe(false);
    expect(await repos.team.updateTeamMemberRole(orgA, memberB, "rh")).toBeNull();
    expect(await repos.team.updateTeamMemberRole(orgB, memberB, "rh")).toBe("last-admin");

    expect(await repos.team.deleteTeamMember(orgB, created.id)).toBe(true);
  });

  it("scopes equipment to the organization", async () => {
    expect((await repos.equipment.listEquipment(orgB)).map(({ tag }) => tag)).toEqual(["B-0001"]);
    expect((await repos.equipment.listEquipment(orgA)).map(({ tag }) => tag)).not.toContain(
      "B-0001",
    );
    expect(await repos.equipment.updateEquipmentStatus(orgA, equipmentB, "failed")).toBeNull();
    expect(await repos.equipment.updateEquipmentStatus(orgB, equipmentB, "failed")).toMatchObject({
      status: "failed",
    });
  });

  it("scopes exit surveys to the organization", async () => {
    expect((await repos.exitSurveys.listSurveys(orgB)).map(({ caseName }) => caseName)).toEqual([
      "Case B",
    ]);
    expect(await repos.exitSurveys.listSurveys(orgA)).not.toContainEqual(
      expect.objectContaining({ caseName: "Case B" }),
    );
    expect(await repos.exitSurveys.getSurveyAggregates(orgB)).toMatchObject({
      totalResponses: 1,
      completionRate: 100,
      topTopics: [{ label: "Cultura", value: 1 }],
    });
    expect((await repos.exitSurveys.getSurveyAggregates(orgA)).topTopics).not.toContainEqual({
      label: "Cultura",
      value: 1,
    });
    expect(await repos.exitSurveys.listComments(orgB)).toEqual([]);
    expect(await repos.exitSurveys.submitSurvey(orgA, caseB, 5, {}, [])).toBeNull();
    expect(await repos.exitSurveys.submitSurvey(orgB, caseB, 8, {}, [])).toMatchObject({
      npsScore: 8,
    });
    const [row] = await db.select().from(exitSurveys).where(eq(exitSurveys.caseId, caseB));
    expect(row.orgId).toBe(orgB);
    await repos.exitSurveys.submitSurvey(
      orgB,
      caseB,
      8,
      { comment: "Org B", anonymous: false },
      [],
    );
    expect(await repos.exitSurveys.listComments(orgB)).toMatchObject([{ comment: "Org B" }]);
    expect(await repos.exitSurveys.listComments(orgA)).not.toContainEqual(
      expect.objectContaining({ comment: "Org B" }),
    );
  });

  it("scopes integrations to the organization", async () => {
    expect(await repos.integrations.listIntegrations(orgB)).toEqual([
      { name: "Org B Slack", status: "connected" },
    ]);
    expect((await repos.integrations.listIntegrations(orgA)).map(({ name }) => name)).not.toContain(
      "Org B Slack",
    );

    await repos.integrations.upsertIntegration(orgB, "Org B Slack", "reconnect");
    await repos.integrations.upsertIntegration(orgB, "Org B Jira", "connected");

    expect(await repos.integrations.listIntegrations(orgB)).toEqual([
      { name: "Org B Jira", status: "connected" },
      { name: "Org B Slack", status: "reconnect" },
    ]);
    expect((await repos.integrations.listIntegrations(orgA)).map(({ name }) => name)).not.toContain(
      "Org B Jira",
    );
  });

  it("scopes action configs to the organization", async () => {
    expect((await repos.actionConfigs.listActionConfigs(orgB)).map(({ id }) => id)).toEqual([
      actionConfigB,
    ]);
    expect((await repos.actionConfigs.listActionConfigs(orgA)).map(({ id }) => id)).not.toContain(
      actionConfigB,
    );
    expect(
      (await repos.actionConfigs.getActionConfigsByPhase(orgB, "d0")).map(({ id }) => id),
    ).toEqual([actionConfigB]);
    expect(
      (await repos.actionConfigs.getActionConfigsByPhase(orgA, "d0")).map(({ id }) => id),
    ).not.toContain(actionConfigB);
    expect(await repos.actionConfigs.getActionConfig(orgA, actionConfigB)).toBeNull();
    expect(
      await repos.actionConfigs.updateActionConfig(orgA, actionConfigB, { enabled: false }),
    ).toBeNull();
    expect(await repos.actionConfigs.deleteActionConfig(orgA, actionConfigB)).toBe(false);

    const created = await repos.actionConfigs.createActionConfig(orgB, {
      actionId: "webhook:org-b-2",
      phase: "d0",
    });

    const [row] = await db.select().from(actionConfigs).where(eq(actionConfigs.id, created.id));
    expect(row.orgId).toBe(orgB);
    expect(await repos.actionConfigs.deleteActionConfig(orgB, actionConfigB)).toBe(true);
  });

  it("scopes billing to the organization", async () => {
    expect((await repos.billing.getSubscription(orgB))?.id).toBe(subscriptionB);
    expect((await repos.billing.getSubscription(orgA))?.id).not.toBe(subscriptionB);
    expect((await repos.billing.listInvoices(orgB)).map(({ id }) => id)).toEqual([invoiceB]);
    expect((await repos.billing.listInvoices(orgA)).map(({ id }) => id)).not.toContain(invoiceB);
    expect(await repos.billing.findOpenInvoice(orgA, subscriptionB)).toBeNull();
    expect(await repos.billing.findOpenInvoice(orgB, subscriptionB)).toMatchObject({
      id: invoiceB,
    });
    expect(await repos.billing.getInvoiceByBillingId(orgA, "bill-org-b")).toBeNull();
    expect(await repos.billing.getInvoiceByBillingId(orgB, "bill-org-b")).toMatchObject({
      id: invoiceB,
    });
    expect(await repos.billing.getSubscriptionById(subscriptionB)).toMatchObject({ orgId: orgB });

    await repos.billing.updateSubscription(orgA, subscriptionB, { status: "canceled" });
    expect((await repos.billing.getSubscription(orgB))?.status).toBe("active");
    await repos.billing.updateSubscription(orgB, subscriptionB, { status: "canceled" });
    expect((await repos.billing.getSubscription(orgB))?.status).toBe("canceled");

    expect(await repos.billing.updateInvoiceStatus(orgA, invoiceB, "paid")).toBeNull();
    expect(await repos.billing.updateInvoiceStatus(orgB, invoiceB, "paid")).toMatchObject({
      status: "paid",
    });

    const created = await repos.billing.createInvoice(orgB, subscriptionB, 500, "2026-12-15");
    const [row] = await db.select().from(invoices).where(eq(invoices.id, created.id));
    expect(row.orgId).toBe(orgB);
  });

  it("scopes employee settings to the organization", async () => {
    const settings = { email: "pessoa@orgb.example", plan: emptyEmployeePlan, revision: 0 };

    expect(await repos.employee.readSettings(orgA, caseB)).toBeNull();
    expect(await repos.employee.readSettings(orgB, caseB)).toMatchObject({ revision: 0 });
    expect(await repos.employee.saveSettings(orgA, caseB, settings)).toBe("missing-case");
    expect(await repos.employee.saveSettings(orgB, caseB, settings)).toBe("email-set");

    const [access] = await db.select().from(employeeAccess).where(eq(employeeAccess.caseId, caseB));
    expect(access.orgId).toBe(orgB);
    expect(await repos.employee.saveSettings(orgA, caseB, { ...settings, revision: 1 })).toBe(
      "missing-case",
    );
  });
});

describe.skipIf(!url)("automation rules", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const orgA = defaultOrgId;
  const orgB = "00000000-0000-0000-0000-0000000000b3";

  const rule = {
    name: "Rule",
    trigger: "task.status_changed" as const,
    conditions: { to: "done" },
    actions: [{ type: "slack" as const }],
  };

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });
  });

  beforeEach(async () => {
    await db.delete(automationRules);
    await db
      .insert(organizations)
      .values([
        { id: orgA, name: "Default", slug: "default" },
        { id: orgB, name: "Org B3", slug: "org-b3" },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(automationRules);
    await db.$client.end();
  });

  it("creates, reads, updates, lists and deletes rules scoped by org", async () => {
    const created = await repos.automationRules.createRule(orgA, rule);
    expect(created.id).toMatch(uuidPattern);
    expect(created.enabled).toBe(true);
    expect(created.sourceRef).toBeNull();

    expect((await repos.automationRules.listRules(orgA)).map(({ id }) => id)).toEqual([created.id]);
    expect(await repos.automationRules.listRules(orgB)).toEqual([]);
    expect((await repos.automationRules.getRule(orgA, created.id))?.name).toBe("Rule");
    expect(await repos.automationRules.getRule(orgB, created.id)).toBeNull();

    const updated = await repos.automationRules.updateRule(orgA, created.id, { name: "Renamed" });
    expect(updated?.name).toBe("Renamed");
    expect(await repos.automationRules.updateRule(orgB, created.id, { name: "X" })).toBeNull();

    expect(await repos.automationRules.deleteRule(orgB, created.id)).toBe(false);
    expect(await repos.automationRules.deleteRule(orgA, created.id)).toBe(true);
    expect(await repos.automationRules.deleteRule(orgA, created.id)).toBe(false);
  });

  it("returns only enabled rules for the org and trigger", async () => {
    const match = await repos.automationRules.createRule(orgA, rule);
    await repos.automationRules.createRule(orgA, { ...rule, enabled: false });
    await repos.automationRules.createRule(orgA, { ...rule, trigger: "correios.delivered" });
    await repos.automationRules.createRule(orgB, rule);

    const rules = await repos.automationRules.getEnabledRulesByTrigger(orgA, "task.status_changed");
    expect(rules.map(({ id }) => id)).toEqual([match.id]);
  });

  it("returns enabled cron rules across all orgs with their org id", async () => {
    const cron = { ...rule, trigger: "schedule.cron" as const, cronSchedule: "0 9 * * *" };
    const a = await repos.automationRules.createRule(orgA, cron);
    const b = await repos.automationRules.createRule(orgB, cron);
    await repos.automationRules.createRule(orgA, { ...cron, enabled: false });
    await repos.automationRules.createRule(orgA, rule);

    const rules = await repos.automationRules.getAllCronRules();
    expect(rules.every(({ cronSchedule }) => cronSchedule === "0 9 * * *")).toBe(true);
    expect(rules.map(({ id, orgId }) => [id, orgId]).sort()).toEqual(
      [
        [a.id, orgA],
        [b.id, orgB],
      ].sort(),
    );
  });

  it("creates a rule with source_ref", async () => {
    const created = await repos.automationRules.upsertBySourceRef(orgA, "ref-1", rule);
    expect(created.sourceRef).toBe("ref-1");
    expect(await repos.automationRules.listRules(orgA)).toHaveLength(1);
  });

  it("upserts by source_ref within the same org", async () => {
    const first = await repos.automationRules.upsertBySourceRef(orgA, "ref-1", rule);

    const second = await repos.automationRules.upsertBySourceRef(orgA, "ref-1", {
      ...rule,
      name: "Changed",
      enabled: false,
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Changed");
    expect(second.enabled).toBe(false);
    expect(await repos.automationRules.listRules(orgA)).toHaveLength(1);
  });

  it("allows same source_ref in different orgs", async () => {
    const a = await repos.automationRules.upsertBySourceRef(orgA, "ref-1", rule);
    const b = await repos.automationRules.upsertBySourceRef(orgB, "ref-1", rule);

    expect(a.id).not.toBe(b.id);
    expect(await db.select().from(automationRules)).toHaveLength(2);
  });

  it("deletes by source_ref within the org only", async () => {
    await repos.automationRules.upsertBySourceRef(orgA, "ref-1", rule);

    expect(await repos.automationRules.deleteBySourceRef(orgB, "ref-1")).toBe(false);
    expect(await repos.automationRules.deleteBySourceRef(orgA, "ref-1")).toBe(true);
    expect(await repos.automationRules.deleteBySourceRef(orgA, "ref-1")).toBe(false);
  });
});
