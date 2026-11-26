import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  benefitPolicies,
  defaultOrgId,
  plans,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("benefit repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await db.delete(benefitAssignments);
    await db.delete(benefitPolicies);

    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.delete(benefitAssignments);
    await db.delete(benefitPolicies);

    await db.$client.end();
  });

  async function twoPlans() {
    const rows = await db.select().from(plans).orderBy(asc(plans.monthlyPriceCents));

    return { low: rows[0], high: rows[rows.length - 1] };
  }

  async function profile() {
    const [row] = await db
      .insert(talentProfiles)
      .values({
        orgId: defaultOrgId,
        personalEmail: `pessoa-${crypto.randomUUID()}@exemplo.com`,
        name: "Pessoa Teste",
        sponsoredUntil: "2099-12-31",
      })
      .returning({ id: talentProfiles.id });

    return row.id;
  }

  const rule = (planId: string) => ({
    id: "r1",
    field: "department" as const,
    operator: "equals" as const,
    value: "Engineering",
    planId,
  });

  it("checks that a profile belongs to the org", async () => {
    const profileId = await profile();

    expect(await repos.benefits.profileInOrg(defaultOrgId, profileId)).toBe(true);
    expect(await repos.benefits.profileInOrg(crypto.randomUUID(), profileId)).toBe(false);
    expect(await repos.benefits.profileInOrg(defaultOrgId, crypto.randomUUID())).toBe(false);
  });

  it("returns null policy when the org has none", async () => {
    expect(await repos.benefits.getPolicy(defaultOrgId)).toBeNull();
  });

  it("saves and reads a policy", async () => {
    const { low } = await twoPlans();
    const input = { defaultPlanId: low.id, benefitDurationMonths: 3, rules: [rule(low.id)] };

    await repos.benefits.savePolicy(defaultOrgId, input);

    expect(await repos.benefits.getPolicy(defaultOrgId)).toEqual(input);
  });

  it("updates an existing policy on save", async () => {
    const { low, high } = await twoPlans();

    await repos.benefits.savePolicy(defaultOrgId, {
      defaultPlanId: low.id,
      benefitDurationMonths: 3,
      rules: [],
    });
    await repos.benefits.savePolicy(defaultOrgId, {
      defaultPlanId: high.id,
      benefitDurationMonths: 12,
      rules: [rule(high.id)],
    });

    expect(await repos.benefits.getPolicy(defaultOrgId)).toEqual({
      defaultPlanId: high.id,
      benefitDurationMonths: 12,
      rules: [rule(high.id)],
    });
  });

  it("lists no assignments for an org without any", async () => {
    expect(await repos.benefits.listAssignments(defaultOrgId)).toEqual([]);
  });

  it("lists created assignments with names", async () => {
    const { low, high } = await twoPlans();
    const profileId = await profile();

    const { id } = await repos.benefits.upsertAssignment({
      orgId: defaultOrgId,
      profileId,
      assignedPlanId: high.id,
      effectivePlanId: low.id,
      source: "rule",
      validUntil: "2027-01-31",
    });

    expect(await repos.benefits.listAssignments(defaultOrgId)).toEqual([
      {
        id,
        profileId,
        profileName: "Pessoa Teste",
        assignedPlanName: high.name,
        effectivePlanName: low.name,
        source: "rule",
        validUntil: "2027-01-31",
      },
    ]);
  });

  it("updates the assignment when the profile already has one", async () => {
    const { low, high } = await twoPlans();
    const profileId = await profile();
    const base = { orgId: defaultOrgId, profileId, validUntil: "2027-01-31" };

    const first = await repos.benefits.upsertAssignment({
      ...base,
      assignedPlanId: low.id,
      effectivePlanId: low.id,
      source: "default",
    });

    const second = await repos.benefits.upsertAssignment({
      ...base,
      assignedPlanId: high.id,
      effectivePlanId: high.id,
      source: "manual",
    });

    const rows = await repos.benefits.listAssignments(defaultOrgId);

    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ effectivePlanName: high.name, source: "manual" });
  });

  it("returns null benefit when there is no assignment", async () => {
    expect(await repos.benefits.getEffectiveBenefit(await profile(), "2026-11-26")).toBeNull();
  });

  it("returns the effective plan features while valid", async () => {
    const { high } = await twoPlans();
    const profileId = await profile();

    await repos.benefits.upsertAssignment({
      orgId: defaultOrgId,
      profileId,
      assignedPlanId: high.id,
      effectivePlanId: high.id,
      source: "default",
      validUntil: "2026-11-26",
    });

    expect(await repos.benefits.getEffectiveBenefit(profileId, "2026-11-26")).toEqual({
      planName: high.name,
      aiApplyDailyLimit: high.aiApplyDailyLimit,
      aiApplyPriority: high.aiApplyPriority,
      detailedScore: high.detailedScore,
      validUntil: "2026-11-26",
      source: "default",
    });
  });

  it("returns null benefit once expired", async () => {
    const { low } = await twoPlans();
    const profileId = await profile();

    await repos.benefits.upsertAssignment({
      orgId: defaultOrgId,
      profileId,
      assignedPlanId: low.id,
      effectivePlanId: low.id,
      source: "default",
      validUntil: "2026-11-25",
    });

    expect(await repos.benefits.getEffectiveBenefit(profileId, "2026-11-26")).toBeNull();
  });

  it("maps every plan to its per-person price", async () => {
    const rows = await db.select().from(plans);
    const map = await repos.benefits.planPriceMap();

    expect(map.size).toBe(rows.length);

    for (const row of rows) expect(map.get(row.id)).toBe(row.perPersonPriceCents);
  });
});
