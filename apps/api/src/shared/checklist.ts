import { z } from "zod";
import { employeeTeam } from "./task-workflow.js";

export const checklistPhases = ["pre", "d0", "first-week", "second-week", "follow-up"] as const;

export const checklistTeams = [
  "RH e DP",
  "TI",
  "Gestão",
  "Financeiro",
  "Jurídico",
  "Facilities",
  employeeTeam,
] as const;

export const actionKinds = ["email", "slack", "webhook"] as const;

const stepRuleSchema = z.object({
  id: z.string().min(1),
  field: z.enum(["department", "role"]),
  operator: z.enum(["equals", "notEquals"]),
  value: z.string().trim().min(1).max(120),
});

const checklistStepSchema = z.object({
  id: z.string().min(1).max(90),
  title: z.string().trim().min(1).max(120),
  team: z.enum(checklistTeams),
  phase: z.enum(checklistPhases),
  deadlineOffset: z.number().int().min(-90).max(90).nullable().optional(),
  deadlineTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  rules: z.array(stepRuleSchema).optional(),
});

export const checklistLayoutSchema = z
  .array(checklistStepSchema)
  .refine(
    (steps) => new Set(steps.map(({ id }) => id)).size === steps.length,
    "Duplicate checklist step ID",
  );

const stepWithActions = checklistStepSchema.extend({
  email: z
    .object({
      subject: z.string().trim().min(1).max(160),
      body: z.string().trim().min(1).max(5000),
    })
    .nullish(),
  slack: z
    .object({
      channel: z.string().trim().min(1).max(80),
      message: z.string().trim().min(1).max(5000),
    })
    .nullish(),
  webhook: z.object({ url: z.url().max(2000), method: z.enum(["POST", "PUT"]) }).nullish(),
});

export const saveChecklistSchema = z.object({
  revision: z.int().min(0).max(2_147_483_646),
  steps: z
    .array(stepWithActions)
    .refine(
      (steps) => new Set(steps.map(({ id }) => id)).size === steps.length,
      "Duplicate checklist step ID",
    ),
  knownRowIds: z.array(z.uuid()),
});

export type ChecklistStep = z.infer<typeof checklistStepSchema>;

export type ChecklistLayout = ChecklistStep[];

export const initialSteps: ChecklistStep[] = [
  { id: "point", title: "Fechar ponto e banco de horas", team: "RH e DP", phase: "d0" },
  {
    id: "invite",
    title: "Enviar convite do app Offboard",
    team: "RH e DP",
    phase: "d0",
  },
  {
    id: "exam",
    title: "Agendar exame demissional",
    team: "RH e DP",
    phase: "first-week",
  },
  {
    id: "documents",
    title: "Conferir a entrega dos documentos",
    team: "RH e DP",
    phase: "second-week",
  },
  {
    id: "review",
    title: "Revisar pendências do desligamento",
    team: "RH e DP",
    phase: "follow-up",
  },
  { id: "access", title: "Bloquear acessos", team: "TI", phase: "d0" },
  {
    id: "files",
    title: "Transferir arquivos e e-mail",
    team: "TI",
    phase: "first-week",
  },
  {
    id: "collect",
    title: "Agendar a coleta de equipamentos",
    team: "TI",
    phase: "first-week",
  },
  {
    id: "inventory",
    title: "Conferir os bens devolvidos",
    team: "TI",
    phase: "second-week",
  },
  {
    id: "handoff",
    title: "Confirmar a passagem de trabalho",
    team: "Gestão",
    phase: "first-week",
  },
  {
    id: "crm",
    title: "Transferir negócios e contatos no CRM",
    team: "Gestão",
    phase: "first-week",
  },
  {
    id: "card",
    title: "Conciliar despesas e cancelar o cartão",
    team: "Financeiro",
    phase: "first-week",
  },
  {
    id: "refunds",
    title: "Revisar reembolsos pendentes",
    team: "Financeiro",
    phase: "second-week",
  },
  {
    id: "certificates",
    title: "Revisar procurações e certificados",
    team: "Jurídico",
    phase: "first-week",
  },
  { id: "badge", title: "Desativar crachá e acesso", team: "Facilities", phase: "d0" },
  {
    id: "confirm",
    title: "Confirmar os itens para devolução",
    team: "Pessoa desligada",
    phase: "first-week",
  },
  {
    id: "survey",
    title: "Responder à pesquisa de desligamento",
    team: "Pessoa desligada",
    phase: "follow-up",
  },
];
