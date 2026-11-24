import { z } from "zod";
import type { RuleAction, RuleTrigger } from "@/entities/automation-rule";

export const triggerLabels = {
  "equipment.status_changed": "Status do equipamento mudou",
  "task.status_changed": "Status da tarefa mudou",
  "correios.delivered": "Correios: objeto entregue",
  "correios.in_transit": "Correios: objeto em trânsito",
  "schedule.cron": "Agendamento recorrente",
} satisfies Record<RuleTrigger, string>;

export const ruleTriggerSchema = z.enum([
  "equipment.status_changed",
  "task.status_changed",
  "correios.delivered",
  "correios.in_transit",
  "schedule.cron",
] satisfies RuleTrigger[]);

export const triggerItems = Object.entries(triggerLabels).map(([value, label]) => ({
  value,
  label,
}));

export const actionLabels = {
  update_task: "Atualizar tarefa",
  update_equipment: "Atualizar equipamento",
  slack: "Enviar Slack",
  email: "Enviar e-mail",
  webhook: "Chamar webhook",
  correios_check: "Verificar rastreios Correios",
} satisfies Record<RuleAction["type"], string>;

const actionTypes = [
  "update_task",
  "update_equipment",
  "slack",
  "email",
  "webhook",
  "correios_check",
] satisfies RuleAction["type"][];

export const defaultActionsJson = JSON.stringify(
  [{ type: "update_task", set: { status: "done" } }],
  null,
  2,
);

export function summarizeActions(actions: RuleAction[]) {
  if (actions.length === 0) return "Nenhuma ação";

  return actions.map(({ type }) => actionLabels[type]).join(", ");
}

const conditionsSchema = z.record(z.string(), z.json());

const actionsSchema = z.array(z.object({ type: z.enum(actionTypes) }).catchall(z.json()));

function parseJson(source: string) {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

export function parseConditions(source: string) {
  const parsed = conditionsSchema.safeParse(parseJson(source.trim() === "" ? "{}" : source));

  return parsed.success ? parsed.data : null;
}

export function parseActions(source: string) {
  const parsed = actionsSchema.safeParse(parseJson(source));

  return parsed.success ? parsed.data : null;
}
