import type { Database } from "@offboard/db/client";
import {
  type BenefitPolicyRule,
  benefitAssignments,
  benefitInvoices,
  benefitPolicies,
  copayProducts,
  offboardingCases,
  plans,
  talentProfiles,
} from "@offboard/db/schema";
import { aliasedTable, and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { evaluateBenefitRules, matchesBenefitRule } from "../../shared/benefit-rules.js";
import { addMonths, saoPauloDate } from "../../shared/sao-paulo-date.js";

type AssignmentSource = (typeof benefitAssignments.$inferSelect)["source"];

type PolicyInput = {
  defaultPlanId: string | null;
  benefitDurationMonths: number;
  rules: BenefitPolicyRule[];
};

type AssignmentInput = {
  orgId: string;
  profileId: string;
  assignedPlanId: string;
  effectivePlanId: string;
  source: AssignmentSource;
  validUntil: string;
};

export function createBenefitRepository(db: Database) {
  async function getPolicy(orgId: string) {
    const [row] = await db
      .select({
        defaultPlanId: benefitPolicies.defaultPlanId,
        benefitDurationMonths: benefitPolicies.benefitDurationMonths,
        rules: benefitPolicies.rules,
      })
      .from(benefitPolicies)
      .where(eq(benefitPolicies.orgId, orgId))
      .limit(1);

    return (row ?? null) satisfies PolicyInput | null;
  }

  async function savePolicy(orgId: string, input: PolicyInput) {
    await db
      .insert(benefitPolicies)
      .values({ orgId, ...input })
      .onConflictDoUpdate({
        target: benefitPolicies.orgId,
        set: { ...input, updatedAt: new Date() },
      });
  }

  async function listAssignments(orgId: string) {
    const assigned = aliasedTable(plans, "assigned_plan");
    const effective = aliasedTable(plans, "effective_plan");

    return db
      .select({
        id: benefitAssignments.id,
        profileId: benefitAssignments.profileId,
        profileName: talentProfiles.name,
        assignedPlanName: assigned.name,
        effectivePlanName: effective.name,
        source: benefitAssignments.source,
        validUntil: benefitAssignments.validUntil,
      })
      .from(benefitAssignments)
      .innerJoin(talentProfiles, eq(talentProfiles.id, benefitAssignments.profileId))
      .innerJoin(assigned, eq(assigned.id, benefitAssignments.assignedPlanId))
      .innerJoin(effective, eq(effective.id, benefitAssignments.effectivePlanId))
      .where(eq(benefitAssignments.orgId, orgId))
      .orderBy(talentProfiles.name);
  }

  async function getEffectiveBenefit(profileId: string, today: string) {
    const [row] = await db
      .select({
        planName: plans.name,
        aiApplyDailyLimit: plans.aiApplyDailyLimit,
        aiApplyPriority: plans.aiApplyPriority,
        detailedScore: plans.detailedScore,
        validUntil: benefitAssignments.validUntil,
        source: benefitAssignments.source,
      })
      .from(benefitAssignments)
      .innerJoin(plans, eq(plans.id, benefitAssignments.effectivePlanId))
      .where(
        and(eq(benefitAssignments.profileId, profileId), gte(benefitAssignments.validUntil, today)),
      )
      .limit(1);

    return row ?? null;
  }

  async function upsertAssignment(input: AssignmentInput) {
    const [row] = await db
      .insert(benefitAssignments)
      .values(input)
      .onConflictDoUpdate({
        target: benefitAssignments.profileId,
        set: {
          assignedPlanId: input.assignedPlanId,
          effectivePlanId: input.effectivePlanId,
          source: input.source,
          validUntil: input.validUntil,
          updatedAt: new Date(),
        },
      })
      .returning({ id: benefitAssignments.id });

    return row;
  }

  async function planPriceMap() {
    const rows = await db.select({ id: plans.id, price: plans.perPersonPriceCents }).from(plans);

    return new Map(rows.map((row) => [row.id, row.price]));
  }

  async function profileInOrg(orgId: string, profileId: string) {
    const [row] = await db
      .select({ id: talentProfiles.id })
      .from(talentProfiles)
      .where(and(eq(talentProfiles.id, profileId), eq(talentProfiles.orgId, orgId)))
      .limit(1);

    return row !== undefined;
  }

  async function pendingPerson(orgId: string, caseId: string, profileId: string) {
    const [row] = await db
      .select({ department: offboardingCases.department, role: offboardingCases.role })
      .from(offboardingCases)
      .innerJoin(benefitPolicies, eq(benefitPolicies.orgId, offboardingCases.orgId))
      .leftJoin(benefitAssignments, eq(benefitAssignments.profileId, profileId))
      .where(
        and(
          eq(offboardingCases.orgId, orgId),
          eq(offboardingCases.id, caseId),
          isNull(benefitAssignments.id),
        ),
      )
      .limit(1);

    return row;
  }

  async function applyBenefitPolicy(
    orgId: string,
    profileId: string,
    person: { department: string; role: string },
    today: string,
  ) {
    const policy = await getPolicy(orgId);

    if (!policy) return false;

    const planId = evaluateBenefitRules(
      policy.rules,
      person,
      await planPriceMap(),
      policy.defaultPlanId,
    );

    if (planId === null || !(await profileInOrg(orgId, profileId))) return false;

    const source = policy.rules.some((rule) => matchesBenefitRule(rule, person))
      ? "rule"
      : "default";

    const validUntil = addMonths(today, policy.benefitDurationMonths);

    const rows = await db
      .insert(benefitAssignments)
      .values({
        orgId,
        profileId,
        assignedPlanId: planId,
        effectivePlanId: planId,
        source,
        validUntil,
      })
      .onConflictDoNothing({ target: benefitAssignments.profileId })
      .returning({ id: benefitAssignments.id });

    return rows.length > 0;
  }

  async function getCopayProduct(fromPlanId: string, toPlanId: string) {
    const [row] = await db
      .select({ abacatePayProductId: copayProducts.abacatePayProductId })
      .from(copayProducts)
      .where(and(eq(copayProducts.fromPlanId, fromPlanId), eq(copayProducts.toPlanId, toPlanId)))
      .limit(1);

    return row ?? null;
  }

  async function listCopayTargets(fromPlanId: string) {
    const from = aliasedTable(plans, "from_plan");

    return db
      .select({
        planId: copayProducts.toPlanId,
        name: plans.name,
        upgradeCents: sql<number>`${plans.perPersonPriceCents} - ${from.perPersonPriceCents}`,
      })
      .from(copayProducts)
      .innerJoin(plans, eq(plans.id, copayProducts.toPlanId))
      .innerJoin(from, eq(from.id, copayProducts.fromPlanId))
      .where(
        and(
          eq(copayProducts.fromPlanId, fromPlanId),
          sql`${plans.perPersonPriceCents} > ${from.perPersonPriceCents}`,
        ),
      )
      .orderBy(sql`${plans.perPersonPriceCents} - ${from.perPersonPriceCents}`)
      .limit(1);
  }

  async function findAssignmentByProfile(profileId: string) {
    const [row] = await db
      .select({
        id: benefitAssignments.id,
        assignedPlanId: benefitAssignments.assignedPlanId,
        effectivePlanId: benefitAssignments.effectivePlanId,
        copaySubscriptionId: benefitAssignments.copaySubscriptionId,
        validUntil: benefitAssignments.validUntil,
      })
      .from(benefitAssignments)
      .where(eq(benefitAssignments.profileId, profileId))
      .limit(1);

    return row ?? null;
  }

  async function updateCopayState(
    profileId: string,
    patch: { effectivePlanId?: string; copaySubscriptionId?: string | null },
  ) {
    await db
      .update(benefitAssignments)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(benefitAssignments.profileId, profileId));
  }

  async function findAssignmentBySubscription(copaySubscriptionId: string) {
    const [row] = await db
      .select({
        profileId: benefitAssignments.profileId,
        assignedPlanId: benefitAssignments.assignedPlanId,
        effectivePlanId: benefitAssignments.effectivePlanId,
        validUntil: benefitAssignments.validUntil,
      })
      .from(benefitAssignments)
      .where(eq(benefitAssignments.copaySubscriptionId, copaySubscriptionId))
      .limit(1);

    return row ?? null;
  }

  async function tallyActiveAssignments(orgId: string) {
    const [row] = await db
      .select({
        totalCents: sql<number>`coalesce(sum(${plans.perPersonPriceCents}), 0)::int`,
        count: count(),
      })
      .from(benefitAssignments)
      .innerJoin(plans, eq(plans.id, benefitAssignments.assignedPlanId))
      .where(
        and(
          eq(benefitAssignments.orgId, orgId),
          gte(benefitAssignments.validUntil, saoPauloDate(new Date())),
        ),
      );

    return row;
  }

  async function createBenefitInvoice(orgId: string, period: string, totalCents: number) {
    await db
      .insert(benefitInvoices)
      .values({ orgId, period, totalCents })
      .onConflictDoNothing({ target: [benefitInvoices.orgId, benefitInvoices.period] });

    const [row] = await db
      .select({
        id: benefitInvoices.id,
        period: benefitInvoices.period,
        totalCents: benefitInvoices.totalCents,
        status: benefitInvoices.status,
      })
      .from(benefitInvoices)
      .where(and(eq(benefitInvoices.orgId, orgId), eq(benefitInvoices.period, period)))
      .limit(1);

    return row;
  }

  async function listBenefitInvoices(orgId: string) {
    return db
      .select({
        id: benefitInvoices.id,
        period: benefitInvoices.period,
        totalCents: benefitInvoices.totalCents,
        status: benefitInvoices.status,
        createdAt: benefitInvoices.createdAt,
      })
      .from(benefitInvoices)
      .where(eq(benefitInvoices.orgId, orgId))
      .orderBy(desc(benefitInvoices.period));
  }

  return {
    getCopayProduct,
    listCopayTargets,
    findAssignmentByProfile,
    updateCopayState,
    findAssignmentBySubscription,
    tallyActiveAssignments,
    createBenefitInvoice,
    listBenefitInvoices,
    pendingPerson,
    applyBenefitPolicy,
    profileInOrg,
    getPolicy,
    savePolicy,
    listAssignments,
    getEffectiveBenefit,
    upsertAssignment,
    planPriceMap,
  };
}

export type BenefitRepository = ReturnType<typeof createBenefitRepository>;
