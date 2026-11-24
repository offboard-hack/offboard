import type { Database } from "@offboard/db/client";
import { automationRules, type RuleTrigger } from "@offboard/db/schema";
import { and, asc, eq, isNotNull } from "drizzle-orm";

type NewRule = Pick<
  typeof automationRules.$inferInsert,
  "name" | "trigger" | "conditions" | "actions" | "enabled" | "cronSchedule"
>;

const ruleColumns = {
  id: automationRules.id,
  name: automationRules.name,
  trigger: automationRules.trigger,
  conditions: automationRules.conditions,
  actions: automationRules.actions,
  enabled: automationRules.enabled,
  cronSchedule: automationRules.cronSchedule,
};

export function createAutomationRulesRepository(db: Database) {
  async function listRules() {
    return db
      .select(ruleColumns)
      .from(automationRules)
      .orderBy(asc(automationRules.createdAt), asc(automationRules.name));
  }

  async function getRule(id: string) {
    const [row] = await db
      .select(ruleColumns)
      .from(automationRules)
      .where(eq(automationRules.id, id));

    return row ?? null;
  }

  async function createRule(data: NewRule) {
    const [row] = await db.insert(automationRules).values(data).returning(ruleColumns);

    return row;
  }

  async function updateRule(id: string, data: Partial<NewRule>) {
    const [row] = await db
      .update(automationRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(automationRules.id, id))
      .returning(ruleColumns);

    return row ?? null;
  }

  async function deleteRule(id: string) {
    const rows = await db
      .delete(automationRules)
      .where(eq(automationRules.id, id))
      .returning({ id: automationRules.id });

    return rows.length > 0;
  }

  async function getEnabledRulesByTrigger(trigger: RuleTrigger) {
    return db
      .select(ruleColumns)
      .from(automationRules)
      .where(and(eq(automationRules.trigger, trigger), eq(automationRules.enabled, true)))
      .orderBy(asc(automationRules.createdAt), asc(automationRules.name));
  }

  async function getCronRules() {
    return db
      .select(ruleColumns)
      .from(automationRules)
      .where(
        and(
          eq(automationRules.trigger, "schedule.cron"),
          eq(automationRules.enabled, true),
          isNotNull(automationRules.cronSchedule),
        ),
      )
      .orderBy(asc(automationRules.createdAt), asc(automationRules.name));
  }

  return {
    listRules,
    getRule,
    createRule,
    updateRule,
    deleteRule,
    getEnabledRulesByTrigger,
    getCronRules,
  };
}

export type AutomationRulesRepository = ReturnType<typeof createAutomationRulesRepository>;
