import type { Database } from "@offboard/db/client";
import {
  type BenefitPolicyRule,
  benefitAssignments,
  benefitPolicies,
  plans,
  talentProfiles,
} from "@offboard/db/schema";
import { aliasedTable, and, eq, gte } from "drizzle-orm";

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

  return {
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
