import { z } from "zod";
import type { AutomationRuleRow } from "@/entities/automation-rule";

type Trigger = AutomationRuleRow["trigger"];

type Action = AutomationRuleRow["actions"][number];

type ConfigValue =
  | boolean
  | number
  | string
  | null
  | ConfigValue[]
  | { [key: string]: ConfigValue };

const triggerOrder = [
  "task.status_changed",
  "equipment.status_changed",
  "correios.delivered",
  "schedule.cron",
] as const;

const actionTypes = [
  "update_task",
  "update_equipment",
  "slack",
  "email",
  "webhook",
  "correios_check",
] as const;

export const triggerLabels = {
  "task.status_changed": "Status da tarefa mudou",
  "equipment.status_changed": "Status do equipamento mudou",
  "correios.delivered": "Correios: entregue",
  "schedule.cron": "Agendamento",
} satisfies Record<Trigger, string>;

export const actionLabels = {
  update_task: "Atualizar tarefa",
  update_equipment: "Atualizar equipamento",
  slack: "Slack",
  email: "E-mail",
  webhook: "Webhook",
  correios_check: "Consultar Correios",
} satisfies Record<Action["type"], string>;

export const triggerItems = triggerOrder.map((value) => ({
  value,
  label: triggerLabels[value],
}));

export const defaultActionsJson = JSON.stringify([{ type: "slack" }], null, 2);

export function summarizeActions(actions: Action[]) {
  if (actions.length === 0) return "Nenhuma ação";

  return actions.map(({ type }) => actionLabels[type]).join(", ");
}

const configValue: z.ZodType<ConfigValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(configValue),
    z.record(z.string(), configValue),
  ]),
);

const conditionsSchema = z.record(z.string(), z.string());

const actionsSchema = z.array(z.object({ type: z.enum(actionTypes) }).catchall(configValue));

function parseWith<Schema extends z.ZodType>(schema: Schema, text: string) {
  try {
    return schema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

export function parseConditions(text: string) {
  if (text.trim() === "") return {};

  return parseWith(conditionsSchema, text);
}

export function parseActions(text: string) {
  return parseWith(actionsSchema, text);
}
