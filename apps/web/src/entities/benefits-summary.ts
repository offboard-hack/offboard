import type { PlanRow } from "@/entities/billing";
import type { BenefitAssignmentRow, BenefitPolicyData } from "./benefits";

export type BenefitPlanOption = Pick<PlanRow, "id" | "name" | "slug" | "perPersonPriceCents">;

export function policyDefaults(data: BenefitPolicyData | null) {
  return data ?? { defaultPlanId: null, benefitDurationMonths: 6, rules: [] };
}

export function costSummary(
  assignments: Pick<BenefitAssignmentRow, "assignedPlanName">[],
  plans: BenefitPlanOption[],
) {
  const prices = new Map(plans.map((plan) => [plan.name, plan.perPersonPriceCents]));
  const counts = new Map<string, number>();

  for (const { assignedPlanName } of assignments) {
    counts.set(assignedPlanName, (counts.get(assignedPlanName) ?? 0) + 1);
  }

  const tiers = [...counts].map(([name, count]) => ({
    name,
    count,
    subtotalCents: count * (prices.get(name) ?? 0),
  }));

  return { totalCents: tiers.reduce((sum, tier) => sum + tier.subtotalCents, 0), tiers };
}
