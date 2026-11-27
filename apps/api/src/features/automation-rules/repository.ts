import type { Database } from "@offboard/db/client";
import { automationRules, type RuleTrigger } from "@offboard/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

type NewRule = Pick<
  typeof automationRules.$inferInsert,
  "name" | "trigger" | "conditions" | "actions" | "enabled" | "cronSchedule" | "sourceRef"
>;

const ruleColumns = {
  id: automationRules.id,
  name: automationRules.name,
  trigger: automationRules.trigger,
  conditions: automationRules.conditions,
  actions: automationRules.actions,
  enabled: automationRules.enabled,
  cronSchedule: automationRules.cronSchedule,
  sourceRef: automationRules.sourceRef,
};

export function createAutomationRulesRepository(
  db: Pick<Database, "select" | "insert" | "update" | "delete">,
) {
  async function listRules(orgId: string) {
    return db
      .select(ruleColumns)
      .from(automationRules)
      .where(eq(automationRules.orgId, orgId))
      .orderBy(asc(automationRules.createdAt), asc(automationRules.id));
  }

  async function getRule(orgId: string, id: string) {
    const [row] = await db
      .select(ruleColumns)
      .from(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.orgId, orgId)));

    return row ?? null;
  }

  async function createRule(orgId: string, data: NewRule) {
    const [row] = await db
      .insert(automationRules)
      .values({ ...data, orgId })
      .returning(ruleColumns);

    return row;
  }

  async function updateRule(orgId: string, id: string, data: Partial<NewRule>) {
    const [row] = await db
      .update(automationRules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(automationRules.id, id), eq(automationRules.orgId, orgId)))
      .returning(ruleColumns);

    return row ?? null;
  }

  async function deleteRule(orgId: string, id: string) {
    const rows = await db
      .delete(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.orgId, orgId)))
      .returning({ id: automationRules.id });

    return rows.length > 0;
  }

  async function getEnabledRulesByTrigger(orgId: string, trigger: RuleTrigger) {
    return db
      .select(ruleColumns)
      .from(automationRules)
      .where(
        and(
          eq(automationRules.orgId, orgId),
          eq(automationRules.trigger, trigger),
          eq(automationRules.enabled, true),
        ),
      )
      .orderBy(asc(automationRules.createdAt), asc(automationRules.id));
  }

  async function getAllCronRules() {
    return db
      .select({ ...ruleColumns, orgId: automationRules.orgId })
      .from(automationRules)
      .where(and(eq(automationRules.trigger, "schedule.cron"), eq(automationRules.enabled, true)))
      .orderBy(asc(automationRules.createdAt), asc(automationRules.id));
  }

  async function upsertBySourceRef(orgId: string, sourceRef: string, data: NewRule) {
    const [row] = await db
      .insert(automationRules)
      .values({ ...data, orgId, sourceRef })
      .onConflictDoUpdate({
        target: [automationRules.orgId, automationRules.sourceRef],
        targetWhere: sql`${automationRules.sourceRef} IS NOT NULL`,
        set: {
          name: sql`excluded.name`,
          trigger: sql`excluded.trigger`,
          conditions: sql`excluded.conditions`,
          actions: sql`excluded.actions`,
          enabled: sql`excluded.enabled`,
          cronSchedule: sql`excluded.cron_schedule`,
          updatedAt: new Date(),
        },
      })
      .returning(ruleColumns);

    return row;
  }

  async function deleteBySourceRef(orgId: string, sourceRef: string) {
    const rows = await db
      .delete(automationRules)
      .where(and(eq(automationRules.orgId, orgId), eq(automationRules.sourceRef, sourceRef)))
      .returning({ id: automationRules.id });

    return rows.length > 0;
  }

  return {
    listRules,
    getRule,
    createRule,
    updateRule,
    deleteRule,
    getEnabledRulesByTrigger,
    getAllCronRules,
    upsertBySourceRef,
    deleteBySourceRef,
  };
}

export type AutomationRulesRepository = ReturnType<typeof createAutomationRulesRepository>;
