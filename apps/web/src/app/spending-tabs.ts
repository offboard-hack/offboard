import { z } from "zod";

export const spendingTabs = ["plano", "beneficios"] as const;

export const spendingSearchSchema = z.object({
  aba: z.enum(spendingTabs).optional().catch(undefined),
});

export type SpendingTab = (typeof spendingTabs)[number];

export function visibleSpendingTabs(access: { plan: boolean; benefits: boolean }) {
  return spendingTabs.filter((tab) => (tab === "plano" ? access.plan : access.benefits));
}

export function activeSpendingTab(requested: SpendingTab | undefined, visible: SpendingTab[]) {
  return requested && visible.includes(requested) ? requested : visible[0];
}
