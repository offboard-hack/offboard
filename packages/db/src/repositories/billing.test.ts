import { beforeEach, describe, expect, it } from "vitest";
import { plans } from "../schema/index.ts";
import { DrizzleBillingRepository } from "./billing.ts";
import { createTestDb } from "./test-db.ts";

describe("DrizzleBillingRepository", () => {
  let repo: DrizzleBillingRepository;

  beforeEach(async () => {
    const db = await createTestDb();
    repo = new DrizzleBillingRepository(db);
    await db.insert(plans).values([
      { name: "Pro", priceCents: 4900, activeLicenses: 3, capacity: 10, costCenter: "eng" },
      { name: "Basic", priceCents: 1900, capacity: 5, costCenter: "ops" },
    ]);
  });

  it("lists plans with integer prices ordered by price", async () => {
    const rows = await repo.listPlans();
    expect(rows.map((r) => r.name)).toEqual(["Basic", "Pro"]);
    expect(rows[0]).toEqual(expect.objectContaining({ priceCents: 1900, activeLicenses: 0 }));
    expect(Number.isInteger(rows[1]?.priceCents)).toBe(true);
  });
});
