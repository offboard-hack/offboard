import type { CareerPlan } from "./plan-card";

export type TierFeatures = {
  name: string;
  score: "numeric" | "detailed";
  aiApplyLimit: number;
  aiApplyPriority: boolean;
};

export const tierCatalog: TierFeatures[] = [
  { name: "Silver", score: "numeric", aiApplyLimit: 0, aiApplyPriority: false },
  { name: "Gold", score: "detailed", aiApplyLimit: 3, aiApplyPriority: false },
  {
    name: "Platinum",
    score: "detailed",
    aiApplyLimit: 10,
    aiApplyPriority: false,
  },
  {
    name: "Platinum Premium",
    score: "detailed",
    aiApplyLimit: 25,
    aiApplyPriority: true,
  },
];

function tierIndex(benefit: CareerPlan["benefit"]) {
  if (!benefit) return -1;

  return tierCatalog.findIndex((tier) => tier.name === benefit.planName);
}

export function currentTierFeatures(benefit: CareerPlan["benefit"]) {
  return tierCatalog[tierIndex(benefit)] ?? null;
}

export function nextTierFeatures(benefit: CareerPlan["benefit"]) {
  const index = tierIndex(benefit);

  return index === -1 ? null : (tierCatalog[index + 1] ?? null);
}

export function featureComparisonView(benefit: CareerPlan["benefit"]) {
  const current = currentTierFeatures(benefit);

  if (!current) return null;

  return { current, next: nextTierFeatures(benefit) };
}
