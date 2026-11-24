import { eq } from "drizzle-orm";
import {
  applicationStages,
  interviewStart,
  seedApplications,
  seedInterviews,
  type SeedApplication,
  type SeedInterview,
} from "./application.fixture.ts";
import { seedActionConfigs } from "./action-config.fixture.ts";
import { seedPlans, seedSubscription } from "./billing.fixture.ts";
import { seedEquipment } from "./equipment.fixture.ts";
import type { Database } from "./client.ts";
import { seedExitSurveys } from "./exit-survey.fixture.ts";
import { seedJobMatches, type SeedJobMatch } from "./job-match.fixture.ts";
import { seedJobs, type SeedJob } from "./job.fixture.ts";
import { seedIntegrations } from "./integration.fixture.ts";
import { baseSeedCases, seedCases } from "./offboarding.fixture.ts";
import {
  actionConfigs,
  applicationEvents,
  applications,
  backgroundJobs,
  equipment,
  exitSurveys,
  integrations,
  interviews,
  invoices,
  jobMatches,
  jobs,
  offboardingCases,
  plans,
  resumeSuggestions,
  resumes,
  subscriptions,
  subtasks,
  talentProfiles,
  tasks,
  teamMembers,
} from "./schema/index.ts";
import {
  seedResumes,
  seedTailoredResumes,
  type SeedResume,
  type SeedTailoredResume,
} from "./resume.fixture.ts";
import { seedTalentProfiles, type SeedTalentProfile } from "./talent-profile.fixture.ts";
import { baseSeedTeamMembers, seedTeamMembers } from "./team-member.fixture.ts";

const noTalentProfiles: SeedTalentProfile[] = [];
const noJobs: SeedJob[] = [];
const noApplications: SeedApplication[] = [];
const noInterviews: SeedInterview[] = [];
const noResumes: SeedResume[] = [];
const noTailoredResumes: SeedTailoredResume[] = [];
const noJobMatches: SeedJobMatch[] = [];

export const testSeedFixtures = {
  cases: baseSeedCases,
  members: baseSeedTeamMembers,
  talentProfiles: noTalentProfiles,
  jobs: noJobs,
  applications: noApplications,
  interviews: noInterviews,
  resumes: noResumes,
  tailoredResumes: noTailoredResumes,
  jobMatches: noJobMatches,
};

