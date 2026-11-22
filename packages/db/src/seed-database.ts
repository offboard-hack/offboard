import type { Database } from "./client.ts";
import { seedIntegrations } from "./integration.fixture.ts";
import { seedCases } from "./offboarding.fixture.ts";
import { integrations, offboardingCases, subtasks, tasks } from "./schema/index.ts";

export async function seedDatabase(db: Database) {
  await db.transaction(async (tx) => {
    await tx.delete(subtasks);
    await tx.delete(tasks);
    await tx.delete(offboardingCases);
    await tx.delete(integrations);

    for (const { tasks: caseTasks, ...item } of seedCases) {
      const [created] = await tx
        .insert(offboardingCases)
        .values(item)
        .returning({ id: offboardingCases.id });

      for (let i = 0; i < caseTasks.length; i++) {
        const seedTask = caseTasks[i];

        const [inserted] = await tx
          .insert(tasks)
          .values({
            caseId: created.id,
            team: seedTask.team,
            title: seedTask.title,
            status: seedTask.status,
            description: seedTask.description ?? null,
            dueDate: seedTask.dueDate ?? null,
            position: i,
          })
          .returning({ id: tasks.id });

        if (seedTask.subtasks && seedTask.subtasks.length > 0) {
          await tx.insert(subtasks).values(
            seedTask.subtasks.map((sub, j) => ({
              taskId: inserted.id,
              title: sub.title,
              done: sub.done,
              position: j,
            })),
          );
        }
      }
    }

    if (seedIntegrations.length > 0) {
      await tx.insert(integrations).values(seedIntegrations);
    }
  });
}
