import type { Database } from "@offboard/db/client";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { actionConfigs, checklistModels } from "@offboard/db/schema";

import type { z } from "zod";
import {
  actionKinds,
  checklistLayoutSchema,
  initialSteps,
  type saveChecklistSchema,
} from "../../shared/checklist.js";

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

  async function getActionConfigsByStep(orgId: string, stepId: string) {
    return db
      .select(actionConfigColumns)
      .from(actionConfigs)
      .where(
        and(
          eq(actionConfigs.orgId, orgId),
          inArray(
            actionConfigs.actionId,
            actionKinds.map((kind) => `${kind}:${stepId}`),
          ),
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

  async function readChecklist(orgId: string) {
    const [model] = await db.select().from(checklistModels).where(eq(checklistModels.orgId, orgId));

    return model
      ? { revision: model.revision, steps: checklistLayoutSchema.parse(model.steps) }
      : { revision: 0, steps: initialSteps };
  }

  async function saveChecklist(
    orgId: string,
    { revision, steps, knownRowIds }: z.infer<typeof saveChecklistSchema>,
  ) {
    const layout = checklistLayoutSchema.parse(steps);

    return db.transaction(async (tx) => {
      const nextRevision = revision + 1;

      const [model] =
        revision === 0
          ? await tx
              .insert(checklistModels)
              .values({ orgId, revision: nextRevision, steps: layout })
              .onConflictDoNothing()
              .returning()
          : await tx
              .update(checklistModels)
              .set({ revision: nextRevision, steps: layout })
              .where(and(eq(checklistModels.orgId, orgId), eq(checklistModels.revision, revision)))
              .returning();

      if (!model) return null;

      const stepsById = new Map(steps.map((step) => [step.id, step]));

      if (knownRowIds.length > 0) {
        const knownRows = await tx
          .select({ id: actionConfigs.id, actionId: actionConfigs.actionId })
          .from(actionConfigs)
          .where(and(eq(actionConfigs.orgId, orgId), inArray(actionConfigs.id, knownRowIds)));

        const removals = knownRows.flatMap(({ id, actionId }) => {
          const kind = actionKinds.find((entry) => actionId.startsWith(entry + ":"));

          if (!kind) return [];

          const step = stepsById.get(actionId.slice(kind.length + 1));

          return !step || step[kind] === null ? [id] : [];
        });

        if (removals.length > 0) {
          await tx
            .delete(actionConfigs)
            .where(and(eq(actionConfigs.orgId, orgId), inArray(actionConfigs.id, removals)));
        }
      }

      const actions = steps.flatMap((step) =>
        actionKinds.flatMap((kind) => {
          const config = step[kind];

          return config
            ? [{ orgId, actionId: `${kind}:${step.id}`, phase: step.phase, config }]
            : [];
        }),
      );

      if (actions.length > 0) {
        await tx
          .insert(actionConfigs)
          .values(actions)
          .onConflictDoUpdate({
            target: [actionConfigs.orgId, actionConfigs.actionId],
            set: {
              phase: sql`excluded.phase`,
              config: sql`excluded.config`,
              updatedAt: new Date(),
            },
            setWhere: sql`${actionConfigs.phase} <> excluded.phase OR ${actionConfigs.config} <> excluded.config`,
          });
      }

      const actionRows = await tx
        .select(actionConfigColumns)
        .from(actionConfigs)
        .where(eq(actionConfigs.orgId, orgId))
        .orderBy(asc(actionConfigs.actionId));

      return { revision: model.revision, steps: layout, actionRows };
    });
  }

  return {
    readChecklist,
    saveChecklist,
    getActionConfigsByStep,
    listActionConfigs,
    getActionConfigsByPhase,
    getActionConfig,
    createActionConfig,
    updateActionConfig,
    deleteActionConfig,
  };
}

export type ActionConfigsRepository = ReturnType<typeof createActionConfigsRepository>;
