import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  invoices,
  llmUsage,
  offboardingCases,
  organizations,
  plans,
  subscriptions,
  talentProfiles,
  talentSubscriptions,
  teamMembers,
} from "@offboard/db/schema";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBackofficeRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("createBackofficeRepository", () => {
  const db = createClient(url ?? "");
  const repo = createBackofficeRepository(db);

  let orgId: string;
  let orgName: string;
  let planId: string;
  let otherPlanId: string;
  let profileId: string;
  let signedInProfileId: string;

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });

    const suffix = randomUUID();
    orgName = `0-backoffice-${suffix}`;

    [{ id: planId }] = await db
      .insert(plans)
      .values({
        name: "Plano A",
        slug: `plan-a-${suffix}`,
        monthlyPriceCents: 4900,
        maxEmployees: 10,
      })
      .returning({ id: plans.id });

    [{ id: otherPlanId }] = await db
      .insert(plans)
      .values({
        name: "Plano B",
        slug: `plan-b-${suffix}`,
        monthlyPriceCents: 9900,
        maxEmployees: 50,
      })
      .returning({ id: plans.id });

    [{ id: orgId }] = await db
      .insert(organizations)
      .values({ name: orgName, slug: `bo-${suffix}` })
      .returning({ id: organizations.id });

    await db.insert(teamMembers).values({
      orgId,
      name: "Ana RH",
      email: `ana-${suffix}@example.com`,
      role: "rh",
    });

    await db.insert(offboardingCases).values({
      orgId,
      name: "Caso",
      role: "Dev",
      department: "Eng",
      deadline: "2030-01-01",
    });

    await db.insert(subscriptions).values({
      orgId,
      planId,
      status: "canceled",
      currentPeriodStart: "2020-01-01",
      currentPeriodEnd: "2020-02-01",
      createdAt: new Date("2020-01-01T00:00:00Z"),
    });

    const [latest] = await db
      .insert(subscriptions)
      .values({
        orgId,
        planId: otherPlanId,
        status: "active",
        currentPeriodStart: "2030-01-01",
        currentPeriodEnd: "2030-02-01",
      })
      .returning({ id: subscriptions.id });

    await db.insert(invoices).values([
      {
        orgId,
        subscriptionId: latest.id,
        amountCents: 9900,
        status: "paid",
        dueDate: "2030-01-05",
        paidAt: new Date("2030-01-04T12:00:00Z"),
      },
      {
        orgId,
        subscriptionId: latest.id,
        amountCents: 9900,
        status: "pending",
        dueDate: "2030-02-05",
      },
    ]);

    [{ id: profileId }] = await db
      .insert(talentProfiles)
      .values({
        orgId,
        personalEmail: `talent-${suffix}@example.com`,
        name: "0-talent-a",
        sponsoredUntil: "2030-01-01",
      })
      .returning({ id: talentProfiles.id });

    [{ id: signedInProfileId }] = await db
      .insert(talentProfiles)
      .values({
        orgId,
        personalEmail: `talent-b-${suffix}@example.com`,
        name: "0-talent-b",
        sponsoredUntil: "2030-01-01",
        firstSignedInAt: new Date("2030-01-02T10:00:00Z"),
      })
      .returning({ id: talentProfiles.id });

    await db.insert(talentSubscriptions).values({
      profileId,
      plan: "carreira-pro",
      status: "active",
    });

    await db.insert(benefitAssignments).values({
      orgId,
      profileId,
      assignedPlanId: planId,
      effectivePlanId: otherPlanId,
      source: "manual",
      validUntil: "2030-06-30",
    });

    await db.insert(llmUsage).values({ profileId, day: sql`current_date`, calls: 7 });
  });

  afterAll(() => db.$client.end());

  it("summarises platform totals and recurring revenue", async () => {
    const summary = await repo.summary();

    expect(summary.organizations).toBeGreaterThanOrEqual(1);
    expect(summary.teamMembers).toBeGreaterThanOrEqual(1);
    expect(summary.talentProfiles).toBeGreaterThanOrEqual(2);
    expect(summary.offboardingCases).toBeGreaterThanOrEqual(1);
    expect(summary.subscriptionsByStatus.active).toBeGreaterThanOrEqual(1);
    expect(summary.subscriptionsByStatus.canceled).toBeGreaterThanOrEqual(1);
    expect(summary.activeMonthlyRecurringCents).toBeGreaterThanOrEqual(9900);
    expect(summary.talentSubscriptionsByStatus.active).toBeGreaterThanOrEqual(1);
    expect(summary.llmCallsLast30Days).toBeGreaterThanOrEqual(7);
  });

  it("lists organizations with member, case and latest subscription data", async () => {
    const page = await repo.listOrganizations({ limit: 100, offset: 0 });
    const row = page.items.find((item) => item.id === orgId);

    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(row).toMatchObject({
      name: orgName,
      memberCount: 1,
      caseCount: 1,
      subscription: {
        id: expect.any(String),
        status: "active",
        plan: { id: otherPlanId, name: "Plano B", monthlyPriceCents: 9900 },
      },
    });
  });

  it("returns an empty page past the end of the list", async () => {
    const page = await repo.listOrganizations({ limit: 10, offset: 2_000_000_000 });

    expect(page.items).toEqual([]);
  });

  it("returns a null subscription for an organization without subscriptions", async () => {
    const [bare] = await db
      .insert(organizations)
      .values({ name: `bare-${randomUUID()}`, slug: `bare-${randomUUID()}` })
      .returning({ id: organizations.id });

    const page = await repo.listOrganizations({ limit: 100, offset: 0 });
    const row = page.items.find((item) => item.id === bare.id);

    expect(row?.subscription).toBeNull();
  });

  it("returns an organization with members, subscriptions and recent invoices", async () => {
    const org = await repo.getOrganization(orgId);

    expect(org).toMatchObject({ id: orgId, name: orgName, caseCount: 1 });
    expect(org?.members).toHaveLength(1);
    expect(org?.subscriptions.map((item) => item.status)).toEqual(["active", "canceled"]);
    expect(org?.invoices).toHaveLength(2);
    expect(org?.invoices.map((invoice) => invoice.paidAt)).toEqual(
      expect.arrayContaining(["2030-01-04T12:00:00.000Z", null]),
    );
  });

  it("returns null for an unknown organization", async () => {
    expect(await repo.getOrganization(randomUUID())).toBeNull();
  });

  it("lists talent with subscription and effective benefit plan", async () => {
    const page = await repo.listTalent({ limit: 100, offset: 0 });
    const withBenefit = page.items.find((item) => item.id === profileId);
    const signedIn = page.items.find((item) => item.id === signedInProfileId);

    expect(withBenefit).toMatchObject({
      orgName,
      subscriptionPlan: "carreira-pro",
      subscriptionStatus: "active",
      benefitPlan: "Plano B",
      firstSignedInAt: null,
    });
    expect(signedIn).toMatchObject({
      benefitPlan: null,
      subscriptionStatus: null,
      firstSignedInAt: "2030-01-02T10:00:00.000Z",
    });
  });

  it("returns an empty talent page past the end of the list", async () => {
    const page = await repo.listTalent({ limit: 10, offset: 2_000_000_000 });

    expect(page.items).toEqual([]);
  });

  it("counts active organizations and assigned talent per plan", async () => {
    const catalogue = await repo.listPlans();
    const planB = catalogue.find((plan) => plan.id === otherPlanId);
    const planA = catalogue.find((plan) => plan.id === planId);

    expect(planB).toMatchObject({ name: "Plano B", activeOrganizations: 1, assignedTalent: 1 });
    expect(planA).toMatchObject({ activeOrganizations: 0, assignedTalent: 0 });
  });
});
