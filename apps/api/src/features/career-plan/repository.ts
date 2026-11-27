import type { Database } from "@offboard/db/client";
import {
  benefitAssignments,
  employeeAccess,
  offboardingCases,
  plans,
  subscriptions,
  talentProfiles,
  talentSubscriptions,
} from "@offboard/db/schema";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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

    return careerPlanOf(
      {
        ...standing,
        company: await companyOf(orgId),
        benefit: await benefitOf(profileId, saoPauloDate(now)),
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

  async function startCopayCheckout(profileId: string, now: Date) {
    const [row] = await db
      .update(benefitAssignments)
      .set({ updatedAt: now })
      .where(
        and(
          eq(benefitAssignments.profileId, profileId),
          gte(benefitAssignments.validUntil, saoPauloDate(now)),
          isNull(benefitAssignments.copaySubscriptionId),
          or(
            isNull(benefitAssignments.updatedAt),
            lt(benefitAssignments.updatedAt, new Date(now.getTime() - checkoutRetryMs)),
          ),
        ),
      )
      .returning({ assignmentId: benefitAssignments.id });

    return row ?? null;
  }

  async function releaseCopayCheckout(profileId: string) {
    await db
      .update(benefitAssignments)
      .set({ updatedAt: new Date(0) })
      .where(
        and(
          eq(benefitAssignments.profileId, profileId),
          isNull(benefitAssignments.copaySubscriptionId),
        ),
      );
  }

  return {
    plan,
    allowedBy,
    individual,
    cancelable,
    markCanceled,
    startCheckout,
    releaseCheckout,
    startCopayCheckout,
    releaseCopayCheckout,
  };
}

export type CareerPlanRepository = ReturnType<typeof createCareerPlanRepository>;
