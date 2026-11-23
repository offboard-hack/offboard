import { seedActionConfigs } from "./action-config.fixture.ts";
import type { Database } from "./client.ts";
import { seedIntegrations } from "./integration.fixture.ts";
import { seedCases } from "./offboarding.fixture.ts";
import {
  actionConfigs,
  integrations,
  offboardingCases,
  subtasks,
  tasks,
  teamMembers,
} from "./schema/index.ts";
import { seedTeamMembers } from "./team-member.fixture.ts";

export async function seedDatabase(db: Database) {
  await db.transaction(async (tx) => {
    await tx.delete(actionConfigs);
    await tx.delete(subtasks);
    await tx.delete(tasks);
    await tx.delete(offboardingCases);
    await tx.delete(integrations);
    await tx.delete(teamMembers);

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
            phase: seedTask.phase ?? null,
            description: seedTask.description ?? null,
            dueDate: seedTask.dueDate ?? null,
            trackingCode: seedTask.trackingCode ?? null,
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

    await tx.insert(teamMembers).values(seedTeamMembers);

    await tx.insert(actionConfigs).values(seedActionConfigs);
  });
}

export { seedCases };
