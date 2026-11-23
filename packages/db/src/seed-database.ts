import { seedActionConfigs } from "./action-config.fixture.ts";
import { seedEquipment } from "./equipment.fixture.ts";
import type { Database } from "./client.ts";
import { seedIntegrations } from "./integration.fixture.ts";
import { baseSeedCases, seedCases } from "./offboarding.fixture.ts";
import {
  actionConfigs,
  equipment,
  integrations,
  offboardingCases,
  subtasks,
  tasks,
  teamMembers,
} from "./schema/index.ts";
import { baseSeedTeamMembers, seedTeamMembers } from "./team-member.fixture.ts";

export const testSeedFixtures = { cases: baseSeedCases, members: baseSeedTeamMembers };

export async function seedDatabase(
  db: Database,
  fixtures = { cases: seedCases, members: seedTeamMembers },
) {
  await db.transaction(async (tx) => {
    const caseIds = new Map<string, string>();

    await tx.delete(actionConfigs);
    await tx.delete(equipment);
    await tx.delete(subtasks);
    await tx.delete(tasks);
    await tx.delete(offboardingCases);
    await tx.delete(integrations);
    await tx.delete(teamMembers);

    for (const { tasks: caseTasks, ...item } of fixtures.cases) {
      const [created] = await tx
        .insert(offboardingCases)
        .values(item)
        .returning({ id: offboardingCases.id });

      caseIds.set(item.name, created.id);

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

    for (const { person, scheduledDate, ...item } of seedEquipment) {
      const caseId = caseIds.get(person);

      if (!caseId) continue;

      const values = { ...item, caseId, scheduledDate: scheduledDate ?? null };

      await tx
        .insert(equipment)
        .values(values)
        .onConflictDoUpdate({ target: equipment.tag, set: { ...values, updatedAt: new Date() } });
    }

    if (seedIntegrations.length > 0) {
      await tx.insert(integrations).values(seedIntegrations);
    }

    await tx.insert(teamMembers).values(fixtures.members);

    await tx.insert(actionConfigs).values(seedActionConfigs);
  });
}

export { seedCases };
