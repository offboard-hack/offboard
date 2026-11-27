import type { Database } from "@offboard/db/client";
import { benefitAssignments, benefitCopays, plans, talentSubscriptions } from "@offboard/db/schema";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  copayGrants,
  endCopay,
  nextTierAbove,
  syncEffectivePlan,
} from "../../shared/benefit-copay.js";
import { checkoutRetryMs } from "../../shared/career-pro.js";
import { individualActive } from "../../shared/entitlement.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";

export type CopayCheckoutPorts = {
  ensureProduct(fromSlug: string, toSlug: string, priceCents: number): Promise<{ id: string }>;
  createCheckout(params: { externalId: string; planSlug: string }): Promise<{
    id: string;
    url: string;
  }>;
  cancelSubscription(id: string): Promise<void>;
};

export function createBenefitCopayRepository(db: Database) {
  async function startCheckout(
    profileId: string,
    orgId: string,
    now: Date,
    ports: CopayCheckoutPorts,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`copay:${profileId}`}::text, 0))`,
      );

      const today = saoPauloDate(now);

      const [assignment] = await tx
        .select({
          id: benefitAssignments.id,
          slug: plans.slug,
          priceCents: plans.perPersonPriceCents,
        })
        .from(benefitAssignments)
        .innerJoin(plans, eq(plans.id, benefitAssignments.assignedPlanId))
        .where(
          and(
            eq(benefitAssignments.profileId, profileId),
            eq(benefitAssignments.orgId, orgId),
            gte(benefitAssignments.validUntil, today),
          ),
        );

      if (!assignment) return { outcome: "no_benefit" } as const;

      const next = await nextTierAbove(tx, assignment.priceCents);

      if (!next) return { outcome: "top_tier" } as const;

      const [pro] = await tx
        .select({
          status: talentSubscriptions.status,
          currentPeriodEnd: talentSubscriptions.currentPeriodEnd,
        })
        .from(talentSubscriptions)
        .where(eq(talentSubscriptions.profileId, profileId));

      if (individualActive(pro ?? null, today)) return { outcome: "pro_active" } as const;

      const [current] = await tx
        .select({
          status: benefitCopays.status,
          currentPeriodEnd: benefitCopays.currentPeriodEnd,
          providerSubscriptionId: benefitCopays.providerSubscriptionId,
        })
        .from(benefitCopays)
        .where(eq(benefitCopays.assignmentId, assignment.id));

      if (copayGrants(current ?? null, today)) return { outcome: "already_active" } as const;

      const [fresh] = await tx
        .select({
          url: sql<string>`${benefitCopays.checkoutUrl}`,
          checkoutId: sql<string>`${benefitCopays.checkoutId}`,
        })
        .from(benefitCopays)
        .where(
          and(
            eq(benefitCopays.assignmentId, assignment.id),
            eq(benefitCopays.status, "pending"),
            eq(benefitCopays.targetPlanId, next.id),
            isNotNull(benefitCopays.checkoutUrl),
            gt(benefitCopays.updatedAt, new Date(now.getTime() - checkoutRetryMs)),
          ),
        );

      if (fresh) return { outcome: "issued", ...fresh } as const;

      if (current?.providerSubscriptionId && current.status !== "canceled") {
        await ports.cancelSubscription(current.providerSubscriptionId);
      }

      const product = await ports.ensureProduct(
        assignment.slug,
        next.slug,
        next.priceCents - assignment.priceCents,
      );

      const checkout = await ports.createCheckout({
        externalId: `copay:${assignment.id}`,
        planSlug: product.id,
      });

      await tx
        .insert(benefitCopays)
        .values({
          assignmentId: assignment.id,
          orgId,
          targetPlanId: next.id,
          status: "pending",
          checkoutId: checkout.id,
          checkoutUrl: checkout.url,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: benefitCopays.assignmentId,
          set: {
            targetPlanId: next.id,
            status: "pending",
            checkoutId: checkout.id,
            checkoutUrl: checkout.url,
            providerSubscriptionId: null,
            currentPeriodEnd: null,
            updatedAt: now,
          },
        });

      return { outcome: "issued", url: checkout.url, checkoutId: checkout.id } as const;
    });
  }

  async function cancelable(profileId: string, orgId: string) {
    const [row] = await db
      .select({
        assignmentId: benefitCopays.assignmentId,
        providerSubscriptionId: sql<string>`${benefitCopays.providerSubscriptionId}`,
        currentPeriodEnd: benefitCopays.currentPeriodEnd,
      })
      .from(benefitCopays)
      .innerJoin(benefitAssignments, eq(benefitAssignments.id, benefitCopays.assignmentId))
      .where(
        and(
          eq(benefitAssignments.profileId, profileId),
          eq(benefitAssignments.orgId, orgId),
          inArray(benefitCopays.status, ["active", "past_due"]),
          isNotNull(benefitCopays.providerSubscriptionId),
        ),
      );

    return row ?? null;
  }

  async function markCanceled(assignmentId: string, providerSubscriptionId: string, now: Date) {
    await db.transaction(async (tx) => {
      await tx
        .update(benefitCopays)
        .set({ status: "canceled", updatedAt: now })
        .where(
          and(
            eq(benefitCopays.assignmentId, assignmentId),
            eq(benefitCopays.providerSubscriptionId, providerSubscriptionId),
          ),
        );

      await syncEffectivePlan(tx, assignmentId, saoPauloDate(now));
    });
  }

  async function expired(today: string) {
    return db
      .select({
        assignmentId: benefitCopays.assignmentId,
        providerSubscriptionId: benefitCopays.providerSubscriptionId,
      })
      .from(benefitCopays)
      .innerJoin(benefitAssignments, eq(benefitAssignments.id, benefitCopays.assignmentId))
      .where(
        and(
          inArray(benefitCopays.status, ["pending", "active", "past_due"]),
          lt(benefitAssignments.validUntil, today),
        ),
      );
  }

  async function end(assignmentId: string, now: Date) {
    await db.transaction(async (tx) => {
      await endCopay(tx, assignmentId, now);
    });
  }

  async function lapsed(today: string) {
    return db
      .select({ assignmentId: benefitCopays.assignmentId })
      .from(benefitCopays)
      .innerJoin(benefitAssignments, eq(benefitAssignments.id, benefitCopays.assignmentId))
      .where(
        and(
          eq(benefitAssignments.effectivePlanId, benefitCopays.targetPlanId),
          ne(benefitAssignments.assignedPlanId, benefitAssignments.effectivePlanId),
          or(
            eq(benefitCopays.status, "pending"),
            isNull(benefitCopays.currentPeriodEnd),
            lt(benefitCopays.currentPeriodEnd, today),
          ),
        ),
      );
  }

  async function settle(assignmentId: string, today: string) {
    await syncEffectivePlan(db, assignmentId, today);
  }

  return { startCheckout, cancelable, markCanceled, expired, end, lapsed, settle };
}

export type BenefitCopayRepository = ReturnType<typeof createBenefitCopayRepository>;
