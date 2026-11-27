import type { BenefitPolicyRule } from "@offboard/db/schema";
import { z } from "zod";

export const benefitRuleSchema = z.object({
  id: z.string().min(1),
  field: z.enum(["department", "role"]),
  operator: z.enum(["equals", "notEquals", "contains"]),
  value: z.string().trim().min(1).max(120),
  planId: z.string().uuid(),
});

type RuleCondition = Pick<BenefitPolicyRule, "field" | "operator" | "value">;

type Person = Record<"department" | "role", string>;

const fold = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");

export function matchesBenefitRule(rule: RuleCondition, person: Person) {
  const personValue = person[rule.field];
  const equals = personValue.localeCompare(rule.value, "pt-BR", { sensitivity: "base" }) === 0;

  if (rule.operator === "equals") return equals;

  if (rule.operator === "notEquals") return !equals;

  return fold(personValue).includes(fold(rule.value));
}

export function evaluateBenefitRules(
  rules: BenefitPolicyRule[],
  person: Person,
  planPrices: Map<string, number>,
  defaultPlanId: string | null,
) {
  let best: string | null = null;
  let bestPrice = -1;

  for (const rule of rules) {
    if (!matchesBenefitRule(rule, person)) continue;

    const price = planPrices.get(rule.planId) ?? 0;

    if (price > bestPrice) {
      best = rule.planId;
      bestPrice = price;
    }
  }

  return best ?? defaultPlanId;
}
