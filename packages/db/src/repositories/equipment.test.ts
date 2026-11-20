import { beforeEach, describe, expect, it } from "vitest";
import { equipment } from "../schema/index.ts";
import { DrizzleEquipmentRepository } from "./equipment.ts";
import { createTestDb } from "./test-db.ts";

describe("DrizzleEquipmentRepository", () => {
  let repo: DrizzleEquipmentRepository;

  beforeEach(async () => {
    const db = await createTestDb();
    repo = new DrizzleEquipmentRepository(db);
    const base = { item: "Laptop", person: "Ana", method: "courier" };
    await db.insert(equipment).values([
      { ...base, tag: "A", status: "scheduled", scheduledDate: "2026-12-01" },
      { ...base, tag: "B", status: "with_person" },
      { ...base, tag: "C", status: "received" },
      { ...base, tag: "D", status: "failed" },
      { ...base, tag: "E", status: "inventory" },
      { ...base, tag: "F", status: "transit" },
    ]);
  });

  it("lists all with mapped statuses", async () => {
    const rows = await repo.list();
    expect(rows.map((r) => r.status)).toEqual([
      "scheduled",
      "withPerson",
      "received",
      "failed",
      "inventory",
      "transit",
    ]);
    expect(rows[0]?.scheduledDate).toBe("2026-12-01");
    expect(rows[1]?.scheduledDate).toBeNull();
  });

  it("filters by status", async () => {
    expect((await repo.list("scheduled")).map((r) => r.tag)).toEqual(["A"]);
    expect((await repo.list("withPerson")).map((r) => r.tag)).toEqual(["B"]);
  });
});
