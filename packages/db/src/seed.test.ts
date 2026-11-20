import { count } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./repositories/test-db.ts";
import {
  beneficiaries,
  checklistRules,
  equipment,
  integrations,
  offboardingCases,
  plans,
  tasks,
  teamMembers,
} from "./schema/index.ts";
import { seed } from "./seed.ts";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

async function counts(db: TestDb) {
  const tables = [
    offboardingCases,
    tasks,
    equipment,
    integrations,
    beneficiaries,
    teamMembers,
    plans,
    checklistRules,
  ];

  const result: number[] = [];

  for (const table of tables) {
    const [row] = await db.select({ value: count() }).from(table);

    result.push(row!.value);
  }

  return result;
}

describe("seed", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("populates every table", async () => {
    await seed(db);
    const result = await counts(db);
    expect(result.every((value) => value > 0)).toBe(true);
    expect(result.slice(0, 1)).toEqual([5]);
  });

  it("maps statuses and prices", async () => {
    await seed(db);
    const statuses = new Set((await db.select().from(tasks)).map((row) => row.status));
    expect([...statuses].sort()).toEqual(["done", "in_progress", "todo"]);
    const equipmentStatuses = (await db.select().from(equipment)).map((row) => row.status);
    expect(equipmentStatuses).toContain("with_person");
    const silver = (await db.select().from(plans)).find((row) => row.name === "Silver");
    expect(silver!.priceCents).toBe(14900);
  });

  it("is idempotent", async () => {
    await seed(db);
    const first = await counts(db);
    await seed(db);
    expect(await counts(db)).toEqual(first);
  });
});
