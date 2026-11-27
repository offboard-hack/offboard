import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  defaultOrgId,
  employeeAccess,
  offboardingCases,
  organizations,
  plans,
  subscriptions,
  talentSubscriptions,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { emptyEmployeePlan } from "@offboard/employee";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const now = new Date("2026-11-26T15:00:00Z");

describe.skipIf(!url)("career plan repository", () => {
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
    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.delete(benefitAssignments);
    await db.$client.end();
  });

  async function onPlan(
    slug: string,
    status: (typeof subscriptions.$inferInsert)["status"] = "active",
  ) {
    const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug));

    await db
      .update(subscriptions)
      .set({ planId: plan.id, status })
      .where(eq(subscriptions.orgId, defaultOrgId));
  }

  async function profile(deadline: string, sponsoredUntil = "2099-12-31") {
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    await db.update(offboardingCases).set({ deadline }).where(eq(offboardingCases.id, first.id));

    const created = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId: first.id,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil,
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    return { profileId: created.id, caseId: first.id };
  }

  const grant = (caseId: string, email: string | null, careerSponsoredUntil?: string) =>
    db.insert(employeeAccess).values({
      caseId,
      orgId: defaultOrgId,
      email,
      plan: emptyEmployeePlan,
      careerSponsoredUntil,
    });

  it("uses the profile's own date when the person does not sign in as a collaborator", async () => {
    await onPlan("platinum-premium");

    const { profileId, caseId } = await profile("2026-11-30", "2026-12-20");

    expect(await repos.careerPlan.plan(profileId, now)).toEqual({
      company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: "2026-12-20" },
      individual: null,
      benefit: null,
      aiApply: { allowedBy: "company", dailyLimit: 10 },
      upgrade: { offered: true, priceCents: 7900, dailyLimit: 10 },
    });

    await grant(caseId, null, "2030-01-01");

    expect((await repos.careerPlan.plan(profileId, now))?.company.sponsoredUntil).toBe(
      "2026-12-20",
    );
  });

  it("sponsors a collaborator until three calendar months after the deadline by default", async () => {
    const { profileId, caseId } = await profile("2026-11-30");

    await grant(caseId, "bia@example.com");

    expect((await repos.careerPlan.plan(profileId, now))?.company.sponsoredUntil).toBe(
      "2027-02-28",
    );

    await db
      .update(employeeAccess)
      .set({ careerSponsoredUntil: "2026-12-15" })
      .where(eq(employeeAccess.caseId, caseId));

    expect((await repos.careerPlan.plan(profileId, now))?.company.sponsoredUntil).toBe(
      "2026-12-15",
    );
  });

  it("reads the company's latest subscription and the person's Carreira Pro", async () => {
    const { profileId } = await profile("2026-11-30");

    await onPlan("gold", "canceled");
    await db.insert(talentSubscriptions).values({
      profileId,
      status: "active",
      currentPeriodEnd: "2026-12-26",
      createdAt: now,
      updatedAt: now,
    });

    expect(await repos.careerPlan.plan(profileId, now)).toEqual({
      company: { name: null, includesAiApply: false, sponsoredUntil: "2099-12-31" },
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: "2026-12-26",
        cancelable: false,
      },
      benefit: null,
      aiApply: { allowedBy: "individual", dailyLimit: 10 },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
    });
    expect(await repos.careerPlan.allowedBy(profileId, now)).toEqual({
      allowedBy: "individual",
      dailyLimit: 10,
    });

    const [top] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.slug, "platinum-premium"));

    await db.insert(subscriptions).values({
      orgId: defaultOrgId,
      planId: top.id,
      status: "trialing",
      currentPeriodStart: "2026-11-01",
      currentPeriodEnd: "2026-12-01",
      createdAt: new Date("2099-01-01T00:00:00Z"),
    });

    expect(await repos.careerPlan.allowedBy(profileId, now)).toEqual({
      allowedBy: "company",
      dailyLimit: 10,
    });

    await db.delete(subscriptions).where(eq(subscriptions.orgId, defaultOrgId));

    expect((await repos.careerPlan.plan(profileId, now))?.company.name).toBeNull();
  });

  it("ignores another organization's subscription", async () => {
    const { profileId } = await profile("2026-11-30");

    const [plan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.slug, "platinum-premium"));

    await db.delete(subscriptions).where(eq(subscriptions.orgId, defaultOrgId));

    const [other] = await db
      .insert(organizations)
      .values({ name: "Outra", slug: `outra-${randomUUID()}` })
      .returning({ id: organizations.id });

    await db.insert(subscriptions).values({
      orgId: other.id,
      planId: plan.id,
      status: "active",
      currentPeriodStart: "2026-11-01",
      currentPeriodEnd: "2026-12-01",
    });

    expect(await repos.careerPlan.allowedBy(profileId, now)).toEqual({
      allowedBy: null,
      dailyLimit: 0,
    });
  });

  it("ignores collaborator access recorded under another organization", async () => {
    const { profileId, caseId } = await profile("2026-11-30", "2026-12-20");

    const [other] = await db
      .insert(organizations)
      .values({ name: "Outra", slug: `outra-${randomUUID()}` })
      .returning({ id: organizations.id });

    await db.insert(employeeAccess).values({
      caseId,
      orgId: other.id,
      email: "bia@example.com",
      plan: emptyEmployeePlan,
      careerSponsoredUntil: "2030-01-01",
    });

    expect((await repos.careerPlan.plan(profileId, now))?.company.sponsoredUntil).toBe(
      "2026-12-20",
    );
  });

  it("reads the person's Carreira Pro for the access check", async () => {
    const { profileId } = await profile("2026-11-30");

    expect(await repos.careerPlan.individual(profileId)).toBeNull();

    await db.insert(talentSubscriptions).values({
      profileId,
      status: "active",
      currentPeriodEnd: "2027-01-01",
      createdAt: now,
      updatedAt: now,
    });

    expect(await repos.careerPlan.individual(profileId)).toEqual({
      status: "active",
      currentPeriodEnd: "2027-01-01",
    });
  });

  it("reads the person's benefit assignment and ignores an expired one", async () => {
    const { profileId } = await profile("2026-11-30");

    await onPlan("gold");

    const [gold] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, "gold"));

    await db.insert(benefitAssignments).values({
      profileId,
      assignedPlanId: gold.id,
      effectivePlanId: gold.id,
      source: "manual",
      validUntil: "2027-06-01",
    });

    const granted = await repos.careerPlan.plan(profileId, now);

    expect(granted?.benefit).toMatchObject({ planName: "Gold", validUntil: "2027-06-01" });
    expect(granted?.aiApply).toEqual({ allowedBy: "benefit", dailyLimit: 3 });

    await db
      .update(benefitAssignments)
      .set({ validUntil: "2026-11-25" })
      .where(eq(benefitAssignments.profileId, profileId));

    const expired = await repos.careerPlan.plan(profileId, now);

    expect(expired?.aiApply.allowedBy).toBeNull();
    expect(expired?.benefit).toBeNull();
  });

  describe("co-pay checkout guard", () => {
    const hour = 60 * 60 * 1000;

    async function assignment() {
      const { profileId } = await profile("2026-11-30");
      const [gold] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, "gold"));

      await db.insert(benefitAssignments).values({
        profileId,
        assignedPlanId: gold.id,
        effectivePlanId: gold.id,
        source: "manual",
        validUntil: "2099-12-31",
      });

      return profileId;
    }

    it("starts right after the assignment is created or edited", async () => {
      const profileId = await assignment();

      await db
        .update(benefitAssignments)
        .set({ updatedAt: new Date() })
        .where(eq(benefitAssignments.profileId, profileId));

      expect(await repos.careerPlan.startCopayCheckout(profileId, new Date())).not.toBeNull();
    });

    it("refuses a second checkout within the hour and allows it afterwards", async () => {
      const profileId = await assignment();
      const started = new Date("2026-11-26T15:00:00Z");

      expect(await repos.careerPlan.startCopayCheckout(profileId, started)).not.toBeNull();
      expect(
        await repos.careerPlan.startCopayCheckout(
          profileId,
          new Date(started.getTime() + hour - 1),
        ),
      ).toBeNull();
      expect(
        await repos.careerPlan.startCopayCheckout(
          profileId,
          new Date(started.getTime() + hour + 1),
        ),
      ).not.toBeNull();
    });

    it("allows a new checkout after release without touching updated_at", async () => {
      const profileId = await assignment();

      const [before] = await db
        .select({ updatedAt: benefitAssignments.updatedAt })
        .from(benefitAssignments)
        .where(eq(benefitAssignments.profileId, profileId));

      expect(await repos.careerPlan.startCopayCheckout(profileId, new Date())).not.toBeNull();
      expect(await repos.careerPlan.startCopayCheckout(profileId, new Date())).toBeNull();

      await repos.careerPlan.releaseCopayCheckout(profileId);

      expect(await repos.careerPlan.startCopayCheckout(profileId, new Date())).not.toBeNull();

      const [after] = await db
        .select({ updatedAt: benefitAssignments.updatedAt })
        .from(benefitAssignments)
        .where(eq(benefitAssignments.profileId, profileId));

      expect(after.updatedAt).toEqual(before.updatedAt);
    });
  });

  it("has no benefit without an assignment", async () => {
    const { profileId } = await profile("2026-11-30");

    expect((await repos.careerPlan.plan(profileId, now))?.benefit).toBeNull();
  });

  it("has no plan for an unknown profile", async () => {
    const missing = "00000000-0000-4000-8000-000000000001";

    expect(await repos.careerPlan.plan(missing, now)).toBeUndefined();
    expect(await repos.careerPlan.allowedBy(missing, now)).toEqual({
      allowedBy: null,
      dailyLimit: 0,
    });
  });
});
