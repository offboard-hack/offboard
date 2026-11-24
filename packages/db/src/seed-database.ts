import { eq } from "drizzle-orm";
import { seedActionConfigs } from "./action-config.fixture.ts";
import { seedPlans, seedSubscription } from "./billing.fixture.ts";
import { seedEquipment } from "./equipment.fixture.ts";
import type { Database } from "./client.ts";
import { seedExitSurveys } from "./exit-survey.fixture.ts";
import { seedIntegrations } from "./integration.fixture.ts";
import { baseSeedCases, seedCases } from "./offboarding.fixture.ts";
import {
  actionConfigs,
  equipment,
  exitSurveys,
  integrations,
  invoices,
  offboardingCases,
  plans,
  subscriptions,
  subtasks,
  talentProfiles,
  tasks,
  teamMembers,
} from "./schema/index.ts";
import { seedTalentProfiles, type SeedTalentProfile } from "./talent-profile.fixture.ts";
import { baseSeedTeamMembers, seedTeamMembers } from "./team-member.fixture.ts";

const noTalentProfiles: SeedTalentProfile[] = [];

export const testSeedFixtures = {
  cases: baseSeedCases,
  members: baseSeedTeamMembers,
  talentProfiles: noTalentProfiles,
};

export async function seedDatabase(
  db: Database,
  fixtures = { cases: seedCases, members: seedTeamMembers, talentProfiles: seedTalentProfiles },
) {
  await db.transaction(async (tx) => {
    await tx.delete(actionConfigs);
    await tx.delete(invoices);
    await tx.delete(subscriptions);
    await tx.delete(plans);
    await tx.delete(equipment);
    await tx.delete(exitSurveys);
    await tx.delete(subtasks);
    await tx.delete(tasks);
    await tx.delete(talentProfiles);
    await tx.delete(offboardingCases);
    await tx.delete(integrations);
    await tx.delete(teamMembers);

    const caseIds = new Map<string, string>();

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

    for (const { caseName, ...survey } of seedExitSurveys) {
      const caseId = caseIds.get(caseName);

      if (!caseId) continue;

      await tx
        .insert(exitSurveys)
        .values({ caseId, ...survey })
        .onConflictDoUpdate({ target: exitSurveys.caseId, set: survey });
    }

    for (const { caseName, sponsoredForDays, ...profile } of fixtures.talentProfiles) {
      const caseId = caseIds.get(caseName);

      if (!caseId) continue;

      const sponsoredUntil = new Date(Date.now() + sponsoredForDays * 86_400_000)
        .toISOString()
        .slice(0, 10);

      await tx.insert(talentProfiles).values({ caseId, sponsoredUntil, ...profile });
    }

    if (seedIntegrations.length > 0) {
      await tx.insert(integrations).values(seedIntegrations);
    }

    await tx.insert(teamMembers).values(fixtures.members);

    await tx.insert(actionConfigs).values(seedActionConfigs);

    for (const plan of seedPlans) {
      await tx
        .insert(plans)
        .values(plan)
        .onConflictDoUpdate({
          target: plans.slug,
          set: {
            name: plan.name,
            monthlyPriceCents: plan.monthlyPriceCents,
            maxEmployees: plan.maxEmployees,
            features: plan.features,
            updatedAt: new Date(),
          },
        });
    }

    const { planSlug, invoices: seedInvoices, ...subscription } = seedSubscription;
    const [plan] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.slug, planSlug));

    const [createdSubscription] = await tx
      .insert(subscriptions)
      .values({ ...subscription, planId: plan.id })
      .returning({ id: subscriptions.id });

    await tx
      .insert(invoices)
      .values(
        seedInvoices.map((invoice) => ({ ...invoice, subscriptionId: createdSubscription.id })),
      );
  });
}

export { seedCases };
