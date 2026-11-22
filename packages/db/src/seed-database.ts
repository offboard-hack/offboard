import type { Database } from "./client.ts";
import { seedIntegrations } from "./integration.fixture.ts";
import { seedCases } from "./offboarding.fixture.ts";
import { integrations, offboardingCases, tasks } from "./schema/index.ts";

export async function seedDatabase(db: Database) {
  await db.transaction(async (tx) => {
    await tx.delete(tasks);
    await tx.delete(offboardingCases);
    await tx.delete(integrations);

    for (const { tasks: caseTasks, ...item } of seedCases) {
      const [created] = await tx
        .insert(offboardingCases)
        .values(item)
        .returning({ id: offboardingCases.id });

      await tx.insert(tasks).values(
        caseTasks.map(([team, title, status], index) => ({
          caseId: created.id,
          team,
          title,
          status,
          position: index,
        })),
      );
    }

    if (seedIntegrations.length > 0) {
      await tx.insert(integrations).values(seedIntegrations);
    }
  });
}
