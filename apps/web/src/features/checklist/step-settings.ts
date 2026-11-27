import { offboardingDepartments } from "@/entities/offboarding";
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

const slackSchema = z.object({
  channel: z.string().trim().min(1, "Informe o canal.").max(80),
  message: z.string().trim().min(1, "Escreva a mensagem.").max(5000),
});

const webhookSchema = z.object({
  url: z.string().trim().url("Informe uma URL válida.").max(2000),
  method: z.enum(["POST", "PUT"]),
});

export const stepFormSchema = z.object({
  title: z.string().trim().min(1, "Informe o nome da etapa.").max(120, "Use até 120 caracteres."),
  deadlineOffset: z.number().int().min(-90).max(90).nullable(),
  deadlineTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido.")
    .nullable(),
  rules: z.array(stepRuleSchema),
  email: emailSchema.nullable(),
  slack: slackSchema.nullable(),
  webhook: webhookSchema.nullable(),
});

export type StepSettings = z.infer<typeof stepFormSchema>;

export function sameStepSettings(previous: StepSettings, next: StepSettings) {
  return (
    previous.title === next.title &&
    previous.deadlineOffset === next.deadlineOffset &&
    previous.deadlineTime === next.deadlineTime &&
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
    previous.email?.body === next.email?.body &&
    previous.slack?.channel === next.slack?.channel &&
    previous.slack?.message === next.slack?.message &&
    previous.webhook?.url === next.webhook?.url &&
    previous.webhook?.method === next.webhook?.method
  );
}
