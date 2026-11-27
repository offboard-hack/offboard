import { planPrice, type CareerPlan } from "./plan-card";

export type TierFeatures = {
  name: string;
  priceCents: number;
  score: "numeric" | "detailed";
  aiApplyLimit: number;
  aiApplyPriority: boolean;
};

export const tierCatalog: TierFeatures[] = [
  { name: "Silver", priceCents: 0, score: "numeric", aiApplyLimit: 0, aiApplyPriority: false },
  { name: "Gold", priceCents: 2900, score: "detailed", aiApplyLimit: 3, aiApplyPriority: false },
  {
    name: "Platinum",
    priceCents: 5900,
    score: "detailed",
    aiApplyLimit: 10,
    aiApplyPriority: false,
  },
  {
    name: "Platinum Premium",
    priceCents: 9900,
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

export function copayPriceCents(currentPriceCents: number, nextPriceCents: number) {
  return nextPriceCents - currentPriceCents;
}

export function featureComparisonView(benefit: CareerPlan["benefit"]) {
  const current = currentTierFeatures(benefit);

  if (!current) return null;

  const next = nextTierFeatures(benefit);

  return {
    current,
    next,
    copayLabel: next
      ? `Upgrade para ${next.name} · ${planPrice(copayPriceCents(current.priceCents, next.priceCents))}`
      : null,
  };
}
