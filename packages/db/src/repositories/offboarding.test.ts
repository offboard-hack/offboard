import { beforeEach, describe, expect, it } from "vitest";
import { tasks } from "../schema/index.ts";
import { DrizzleOffboardingRepository } from "./offboarding.ts";
import { createTestDb } from "./test-db.ts";

const input = { name: "Ana", role: "Dev", department: "Eng", deadline: "2026-12-01" };

describe("DrizzleOffboardingRepository", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let repo: DrizzleOffboardingRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repo = new DrizzleOffboardingRepository(db);
  });

  it("creates and gets a case with mapped task statuses", async () => {
    const { id } = await repo.create(input);
    await db.insert(tasks).values([
      { caseId: id, title: "a", team: "IT", status: "in_progress" },
      { caseId: id, title: "b", team: "IT", status: "done" },
    ]);
    const found = await repo.get(id);
    expect(found).toMatchObject({ id, ...input, completed: 1, total: 2 });
    expect(found?.tasks.map((t) => t.status).sort()).toEqual(["done", "inProgress"]);
  });

  it("returns null for unknown id", async () => {
    expect(await repo.get("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("lists summaries with completed and total", async () => {
    const [a, b] = await repo.createMany([input, { ...input, name: "Bia" }]);
    await db.insert(tasks).values([
      { caseId: a!.id, title: "x", team: "IT", status: "done" },
      { caseId: a!.id, title: "y", team: "IT" },
    ]);
    const list = await repo.list();
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.id === a!.id)).toMatchObject({ completed: 1, total: 2 });
    expect(list.find((c) => c.id === b!.id)).toMatchObject({ completed: 0, total: 0 });
  });

  it("createMany with no inputs returns empty", async () => {
    expect(await repo.createMany([])).toEqual([]);
  });

  it("deletes a case and cascades tasks", async () => {
    const { id } = await repo.create(input);
    await db.insert(tasks).values({ caseId: id, title: "x", team: "IT" });
    await repo.delete(id);
    expect(await repo.get(id)).toBeNull();
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
});
