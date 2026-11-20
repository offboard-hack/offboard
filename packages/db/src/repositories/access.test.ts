import { beforeEach, describe, expect, it } from "vitest";
import { beneficiaries, teamMembers } from "../schema/index.ts";
import { DrizzleAccessRepository } from "./access.ts";
import { createTestDb } from "./test-db.ts";

describe("DrizzleAccessRepository", () => {
  let repo: DrizzleAccessRepository;

  beforeEach(async () => {
    const db = await createTestDb();
    repo = new DrizzleAccessRepository(db);
    await db
      .insert(beneficiaries)
      .values({ name: "Ana", plan: "Pro", status: "active", accessUntil: "2026-12-31" });
    await db
      .insert(teamMembers)
      .values({ name: "Bia", role: "Admin", accessScope: "all", securityStatus: "ok" });
  });

  it("lists beneficiaries", async () => {
    expect(await repo.listBeneficiaries()).toEqual([
      expect.objectContaining({
        name: "Ana",
        plan: "Pro",
        status: "active",
        accessUntil: "2026-12-31",
      }),
    ]);
  });

  it("lists team members", async () => {
    expect(await repo.listTeamMembers()).toEqual([
      expect.objectContaining({
        name: "Bia",
        role: "Admin",
        accessScope: "all",
        securityStatus: "ok",
      }),
    ]);
  });
});
