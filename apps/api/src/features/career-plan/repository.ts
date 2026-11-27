import type { Database } from "@offboard/db/client";
import {
  benefitAssignments,
  benefitCopays,
  employeeAccess,
  offboardingCases,
  plans,
  subscriptions,
  talentProfiles,
  talentSubscriptions,
} from "@offboard/db/schema";
import {
  aliasedTable,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { nextTierAbove } from "../../shared/benefit-copay.js";
import { careerPlanOf, checkoutRetryMs } from "../../shared/career-pro.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";

export function createCareerPlanRepository(db: Database) {
  async function companyOf(orgId: string) {
    const [row] = await db
      .select({ name: plans.name, slug: plans.slug, status: subscriptions.status })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.orgId, orgId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    return row ?? null;
  }

  async function benefitOf(profileId: string, today: string) {
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

  async function copayOf(profileId: string, today: string) {
    const [assignment] = await db
      .select({ id: benefitAssignments.id, priceCents: plans.perPersonPriceCents })
      .from(benefitAssignments)
      .innerJoin(plans, eq(plans.id, benefitAssignments.assignedPlanId))
      .where(
        and(eq(benefitAssignments.profileId, profileId), gte(benefitAssignments.validUntil, today)),
      );

    if (!assignment) return undefined;

    const next = await nextTierAbove(db, assignment.priceCents);
    const target = aliasedTable(plans, "target_plan");

    const [held] = await db
      .select({
        status: benefitCopays.status,
        currentPeriodEnd: benefitCopays.currentPeriodEnd,
        providerSubscriptionId: benefitCopays.providerSubscriptionId,
        planName: target.name,
        targetPriceCents: target.perPersonPriceCents,
      })
      .from(benefitCopays)
      .innerJoin(target, eq(target.id, benefitCopays.targetPlanId))
      .where(eq(benefitCopays.assignmentId, assignment.id));

    return {
      nextTier: next && {
        planName: next.name,
        priceCents: next.priceCents - assignment.priceCents,
      },
      subscription: held
        ? {
            status: held.status,
            currentPeriodEnd: held.currentPeriodEnd,
            providerSubscriptionId: held.providerSubscriptionId,
            planName: held.planName,
            priceCents: held.targetPriceCents - assignment.priceCents,
          }
        : null,
    };
  }

  async function plan(profileId: string, now: Date) {
    const [row] = await db
      .select({
        orgId: talentProfiles.orgId,
        sponsoredUntil: sql<string>`case when ${employeeAccess.caseId} is null then ${talentProfiles.sponsoredUntil} else coalesce(${employeeAccess.careerSponsoredUntil}, (${offboardingCases.deadline} + interval '3 months')::date) end`,
        individual: {
          status: talentSubscriptions.status,
          currentPeriodEnd: talentSubscriptions.currentPeriodEnd,
          providerSubscriptionId: talentSubscriptions.providerSubscriptionId,
          updatedAt: talentSubscriptions.updatedAt,
        },
      })
      .from(talentProfiles)
      .leftJoin(
        employeeAccess,
        and(
          eq(employeeAccess.caseId, talentProfiles.caseId),
          eq(employeeAccess.orgId, talentProfiles.orgId),
          isNotNull(employeeAccess.email),
        ),
      )
      .leftJoin(
        offboardingCases,
        and(
          eq(offboardingCases.id, talentProfiles.caseId),
          eq(offboardingCases.orgId, talentProfiles.orgId),
        ),
      )
      .leftJoin(talentSubscriptions, eq(talentSubscriptions.profileId, talentProfiles.id))
      .where(eq(talentProfiles.id, profileId));

    if (row === undefined) return undefined;

    const { orgId, ...standing } = row;
    const today = saoPauloDate(now);

    return careerPlanOf(
      {
        ...standing,
        company: await companyOf(orgId),
        benefit: await benefitOf(profileId, today),
        copay: await copayOf(profileId, today),
      },
      now,
    );
  }

  async function allowedBy(profileId: string, now: Date) {
    return (await plan(profileId, now))?.aiApply.allowedBy ?? null;
  }

  async function individual(profileId: string) {
    const [row] = await db
      .select({
        status: talentSubscriptions.status,
        currentPeriodEnd: talentSubscriptions.currentPeriodEnd,
      })
      .from(talentSubscriptions)
      .where(eq(talentSubscriptions.profileId, profileId));

    return row ?? null;
  }

  async function cancelable(profileId: string) {
    const [row] = await db
      .select({
        providerSubscriptionId: talentSubscriptions.providerSubscriptionId,
        currentPeriodEnd: talentSubscriptions.currentPeriodEnd,
      })
      .from(talentSubscriptions)
      .where(
        and(
          eq(talentSubscriptions.profileId, profileId),
          inArray(talentSubscriptions.status, ["active", "past_due"]),
        ),
      );

    if (!row || row.providerSubscriptionId === null) return null;

    return {
      providerSubscriptionId: row.providerSubscriptionId,
      currentPeriodEnd: row.currentPeriodEnd,
    };
  }

  async function markCanceled(profileId: string, providerSubscriptionId: string, now: Date) {
    await db
      .update(talentSubscriptions)
      .set({ status: "canceled", updatedAt: now })
      .where(
        and(
          eq(talentSubscriptions.profileId, profileId),
          eq(talentSubscriptions.providerSubscriptionId, providerSubscriptionId),
        ),
      );
  }

  async function startCheckout(profileId: string, now: Date) {
    const [row] = await db
      .insert(talentSubscriptions)
      .values({ profileId, status: "pending", createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: talentSubscriptions.profileId,
        set: {
          status: "pending",
          updatedAt: now,
          providerSubscriptionId: sql`case when ${talentSubscriptions.status} = 'canceled' then null else ${talentSubscriptions.providerSubscriptionId} end`,
        },
        setWhere: or(
          and(
            eq(talentSubscriptions.status, "canceled"),
            or(
              isNull(talentSubscriptions.currentPeriodEnd),
              lt(talentSubscriptions.currentPeriodEnd, saoPauloDate(now)),
            ),
          ),
          and(
            eq(talentSubscriptions.status, "pending"),
            lt(talentSubscriptions.updatedAt, new Date(now.getTime() - checkoutRetryMs)),
          ),
          and(
            eq(talentSubscriptions.status, "active"),
            lt(talentSubscriptions.currentPeriodEnd, saoPauloDate(now)),
          ),
        ),
      })
      .returning({ profileId: talentSubscriptions.profileId });

    return row ?? null;
  }

  async function releaseCheckout(profileId: string) {
    await db
      .update(talentSubscriptions)
      .set({ updatedAt: new Date(0) })
      .where(
        and(
          eq(talentSubscriptions.profileId, profileId),
          eq(talentSubscriptions.status, "pending"),
        ),
      );
  }

  return { plan, allowedBy, individual, cancelable, markCanceled, startCheckout, releaseCheckout };
}

export type CareerPlanRepository = ReturnType<typeof createCareerPlanRepository>;
