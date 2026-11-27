import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  benefitInvoices,
  benefitPolicies,
  copayProducts,
  defaultOrgId,
  offboardingCases,
  organizations,
  plans,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import { addMonths, saoPauloDate } from "../../shared/sao-paulo-date.js";

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
    await db.delete(benefitInvoices);
    await db.delete(copayProducts);

    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.delete(benefitAssignments);
    await db.delete(benefitPolicies);
    await db.delete(benefitInvoices);
    await db.delete(copayProducts);

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

  it("makes a fresh assignment immediately eligible for a co-pay checkout", async () => {
    const { low } = await twoPlans();
    const profileId = await profile();

    await repos.benefits.upsertAssignment({
      orgId: defaultOrgId,
      profileId,
      assignedPlanId: low.id,
      effectivePlanId: low.id,
      source: "default",
      validUntil: "2099-12-31",
    });

    expect(await repos.careerPlan.startCopayCheckout(profileId, new Date())).not.toBeNull();
    expect(await repos.careerPlan.startCopayCheckout(profileId, new Date())).toBeNull();
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

  describe("applying the policy", () => {
    const person = { department: "Engineering", role: "Analista" };
    const elsewhere = { department: "Vendas", role: "Vendedor" };

    const today = saoPauloDate(new Date());
    const expiry = (months: number) => addMonths(today, months);

    async function policy(months = 6) {
      const { low, high } = await twoPlans();

      await repos.benefits.savePolicy(defaultOrgId, {
        defaultPlanId: low.id,
        benefitDurationMonths: months,
        rules: [rule(high.id)],
      });

      return { low, high };
    }

    async function assignmentOf(profileId: string) {
      const [row] = await db
        .select()
        .from(benefitAssignments)
        .where(eq(benefitAssignments.profileId, profileId));

      return row;
    }

    it("assigns the default plan when no rule matches", async () => {
      const { low } = await policy();
      const profileId = await profile();

      expect(
        await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, elsewhere, today),
      ).toBe(true);
      expect(await assignmentOf(profileId)).toMatchObject({
        orgId: defaultOrgId,
        source: "default",
        assignedPlanId: low.id,
        effectivePlanId: low.id,
        validUntil: expiry(6),
      });
    });

    it("assigns the plan of the matching rule over the default", async () => {
      const { high } = await policy(12);
      const profileId = await profile();

      await repos.benefits.applyBenefitPolicy(
        defaultOrgId,
        profileId,
        { department: "engineering ", role: "Analista" },
        today,
      );

      expect(await assignmentOf(profileId)).toMatchObject({
        source: "rule",
        assignedPlanId: high.id,
        effectivePlanId: high.id,
        validUntil: expiry(12),
      });
    });

    it("matches rules by role", async () => {
      const { low, high } = await twoPlans();

      await repos.benefits.savePolicy(defaultOrgId, {
        defaultPlanId: low.id,
        benefitDurationMonths: 3,
        rules: [
          { id: "r2", field: "role", operator: "contains", value: "gerente", planId: high.id },
        ],
      });
      const profileId = await profile();

      await repos.benefits.applyBenefitPolicy(
        defaultOrgId,
        profileId,
        { department: "Vendas", role: "Gerente de Contas" },
        today,
      );

      expect(await assignmentOf(profileId)).toMatchObject({
        source: "rule",
        assignedPlanId: high.id,
      });
    });

    it("assigns only a matching rule when the policy has no default plan", async () => {
      const { high } = await twoPlans();

      await repos.benefits.savePolicy(defaultOrgId, {
        defaultPlanId: null,
        benefitDurationMonths: 3,
        rules: [rule(high.id)],
      });
      const profileId = await profile();

      expect(
        await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, elsewhere, today),
      ).toBe(false);
      expect(await assignmentOf(profileId)).toBeUndefined();

      await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, person, today);

      expect(await assignmentOf(profileId)).toMatchObject({
        source: "rule",
        assignedPlanId: high.id,
      });
    });

    it("preserves a manual assignment", async () => {
      const { low } = await policy();
      const profileId = await profile();

      await repos.benefits.upsertAssignment({
        orgId: defaultOrgId,
        profileId,
        assignedPlanId: low.id,
        effectivePlanId: low.id,
        source: "manual",
        validUntil: "2030-01-01",
      });

      expect(await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, person, today)).toBe(
        false,
      );
      expect(await assignmentOf(profileId)).toMatchObject({
        source: "manual",
        assignedPlanId: low.id,
        validUntil: "2030-01-01",
      });
    });

    it("assigns nothing without a policy or without a plan to give", async () => {
      const profileId = await profile();

      expect(await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, person, today)).toBe(
        false,
      );
      expect(await assignmentOf(profileId)).toBeUndefined();

      await repos.benefits.savePolicy(defaultOrgId, {
        defaultPlanId: null,
        benefitDurationMonths: 6,
        rules: [],
      });

      expect(await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, person, today)).toBe(
        false,
      );
      expect(await assignmentOf(profileId)).toBeUndefined();
    });

    it("keeps valid_until when the same plan is applied again", async () => {
      await policy();
      const profileId = await profile();

      expect(await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, person, today)).toBe(
        true,
      );

      await db
        .update(benefitAssignments)
        .set({ validUntil: "2026-01-01" })
        .where(eq(benefitAssignments.profileId, profileId));

      expect(await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, person, today)).toBe(
        false,
      );
      expect(await assignmentOf(profileId)).toMatchObject({ validUntil: "2026-01-01" });
    });

    it("never changes an existing automatic assignment, live or expired", async () => {
      const { low, high } = await policy();
      const live = await profile();
      const expired = await profile();

      await repos.benefits.applyBenefitPolicy(defaultOrgId, live, elsewhere, today);
      await repos.benefits.applyBenefitPolicy(defaultOrgId, expired, elsewhere, today);
      await db
        .update(benefitAssignments)
        .set({ validUntil: "2026-01-01" })
        .where(eq(benefitAssignments.profileId, expired));

      expect(await repos.benefits.applyBenefitPolicy(defaultOrgId, live, person, today)).toBe(
        false,
      );
      expect(await repos.benefits.applyBenefitPolicy(defaultOrgId, expired, person, today)).toBe(
        false,
      );
      expect(await assignmentOf(live)).toMatchObject({
        source: "default",
        assignedPlanId: low.id,
        validUntil: expiry(6),
      });
      expect(await assignmentOf(expired)).toMatchObject({
        source: "default",
        assignedPlanId: low.id,
        validUntil: "2026-01-01",
      });
      expect(high.id).not.toBe(low.id);
    });

    it("never applies the policy of another organization", async () => {
      await policy();
      const otherOrg = crypto.randomUUID();

      await db.insert(organizations).values({ id: otherOrg, slug: otherOrg, name: "Outra Org" });

      try {
        const [foreign] = await db
          .insert(talentProfiles)
          .values({
            orgId: otherOrg,
            personalEmail: `pessoa-${crypto.randomUUID()}@exemplo.com`,
            name: "Pessoa de Outra Org",
            sponsoredUntil: "2099-12-31",
          })
          .returning({ id: talentProfiles.id });

        const ours = await profile();

        expect(await repos.benefits.applyBenefitPolicy(otherOrg, foreign.id, person, today)).toBe(
          false,
        );
        expect(await repos.benefits.applyBenefitPolicy(otherOrg, ours, person, today)).toBe(false);
        expect(
          await repos.benefits.applyBenefitPolicy(defaultOrgId, foreign.id, person, today),
        ).toBe(false);
        expect(await db.select().from(benefitAssignments)).toEqual([]);
      } finally {
        await db.delete(talentProfiles).where(eq(talentProfiles.orgId, otherOrg));
        await db.delete(organizations).where(eq(organizations.id, otherOrg));
      }
    });

    it("finds the person of a case only while the org has a policy and the profile has no row", async () => {
      const [created] = await db
        .insert(offboardingCases)
        .values({
          orgId: defaultOrgId,
          name: "Caso",
          role: "Analista",
          department: "Engineering",
          deadline: "2027-01-01",
        })
        .returning({ id: offboardingCases.id });

      try {
        const profileId = await profile();
        const pending = () => repos.benefits.pendingPerson(defaultOrgId, created.id, profileId);

        expect(await pending()).toBeUndefined();

        await policy();

        expect(await pending()).toEqual(person);
        expect(
          await repos.benefits.pendingPerson(crypto.randomUUID(), created.id, profileId),
        ).toBeUndefined();

        await repos.benefits.applyBenefitPolicy(defaultOrgId, profileId, person, today);

        expect(await pending()).toBeUndefined();
      } finally {
        await db.delete(offboardingCases).where(eq(offboardingCases.id, created.id));
      }
    });
  });

  async function assign(
    planId: string,
    extra: { validUntil?: string; copaySubscriptionId?: string; effectivePlanId?: string } = {},
  ) {
    const profileId = await profile();

    await db.insert(benefitAssignments).values({
      orgId: defaultOrgId,
      profileId,
      assignedPlanId: planId,
      effectivePlanId: extra.effectivePlanId ?? planId,
      source: "manual",
      validUntil: extra.validUntil ?? "2099-12-31",
      copaySubscriptionId: extra.copaySubscriptionId,
    });

    return profileId;
  }

  it("finds a copay product by plan pair", async () => {
    const { low, high } = await twoPlans();

    await db
      .insert(copayProducts)
      .values({ fromPlanId: low.id, toPlanId: high.id, abacatePayProductId: "prod_1" });

    expect(await repos.benefits.getCopayProduct(low.id, high.id)).toEqual({
      abacatePayProductId: "prod_1",
    });
    expect(await repos.benefits.getCopayProduct(high.id, low.id)).toBeNull();
  });

  it("finds an assignment by profile", async () => {
    const { low } = await twoPlans();
    const profileId = await assign(low.id, { copaySubscriptionId: "subs_1" });

    expect(await repos.benefits.findAssignmentByProfile(profileId)).toEqual({
      id: expect.any(String),
      assignedPlanId: low.id,
      effectivePlanId: low.id,
      copaySubscriptionId: "subs_1",
      validUntil: "2099-12-31",
    });
    expect(await repos.benefits.findAssignmentByProfile(crypto.randomUUID())).toBeNull();
  });

  it("updates copay state", async () => {
    const { low, high } = await twoPlans();
    const profileId = await assign(low.id);

    await repos.benefits.updateCopayState(profileId, {
      effectivePlanId: high.id,
      copaySubscriptionId: "subs_1",
    });

    expect(await repos.benefits.findAssignmentByProfile(profileId)).toMatchObject({
      effectivePlanId: high.id,
      copaySubscriptionId: "subs_1",
    });

    await repos.benefits.updateCopayState(profileId, {
      effectivePlanId: low.id,
      copaySubscriptionId: null,
    });

    expect(await repos.benefits.findAssignmentByProfile(profileId)).toMatchObject({
      effectivePlanId: low.id,
      copaySubscriptionId: null,
    });
  });

  it("finds an assignment by copay subscription", async () => {
    const { low, high } = await twoPlans();

    const profileId = await assign(low.id, {
      copaySubscriptionId: "subs_1",
      effectivePlanId: high.id,
    });

    expect(await repos.benefits.findAssignmentBySubscription("subs_1")).toEqual({
      profileId,
      assignedPlanId: low.id,
      effectivePlanId: high.id,
      validUntil: "2099-12-31",
    });
    expect(await repos.benefits.findAssignmentBySubscription("subs_x")).toBeNull();
  });

  it("tallies active assignments by assigned plan price", async () => {
    const { low, high } = await twoPlans();

    expect(await repos.benefits.tallyActiveAssignments(defaultOrgId)).toEqual({
      totalCents: 0,
      count: 0,
    });

    await assign(low.id);
    await assign(low.id);
    await assign(high.id, { effectivePlanId: low.id });
    await assign(high.id, { validUntil: "2000-01-01" });

    expect(await repos.benefits.tallyActiveAssignments(defaultOrgId)).toEqual({
      totalCents: low.perPersonPriceCents * 2 + high.perPersonPriceCents,
      count: 3,
    });
  });

  it("creates a benefit invoice idempotently", async () => {
    const created = await repos.benefits.createBenefitInvoice(defaultOrgId, "2026-12", 5000);

    expect(created).toEqual({
      id: expect.any(String),
      period: "2026-12",
      totalCents: 5000,
      status: "draft",
    });
    expect(await repos.benefits.createBenefitInvoice(defaultOrgId, "2026-12", 9999)).toEqual(
      created,
    );
  });

  it("lists benefit invoices by period descending", async () => {
    await repos.benefits.createBenefitInvoice(defaultOrgId, "2026-11", 100);
    await repos.benefits.createBenefitInvoice(defaultOrgId, "2026-12", 200);

    const rows = await repos.benefits.listBenefitInvoices(defaultOrgId);

    expect(rows.map((row) => row.period)).toEqual(["2026-12", "2026-11"]);
    expect(rows[0]).toMatchObject({ totalCents: 200, status: "draft" });
  });
});
