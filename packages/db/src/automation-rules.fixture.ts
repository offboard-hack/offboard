import type { Database } from "./client.ts";
import { automationRules } from "./schema/index.ts";

type RuleRow = typeof automationRules.$inferInsert;

export const defaultAutomationRules: readonly Omit<RuleRow, "orgId">[] = [
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
];

export const seedAutomationRules = (db: Pick<Database, "insert">, orgId: string) =>
  db
    .insert(automationRules)
    .values(defaultAutomationRules.map((rule) => ({ ...rule, orgId })))
    .returning();
