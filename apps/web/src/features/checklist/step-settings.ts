import { offboardingDepartments, type CaseSummary } from "@/entities/offboarding";
import { z } from "zod";

const stepRuleSchema = z
  .object({
    id: z.string().min(1),
    field: z.enum(["department", "role"]),
    operator: z.enum(["equals", "notEquals"]),
    value: z.string().trim().min(1, "Informe o valor da condição.").max(120),
  })
  .superRefine(({ field, value }, ctx) => {
    if (field === "department" && value && !offboardingDepartments.includes(value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Escolha uma área." });
    }
  });

const emailSchema = z.object({
  subject: z.string().trim().min(1, "Informe o assunto.").max(160),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(5000),
});

export const stepFormSchema = z.object({
  title: z.string().trim().min(1, "Informe o nome da etapa.").max(120, "Use até 120 caracteres."),
  deadlineOffset: z.number().int().min(-90).max(90).nullable(),
  rules: z.array(stepRuleSchema),
  email: emailSchema.nullable(),
});

export type StepSettings = z.infer<typeof stepFormSchema>;

type Rule = StepSettings["rules"][number];

export function matchesStepRules(rules: Rule[], person: Pick<CaseSummary, "department" | "role">) {
  return rules.every(({ field, operator, value }) => {
    const matches =
      person[field].trim().localeCompare(value.trim(), "pt-BR", { sensitivity: "base" }) === 0;

    return operator === "equals" ? matches : !matches;
  });
}

export function sameStepSettings(previous: StepSettings, next: StepSettings) {
  return (
    previous.title === next.title &&
    previous.deadlineOffset === next.deadlineOffset &&
    previous.rules.length === next.rules.length &&
    previous.rules.every((rule, index) => {
      const other = next.rules[index];

      return (
        rule.id === other.id &&
        rule.field === other.field &&
        rule.operator === other.operator &&
        rule.value === other.value
      );
    }) &&
    previous.email?.subject === next.email?.subject &&
    previous.email?.body === next.email?.body
  );
}
