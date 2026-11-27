import type { Database } from "@offboard/db/client";
import {
  type BenefitPolicyRule,
  benefitAssignments,
  benefitCopays,
  benefitPolicies,
  offboardingCases,
  plans,
  talentProfiles,
} from "@offboard/db/schema";
import { aliasedTable, and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { endCopay, syncEffectivePlan } from "../../shared/benefit-copay.js";
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
        copay: sql<boolean>`coalesce(${benefitCopays.status} <> 'pending' and ${benefitCopays.currentPeriodEnd} >= (now() at time zone 'America/Sao_Paulo')::date, false)`,
      })
      .from(benefitAssignments)
      .innerJoin(talentProfiles, eq(talentProfiles.id, benefitAssignments.profileId))
      .innerJoin(assigned, eq(assigned.id, benefitAssignments.assignedPlanId))
      .innerJoin(effective, eq(effective.id, benefitAssignments.effectivePlanId))
      .leftJoin(benefitCopays, eq(benefitCopays.assignmentId, benefitAssignments.id))
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

  async function copaySubscriptionsAtOrBelow(profileId: string, orgId: string, planId: string) {
    const target = aliasedTable(plans, "target_plan");
    const chosen = aliasedTable(plans, "chosen_plan");

    const rows = await db
      .select({ id: sql<string>`${benefitCopays.providerSubscriptionId}` })
      .from(benefitCopays)
      .innerJoin(benefitAssignments, eq(benefitAssignments.id, benefitCopays.assignmentId))
      .innerJoin(target, eq(target.id, benefitCopays.targetPlanId))
      .innerJoin(chosen, eq(chosen.id, planId))
      .where(
        and(
          eq(benefitAssignments.profileId, profileId),
          eq(benefitAssignments.orgId, orgId),
          inArray(benefitCopays.status, ["active", "past_due"]),
          isNotNull(benefitCopays.providerSubscriptionId),
          lte(target.perPersonPriceCents, chosen.perPersonPriceCents),
        ),
      );

    return rows.map((row) => row.id);
  }

  async function upsertAssignment(input: AssignmentInput) {
    return db.transaction(async (tx) => {
      const [row] = await tx
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

      const target = aliasedTable(plans, "target_plan");
      const now = new Date();

      const covered = await tx
        .select({ id: benefitCopays.assignmentId })
        .from(benefitCopays)
        .innerJoin(target, eq(target.id, benefitCopays.targetPlanId))
        .innerJoin(plans, eq(plans.id, input.assignedPlanId))
        .where(
          and(
            eq(benefitCopays.assignmentId, row.id),
            inArray(benefitCopays.status, ["pending", "active", "past_due"]),
            lte(target.perPersonPriceCents, plans.perPersonPriceCents),
          ),
        );

      for (const copay of covered) await endCopay(tx, copay.id, now);

      const held = await tx
        .select({ id: benefitCopays.assignmentId })
        .from(benefitCopays)
        .where(eq(benefitCopays.assignmentId, row.id));

      for (const copay of held) await syncEffectivePlan(tx, copay.id, saoPauloDate(now));

      return row;
    });
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

  return {
    pendingPerson,
    applyBenefitPolicy,
    profileInOrg,
    getPolicy,
    savePolicy,
    listAssignments,
    getEffectiveBenefit,
    upsertAssignment,
    copaySubscriptionsAtOrBelow,
    planPriceMap,
  };
}

export type BenefitRepository = ReturnType<typeof createBenefitRepository>;
