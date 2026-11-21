import type { Database } from "./client.ts";
import { seedCases } from "./offboarding.fixture.ts";
import { offboardingCases, offboardingTasks } from "./schema/index.ts";

export async function seedDatabase(db: Database) {
  await db.transaction(async (tx) => {
    await tx.delete(offboardingTasks);
    await tx.delete(offboardingCases);

    for (const { tasks, ...item } of seedCases) {
      const [created] = await tx
        .insert(offboardingCases)
        .values(item)
        .returning({ id: offboardingCases.id });

      await tx.insert(offboardingTasks).values(
        tasks.map(([team, title, status], index) => ({
          caseId: created.id,
          team,
          title,
          status,
          sortOrder: index,
        })),
      );
    }
  });
}
