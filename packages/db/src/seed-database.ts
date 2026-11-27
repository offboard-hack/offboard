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
  defaultOrgId,
  equipment,
  exitSurveys,
  integrations,
  invoices,
  offboardingCases,
  organizations,
  plans,
  subscriptions,
  subtasks,
  tasks,
  teamMembers,
} from "./schema/index.ts";
import { baseSeedTeamMembers, seedTeamMembers } from "./team-member.fixture.ts";

export const testSeedFixtures = {
  cases: baseSeedCases,
  members: baseSeedTeamMembers,
};

export async function seedDatabase(
  db: Database,
  fixtures = { cases: seedCases, members: seedTeamMembers },
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
    await tx.delete(offboardingCases);
    await tx.delete(integrations);
    await tx.delete(teamMembers);

    await tx
      .insert(organizations)
      .values({ id: defaultOrgId, name: "Default", slug: "default" })
      .onConflictDoNothing();

    const caseIds = new Map<string, string>();

    for (const { tasks: caseTasks, ...item } of fixtures.cases) {
      const [created] = await tx
        .insert(offboardingCases)
        .values({ ...item, orgId: defaultOrgId })
        .returning({ id: offboardingCases.id });

      caseIds.set(item.name, created.id);

      for (let i = 0; i < caseTasks.length; i++) {
        const seedTask = caseTasks[i];

        const [inserted] = await tx
          .insert(tasks)
          .values({
            orgId: defaultOrgId,
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
              orgId: defaultOrgId,
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

      const values = { ...item, orgId: defaultOrgId, caseId, scheduledDate: scheduledDate ?? null };

      await tx
        .insert(equipment)
        .values(values)
        .onConflictDoUpdate({
          target: [equipment.orgId, equipment.tag],
          set: { ...values, updatedAt: new Date() },
        });
    }

    for (const { caseName, ...survey } of seedExitSurveys) {
      const caseId = caseIds.get(caseName);

      if (!caseId) continue;

      await tx
        .insert(exitSurveys)
        .values({ orgId: defaultOrgId, caseId, ...survey })
        .onConflictDoUpdate({ target: exitSurveys.caseId, set: survey });
    }

    if (seedIntegrations.length > 0) {
      await tx
        .insert(integrations)
        .values(seedIntegrations.map((i) => ({ ...i, orgId: defaultOrgId })));
    }

    await tx
      .insert(teamMembers)
      .values(fixtures.members.map((m) => ({ ...m, orgId: defaultOrgId })));

    await tx
      .insert(actionConfigs)
      .values(seedActionConfigs.map((a) => ({ ...a, orgId: defaultOrgId })));

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
      .values({ ...subscription, orgId: defaultOrgId, planId: plan.id })
      .returning({ id: subscriptions.id });

    await tx.insert(invoices).values(
      seedInvoices.map((invoice) => ({
        ...invoice,
        orgId: defaultOrgId,
        subscriptionId: createdSubscription.id,
      })),
    );
  });
}

export { seedCases };
