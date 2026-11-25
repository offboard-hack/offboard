import type { Database } from "@offboard/db/client";
import { and, asc, eq } from "drizzle-orm";
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
  async function listActionConfigs(orgId: string) {
    return db
      .select(actionConfigColumns)
      .from(actionConfigs)
      .where(eq(actionConfigs.orgId, orgId))
      .orderBy(asc(actionConfigs.actionId));
  }

  async function getActionConfigsByPhase(orgId: string, phase: string) {
    return db
      .select(actionConfigColumns)
      .from(actionConfigs)
      .where(
        and(
          eq(actionConfigs.orgId, orgId),
          eq(actionConfigs.phase, phase),
          eq(actionConfigs.enabled, true),
        ),
      );
  }

  async function getActionConfig(orgId: string, id: string) {
    const [row] = await db
      .select(actionConfigColumns)
      .from(actionConfigs)
      .where(and(eq(actionConfigs.id, id), eq(actionConfigs.orgId, orgId)));

    return row ?? null;
  }

  async function createActionConfig(orgId: string, data: NewActionConfig) {
    const [row] = await db
      .insert(actionConfigs)
      .values({ ...data, orgId })
      .returning(actionConfigColumns);

    return row;
  }

  async function updateActionConfig(orgId: string, id: string, data: Partial<NewActionConfig>) {
    const [row] = await db
      .update(actionConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(actionConfigs.id, id), eq(actionConfigs.orgId, orgId)))
      .returning(actionConfigColumns);

    return row ?? null;
  }

  async function deleteActionConfig(orgId: string, id: string) {
    const rows = await db
      .delete(actionConfigs)
      .where(and(eq(actionConfigs.id, id), eq(actionConfigs.orgId, orgId)))
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
