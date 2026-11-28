import type { Database } from "@offboard/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { automationRules, checklistModels } from "@offboard/db/schema";

import type { z } from "zod";
import {
  actionKinds,
  checklistLayoutSchema,
  initialSteps,
  type saveChecklistSchema,
} from "../../shared/checklist.js";

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
  };
}

export type ActionConfigsRepository = ReturnType<typeof createActionConfigsRepository>;
