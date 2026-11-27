import type { Database } from "./client.ts";
import { automationRules } from "./schema/index.ts";

type RuleRow = typeof automationRules.$inferInsert;

export const defaultAutomationRules: readonly Omit<RuleRow, "orgId">[] = [
  {
    name: "Correios entregue → equipamento recebido",
    trigger: "correios.delivered",
    conditions: {},
    actions: [{ type: "update_equipment", set: { status: "received" } }],
  },
  {
    name: "Correios entregue → tarefa concluída",
    trigger: "correios.delivered",
    conditions: {},
    actions: [{ type: "update_task", set: { status: "done" } }],
  },
  {
    name: "Todo equipamento devolvido → notificar RH",
    trigger: "equipment.status_changed",
    conditions: {
      "equipment.status": "received",
      "case.allEquipmentReceived": "true",
    },
    actions: [
      {
        type: "slack",
        channel: "#rh",
        message: "Todos os equipamentos de {{case.name}} foram devolvidos",
      },
    ],
  },
  {
    name: "Verificar rastreios Correios",
    trigger: "schedule.cron",
    conditions: {},
    actions: [{ type: "correios_check" }],
    cronSchedule: "0 */4 * * *",
  },
];

export const seedAutomationRules = (db: Database, orgId: string) =>
  db
    .insert(automationRules)
    .values(defaultAutomationRules.map((rule) => ({ ...rule, orgId })))
    .returning();
