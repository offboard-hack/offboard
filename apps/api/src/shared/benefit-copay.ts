import type { Database } from "@offboard/db/client";
import { benefitAssignments, benefitCopays, plans } from "@offboard/db/schema";
import { aliasedTable, and, asc, eq, gt, ne } from "drizzle-orm";
import { saoPauloDate } from "./sao-paulo-date.js";

export type CopayStanding = {
  status: "pending" | "active" | "past_due" | "canceled";
  currentPeriodEnd: string | null;
};

export type CopayWriter = Pick<Database, "select" | "update">;

export function copayGrants(copay: CopayStanding | null, today: string) {
  return (
    copay !== null &&
    copay.status !== "pending" &&
    copay.currentPeriodEnd !== null &&
    today <= copay.currentPeriodEnd
  );
}

export async function nextTierAbove(db: CopayWriter, priceCents: number) {
  const [row] = await db
    .select({
      id: plans.id,
      slug: plans.slug,
      name: plans.name,
      priceCents: plans.perPersonPriceCents,
    })
    .from(plans)
    .where(gt(plans.perPersonPriceCents, priceCents))
    .orderBy(asc(plans.perPersonPriceCents))
    .limit(1);

  return row ?? null;
}

export async function syncEffectivePlan(db: CopayWriter, assignmentId: string, today: string) {
  const assigned = await db
    .select({
      assignedPlanId: benefitAssignments.assignedPlanId,
      assignedPriceCents: plans.perPersonPriceCents,
    })
    .from(benefitAssignments)
    .innerJoin(plans, eq(plans.id, benefitAssignments.assignedPlanId))
    .where(eq(benefitAssignments.id, assignmentId));

  for (const row of assigned) {
    const target = aliasedTable(plans, "target_plan");

    const [copay] = await db
      .select({
        status: benefitCopays.status,
        currentPeriodEnd: benefitCopays.currentPeriodEnd,
        targetPlanId: benefitCopays.targetPlanId,
        targetPriceCents: target.perPersonPriceCents,
      })
      .from(benefitCopays)
      .innerJoin(target, eq(target.id, benefitCopays.targetPlanId))
      .where(eq(benefitCopays.assignmentId, assignmentId));

    const upgraded =
      copay !== undefined &&
      copayGrants(copay, today) &&
      copay.targetPriceCents > row.assignedPriceCents;

    const effectivePlanId = upgraded ? copay.targetPlanId : row.assignedPlanId;

    await db
      .update(benefitAssignments)
      .set({ effectivePlanId, updatedAt: new Date() })
      .where(
        and(
          eq(benefitAssignments.id, assignmentId),
          ne(benefitAssignments.effectivePlanId, effectivePlanId),
        ),
      );
  }
}

export async function endCopay(db: CopayWriter, assignmentId: string, now: Date) {
  await db
    .update(benefitCopays)
    .set({
      status: "canceled",
      currentPeriodEnd: null,
      checkoutId: null,
      checkoutUrl: null,
      updatedAt: now,
    })
    .where(eq(benefitCopays.assignmentId, assignmentId));

  await syncEffectivePlan(db, assignmentId, saoPauloDate(now));
}