export async function seedDatabase(
  db: Database,
  fixtures = {
    cases: seedCases,
    members: seedTeamMembers,
    talentProfiles: seedTalentProfiles,
    jobs: seedJobs,
    applications: seedApplications,
    interviews: seedInterviews,
    resumes: seedResumes,
    tailoredResumes: seedTailoredResumes,
    jobMatches: seedJobMatches,
  },
) {
  await db.transaction(async (tx) => {
    await tx.delete(backgroundJobs);
    await tx.delete(jobMatches);
    await tx.delete(resumes);
    await tx.delete(interviews);
    await tx.delete(applicationEvents);
    await tx.delete(applications);
    await tx.delete(jobs);
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

    let seededProfileId: string | undefined;
    const profileIds = new Map<string, string>();
    const resumeVersions = new Map<string, Date>();

    for (const { caseName, sponsoredForDays, ...profile } of fixtures.talentProfiles) {
      const caseId = caseIds.get(caseName);

      if (!caseId) continue;

      const sponsoredUntil = new Date(Date.now() + sponsoredForDays * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const [inserted] = await tx
        .insert(talentProfiles)
        .values({ caseId, sponsoredUntil, ...profile })
        .returning({ id: talentProfiles.id });

      seededProfileId ??= inserted.id;
      profileIds.set(caseName, inserted.id);

      for (const resume of fixtures.resumes.filter((item) => item.caseName === caseName)) {
        const scoredAt = new Date(Date.now() - resume.scoredDaysAgo * 86_400_000);

        const [insertedResume] = await tx
          .insert(resumes)
          .values({
            profileId: inserted.id,
            kind: "base",
            content: resume.content,
            score: resume.score,
            scoredAt,
            updatedAt: scoredAt,
          })
          .returning({ id: resumes.id });

        resumeVersions.set(caseName, scoredAt);

        const nodes = [
          resume.content.headline,
          resume.content.summary,
          ...resume.content.experiences.flatMap((experience) => experience.bullets),
        ];

        for (const [index, suggestion] of resume.suggestions.entries()) {
          const originalText = nodes.find((node) => node.id === suggestion.targetNodeId)?.text;

          if (originalText === undefined) {
            throw new Error(`Seed suggestion targets unknown node ${suggestion.targetNodeId}`);
          }

          const createdAt = new Date(scoredAt.getTime() + index * 1_000);

          await tx.insert(resumeSuggestions).values({
            resumeId: insertedResume.id,
            originalText,
            ...suggestion,
            createdAt,
            updatedAt: createdAt,
          });
        }
      }
    }

    const insertedJobs =
      fixtures.jobs.length > 0
        ? await tx.insert(jobs).values(fixtures.jobs).returning({ id: jobs.id })
        : [];

    for (const match of fixtures.jobMatches) {
      const profileId = profileIds.get(match.caseName);
      const resumeUpdatedAt = resumeVersions.get(match.caseName);

      if (!profileId || !resumeUpdatedAt) {
        throw new Error(`Seed job match needs a profile and résumé for ${match.caseName}`);
      }

      await tx.insert(jobMatches).values({
        profileId,
        jobId: insertedJobs[match.jobIndex].id,
        score: match.score,
        reasons: match.reasons,
        resumeUpdatedAt,
        computedAt: resumeUpdatedAt,
      });
    }

    const tailoredResumeIds = new Map<number, string>();

    for (const tailored of fixtures.tailoredResumes) {
      const profileId = profileIds.get(tailored.caseName);
      const scoredAt = resumeVersions.get(tailored.caseName);

      if (!profileId || !scoredAt) {
        throw new Error(`Seed tailored résumé needs a profile and résumé for ${tailored.caseName}`);
      }

      const [insertedTailored] = await tx
        .insert(resumes)
        .values({
          profileId,
          kind: "tailored",
          status: tailored.status,
          jobId: insertedJobs[tailored.jobIndex].id,
          content: tailored.content,
          matchScore: tailored.matchScore,
          updatedAt: scoredAt,
        })
        .returning({ id: resumes.id });

      tailoredResumeIds.set(tailored.jobIndex, insertedTailored.id);
    }

    const applicationIds: string[] = [];

    for (const item of fixtures.applications) {
      if (!seededProfileId) {
        throw new Error("Seeding applications requires at least one talent profile");
      }

      const appliedAt = new Date(Date.now() - item.appliedDaysAgo * 86_400_000);
      const stages = applicationStages.slice(0, applicationStages.indexOf(item.status) + 1);
      const at = (stage: number) => new Date(appliedAt.getTime() + stage * 2 * 3_600_000);

      const [created] = await tx
        .insert(applications)
        .values({
          profileId: seededProfileId,
          jobId: insertedJobs[item.jobIndex].id,
          resumeId: item.usesTailoredResume ? tailoredResumeIds.get(item.jobIndex) : null,
          status: item.status,
          furthestStage: item.status,
          appliedAt,
          statusChangedAt: at(stages.length - 1),
        })
        .returning({ id: applications.id });

      applicationIds.push(created.id);

      await tx.insert(applicationEvents).values(
        stages.map((status, stage) => ({
          applicationId: created.id,
          status,
          createdAt: at(stage),
        })),
      );
    }

    for (const item of fixtures.interviews) {
      await tx.insert(interviews).values({
        applicationId: applicationIds[item.applicationIndex],
        startsAt: interviewStart(item.startsInDays),
        mode: item.mode,
        withWhom: item.withWhom,
      });
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
