import type { Database } from "@offboard/db/client";
import { and, asc, eq, inArray } from "drizzle-orm";
import { actionConfigs, automationRules, checklistModels } from "@offboard/db/schema";

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

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type RuleDraft = Pick<
  typeof automationRules.$inferInsert,
  "name" | "trigger" | "conditions" | "actions" | "enabled" | "cronSchedule" | "sourceRef"
>;

export type ChecklistRules = (tx: Transaction) => {
  upsertBySourceRef: (orgId: string, sourceRef: string, data: RuleDraft) => Promise<{ id: string }>;
  listRules: (orgId: string) => Promise<
    Array<{
      id: string;
      sourceRef: string | null;
      enabled: boolean;
      actions: typeof automationRules.$inferSelect.actions;
    }>
  >;
};

export function createActionConfigsRepository(db: Database, checklistRules: ChecklistRules) {
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

  async function readChecklist(orgId: string) {
    const [model] = await db.select().from(checklistModels).where(eq(checklistModels.orgId, orgId));

    return model
      ? {
          revision: model.revision,
          steps: checklistLayoutSchema.parse(model.steps),
          template: initialSteps,
        }
      : { revision: 0, steps: initialSteps, template: initialSteps };
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

      const rules = checklistRules(tx);
      const stepsById = new Map(steps.map((step) => [step.id, step]));

      if (knownRowIds.length > 0) {
        const knownRows = await tx
          .select({ id: automationRules.id, sourceRef: automationRules.sourceRef })
          .from(automationRules)
          .where(and(eq(automationRules.orgId, orgId), inArray(automationRules.id, knownRowIds)));

        const removals = knownRows.flatMap(({ id, sourceRef }) => {
          const kind = actionKinds.find((entry) => sourceRef?.startsWith(entry + ":"));

          if (!kind || !sourceRef) return [];

          const step = stepsById.get(sourceRef.slice(kind.length + 1));

          return !step || step[kind] === null ? [id] : [];
        });

        if (removals.length > 0) {
          await tx
            .delete(automationRules)
            .where(and(eq(automationRules.orgId, orgId), inArray(automationRules.id, removals)));
        }
      }

      for (const step of steps) {
        for (const kind of actionKinds) {
          const config = step[kind];

          if (config) {
            const sourceRef = `${kind}:${step.id}`;

            await rules.upsertBySourceRef(orgId, sourceRef, {
              name: `${kind}: ${step.title}`,
              trigger: "task.status_changed",
              conditions: { "task.stepId": step.id },
              actions: [{ type: kind, ...config }],
              cronSchedule: null,
              sourceRef,
            });
          }
        }
      }

      const actionRows = (await rules.listRules(orgId)).flatMap(
        ({ id, sourceRef, enabled, actions }) => {
          if (!sourceRef) return [];

          const { type: _type, ...config } = actions[0] ?? {};
          const stepId = sourceRef.slice(sourceRef.indexOf(":") + 1);

          return [
            { id, actionId: sourceRef, enabled, config, phase: stepsById.get(stepId)?.phase ?? "" },
          ];
        },
      );

      actionRows.sort((a, b) => a.actionId.localeCompare(b.actionId));

      return { revision: model.revision, steps: layout, actionRows };
    });
  }

  return {
    readChecklist,
    saveChecklist,
    listActionConfigs,
    getActionConfigsByPhase,
    getActionConfig,
    createActionConfig,
    updateActionConfig,
    deleteActionConfig,
  };
}

export type ActionConfigsRepository = ReturnType<typeof createActionConfigsRepository>;
