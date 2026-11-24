import type { ConfigValue, RuleAction, RuleTrigger } from "./schema/index.ts";

export type SeedAutomationRule = {
  name: string;
  trigger: RuleTrigger;
  conditions: Record<string, ConfigValue>;
  actions: RuleAction[];
  enabled: boolean;
  cronSchedule: string | null;
};

export const seedAutomationRules: SeedAutomationRule[] = [
  {
    name: "Correios entregue → equipamento recebido",
    trigger: "correios.delivered",
    conditions: {},
    actions: [{ type: "update_equipment", set: { status: "received" } }],
    enabled: true,
    cronSchedule: null,
  },
  {
    name: "Correios entregue → tarefa concluída",
    trigger: "correios.delivered",
    conditions: {},
    actions: [{ type: "update_task", set: { status: "done" } }],
    enabled: true,
    cronSchedule: null,
  },
  {
    name: "Todo equipamento devolvido → notificar RH",
    trigger: "equipment.status_changed",
    conditions: { "equipment.status": "received", "case.allEquipmentReceived": true },
    actions: [
      {
        type: "slack",
        channel: "#rh",
        message: "Todos os equipamentos de {{case}} foram devolvidos",
      },
    ],
    enabled: true,
    cronSchedule: null,
  },
  {
    name: "Verificar rastreios Correios",
    trigger: "schedule.cron",
    conditions: {},
    actions: [{ type: "correios_check" }],
    enabled: true,
    cronSchedule: "0 */4 * * *",
  },
];
