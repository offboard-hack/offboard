import type { BenefitPlanOption } from "@/entities/benefits-summary";
import { createLocalId } from "@/shared/lib/create-local-id";
import { z } from "zod";

const ruleSchema = z.object({
  id: z.string().min(1),
  field: z.enum(["department", "role"]),
  operator: z.enum(["equals", "notEquals", "contains"]),
  value: z.string().trim().min(1, "Informe o valor da condição.").max(120),
  planId: z.string().min(1, "Escolha um plano."),
});

export const benefitPolicySchema = z.object({
  defaultPlanId: z.string().nullable(),
  benefitDurationMonths: z.number().int().min(1).max(24),
  rules: z.array(ruleSchema).max(100),
});

export type BenefitPolicyForm = z.infer<typeof benefitPolicySchema>;

export type RuleFormRow = z.infer<typeof ruleSchema>;

export const durationOptions = Array.from({ length: 24 }, (_, index) => {
  const months = index + 1;

  return { value: String(months), label: `${months} ${months === 1 ? "mês" : "meses"}` };
});

export const ruleFieldOptions = [
  { value: "department", label: "Área" },
  { value: "role", label: "Cargo" },
];

export const ruleOperatorOptions = [
  { value: "equals", label: "É igual a" },
  { value: "notEquals", label: "É diferente de" },
  { value: "contains", label: "Contém" },
];

export function emptyRule(plans: BenefitPlanOption[]) {
  const rule: RuleFormRow = {
    id: createLocalId(),
    field: "department",
    operator: "equals",
    value: "",
    planId: plans[0]?.id ?? "",
  };

  return rule;
}
