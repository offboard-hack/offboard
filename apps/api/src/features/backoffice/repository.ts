import type { Database } from "@offboard/db/client";
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
import { alias } from "drizzle-orm/pg-core";
import { asc, count, desc, eq, inArray, sql } from "drizzle-orm";

export type Page = { limit: number; offset: number };

const recentInvoiceLimit = 20;

const effectivePlan = alias(plans, "effective_plan");

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export function createBackofficeRepository(db: Database) {
  async function countBy(rows: Promise<{ status: string; count: number }[]>) {
    return Object.fromEntries((await rows).map((row) => [row.status, Number(row.count)]));
  }

  async function tallyByOrg(orgIds: string[]) {
    if (orgIds.length === 0)
      return { members: new Map<string, number>(), cases: new Map<string, number>() };

    const [memberRows, caseRows] = await Promise.all([
      db
        .select({ orgId: teamMembers.orgId, value: count() })
        .from(teamMembers)
        .where(inArray(teamMembers.orgId, orgIds))
        .groupBy(teamMembers.orgId),
      db
        .select({ orgId: offboardingCases.orgId, value: count() })
        .from(offboardingCases)
        .where(inArray(offboardingCases.orgId, orgIds))
        .groupBy(offboardingCases.orgId),
    ]);

    return {
      members: new Map(memberRows.map((row) => [row.orgId, row.value])),
      cases: new Map(caseRows.map((row) => [row.orgId, row.value])),
    };
  }

  async function latestSubscriptions(orgIds: string[]) {
    if (orgIds.length === 0) return new Map<string, LatestSubscription>();

    const rows = await db
      .select({
        orgId: subscriptions.orgId,
        id: subscriptions.id,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        plan: {
          id: plans.id,
          name: plans.name,
          slug: plans.slug,
          monthlyPriceCents: plans.monthlyPriceCents,
        },
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(inArray(subscriptions.orgId, orgIds))
      .orderBy(desc(subscriptions.createdAt));

    const byOrg = new Map<string, LatestSubscription>();

    for (const row of rows) if (!byOrg.has(row.orgId)) byOrg.set(row.orgId, row);

    return byOrg;
  }

  return {
    async summary() {
      const [
        [orgs],
        [members],
        [profiles],
        [cases],
        [mrr],
        [calls],
        subscriptionStatuses,
        talentStatuses,
      ] = await Promise.all([
        db.select({ value: count() }).from(organizations),
        db.select({ value: count() }).from(teamMembers),
        db.select({ value: count() }).from(talentProfiles),
        db.select({ value: count() }).from(offboardingCases),
        db
          .select({ value: sql<number>`coalesce(sum(${plans.monthlyPriceCents}), 0)` })
          .from(subscriptions)
          .innerJoin(plans, eq(plans.id, subscriptions.planId))
          .where(eq(subscriptions.status, "active")),
        db
          .select({ value: sql<number>`coalesce(sum(${llmUsage.calls}), 0)` })
          .from(llmUsage)
          .where(sql`${llmUsage.day} >= current_date - interval '30 days'`),
        countBy(
          db
            .select({ status: subscriptions.status, count: count() })
            .from(subscriptions)
            .groupBy(subscriptions.status),
        ),
        countBy(
          db
            .select({ status: talentSubscriptions.status, count: count() })
            .from(talentSubscriptions)
            .groupBy(talentSubscriptions.status),
        ),
      ]);

      return {
        organizations: orgs.value,
        teamMembers: members.value,
        talentProfiles: profiles.value,
        offboardingCases: cases.value,
        subscriptionsByStatus: subscriptionStatuses,
        activeMonthlyRecurringCents: Number(mrr.value),
        talentSubscriptionsByStatus: talentStatuses,
        llmCallsLast30Days: Number(calls.value),
      };
    },

    async listOrganizations({ limit, offset }: Page) {
      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: organizations.id,
            name: organizations.name,
            slug: organizations.slug,
            createdAt: organizations.createdAt,
          })
          .from(organizations)
          .orderBy(asc(organizations.name))
          .limit(limit)
          .offset(offset),
        db.select({ value: count() }).from(organizations),
      ]);

      const orgIds = rows.map((row) => row.id);
      const latest = await latestSubscriptions(orgIds);
      const tallies = await tallyByOrg(orgIds);

      return {
        total: total.value,
        items: rows.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt),
          memberCount: tallies.members.get(row.id) ?? 0,
          caseCount: tallies.cases.get(row.id) ?? 0,
          subscription: latest.get(row.id) ?? null,
        })),
      };
    },

    async getOrganization(id: string) {
      const [org] = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          createdAt: organizations.createdAt,
        })
        .from(organizations)
        .where(eq(organizations.id, id));

      if (!org) return null;

      const [members, orgSubscriptions, orgInvoices, [cases]] = await Promise.all([
        db
          .select({
            id: teamMembers.id,
            name: teamMembers.name,
            email: teamMembers.email,
            role: teamMembers.role,
          })
          .from(teamMembers)
          .where(eq(teamMembers.orgId, id))
          .orderBy(asc(teamMembers.name)),
        db
          .select({
            id: subscriptions.id,
            status: subscriptions.status,
            currentPeriodStart: subscriptions.currentPeriodStart,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            plan: {
              id: plans.id,
              name: plans.name,
              slug: plans.slug,
              monthlyPriceCents: plans.monthlyPriceCents,
            },
          })
          .from(subscriptions)
          .innerJoin(plans, eq(plans.id, subscriptions.planId))
          .where(eq(subscriptions.orgId, id))
          .orderBy(desc(subscriptions.createdAt)),
        db
          .select({
            id: invoices.id,
            subscriptionId: invoices.subscriptionId,
            amountCents: invoices.amountCents,
            status: invoices.status,
            dueDate: invoices.dueDate,
            paidAt: invoices.paidAt,
          })
          .from(invoices)
          .where(eq(invoices.orgId, id))
          .orderBy(desc(invoices.dueDate))
          .limit(recentInvoiceLimit),
        db.select({ value: count() }).from(offboardingCases).where(eq(offboardingCases.orgId, id)),
      ]);

      return {
        ...org,
        createdAt: iso(org.createdAt),
        caseCount: cases.value,
        members,
        subscriptions: orgSubscriptions,
        invoices: orgInvoices.map((invoice) => ({ ...invoice, paidAt: iso(invoice.paidAt) })),
      };
    },

    async listTalent({ limit, offset }: Page) {
      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: talentProfiles.id,
            name: talentProfiles.name,
            email: talentProfiles.personalEmail,
            orgName: organizations.name,
            firstSignedInAt: talentProfiles.firstSignedInAt,
            sponsoredUntil: talentProfiles.sponsoredUntil,
            subscriptionPlan: talentSubscriptions.plan,
            subscriptionStatus: talentSubscriptions.status,
            benefitPlan: effectivePlan.name,
            benefitValidUntil: benefitAssignments.validUntil,
          })
          .from(talentProfiles)
          .innerJoin(organizations, eq(organizations.id, talentProfiles.orgId))
          .leftJoin(talentSubscriptions, eq(talentSubscriptions.profileId, talentProfiles.id))
          .leftJoin(benefitAssignments, eq(benefitAssignments.profileId, talentProfiles.id))
          .leftJoin(effectivePlan, eq(effectivePlan.id, benefitAssignments.effectivePlanId))
          .orderBy(asc(talentProfiles.name))
          .limit(limit)
          .offset(offset),
        db.select({ value: count() }).from(talentProfiles),
      ]);

      return {
        total: total.value,
        items: rows.map((row) => ({
          ...row,
          firstSignedInAt: iso(row.firstSignedInAt),
        })),
      };
    },

    async listPlans() {
      const [catalogue, active, talent] = await Promise.all([
        db
          .select({
            id: plans.id,
            name: plans.name,
            slug: plans.slug,
            monthlyPriceCents: plans.monthlyPriceCents,
            maxEmployees: plans.maxEmployees,
            perPersonPriceCents: plans.perPersonPriceCents,
          })
          .from(plans)
          .orderBy(asc(plans.monthlyPriceCents)),
        db
          .select({ planId: subscriptions.planId, value: count() })
          .from(subscriptions)
          .where(eq(subscriptions.status, "active"))
          .groupBy(subscriptions.planId),
        db
          .select({ planId: benefitAssignments.effectivePlanId, value: count() })
          .from(benefitAssignments)
          .groupBy(benefitAssignments.effectivePlanId),
      ]);

      const activeByPlan = new Map(active.map((row) => [row.planId, row.value]));
      const talentByPlan = new Map(talent.map((row) => [row.planId, row.value]));

      return catalogue.map((plan) => ({
        ...plan,
        activeOrganizations: activeByPlan.get(plan.id) ?? 0,
        assignedTalent: talentByPlan.get(plan.id) ?? 0,
      }));
    },
  };
}

type LatestSubscription = {
  orgId: string;
  id: string;
  status: "active" | "past_due" | "canceled" | "trialing" | "pending";
  currentPeriodEnd: string;
  plan: { id: string; name: string; slug: string; monthlyPriceCents: number };
};

export type BackofficeRepository = ReturnType<typeof createBackofficeRepository>;
