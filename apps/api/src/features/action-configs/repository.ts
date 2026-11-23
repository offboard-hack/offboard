import type { Database } from "@offboard/db/client";
import { asc, eq, sql } from "drizzle-orm";
import { actionConfigs } from "@offboard/db/schema";

type NewActionConfig = Pick<
  typeof actionConfigs.$inferInsert,
  "actionId" | "enabled" | "config" | "phase"
>;

const actionConfigColumns = {
  id: actionConfigs.id,
  actionId: actionConfigs.actionId,
  enabled: actionConfigs.enabled,
  config: actionConfigs.config,
  phase: actionConfigs.phase,
};

export function createActionConfigsRepository(db: Database) {
  async function listActionConfigs() {
    return db.select(actionConfigColumns).from(actionConfigs).orderBy(asc(actionConfigs.actionId));
  }

  async function getActionConfigsByPhase(phase: string) {
    return db
      .select(actionConfigColumns)
      .from(actionConfigs)
      .where(sql`${actionConfigs.phase} = ${phase} AND ${actionConfigs.enabled} = true`);
  }

  async function getActionConfig(id: string) {
    const [row] = await db
      .select(actionConfigColumns)
      .from(actionConfigs)
      .where(eq(actionConfigs.id, id));

    return row ?? null;
  }

  async function createActionConfig(data: NewActionConfig) {
    const [row] = await db.insert(actionConfigs).values(data).returning(actionConfigColumns);

    return row;
  }

  async function updateActionConfig(id: string, data: Partial<NewActionConfig>) {
    const [row] = await db
      .update(actionConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(actionConfigs.id, id))
      .returning(actionConfigColumns);

    return row ?? null;
  }

  async function deleteActionConfig(id: string) {
    const rows = await db
      .delete(actionConfigs)
      .where(eq(actionConfigs.id, id))
      .returning({ id: actionConfigs.id });

    return rows.length > 0;
  }

  return {
    listActionConfigs,
    getActionConfigsByPhase,
    getActionConfig,
    createActionConfig,
    updateActionConfig,
    deleteActionConfig,
  };
}

export type ActionConfigsRepository = ReturnType<typeof createActionConfigsRepository>;
