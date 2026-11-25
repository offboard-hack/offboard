import type { Database } from "@offboard/db/client";
import { applicationPackages, jobs, resumes, talentPreferences } from "@offboard/db/schema";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { toPreferences } from "../../shared/talent-preferences.js";
import { createAnswersRepository } from "./answers.js";

const fieldOrder = [
  "phone",
  "city",
  "linkedin",
  "portfolio",
  "workAuthorization",
  "availability",
  "noticePeriod",
  "salaryExpectation",
] as const;

export function createPackagesRepository(db: Database) {
  const answers = createAnswersRepository(db);

  async function openJob(jobId: string) {
    if (!z.uuid().safeParse(jobId).success) return undefined;

    const [row] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        url: jobs.url,
        description: jobs.description,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), isNull(jobs.closedAt)));

    return row;
  }

  async function resumeFor(profileId: string, jobId: string) {
    const [row] = await db
      .select({ id: resumes.id, kind: resumes.kind, content: resumes.content })
      .from(resumes)
      .where(
        and(
          eq(resumes.profileId, profileId),
          or(eq(resumes.kind, "base"), and(eq(resumes.jobId, jobId), eq(resumes.status, "ready"))),
        ),
      )
      .orderBy(desc(resumes.kind))
      .limit(1);

    return row;
  }

  async function saveCoverLetter(profileId: string, jobId: string, coverLetter: string, now: Date) {
    await db
      .insert(applicationPackages)
      .values({ profileId, jobId, coverLetter, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [applicationPackages.profileId, applicationPackages.jobId],
        set: { coverLetter, updatedAt: now },
      });
  }

  async function assemble(profileId: string, jobId: string) {
    const [saved] = await db
      .select({ coverLetter: applicationPackages.coverLetter })
      .from(applicationPackages)
      .where(
        and(eq(applicationPackages.profileId, profileId), eq(applicationPackages.jobId, jobId)),
      );

    const [stored] = await db
      .select()
      .from(talentPreferences)
      .where(eq(talentPreferences.profileId, profileId));

    const fields = toPreferences(stored).profileFields;

    const library = await answers.library(profileId);

    return {
      coverLetter: saved?.coverLetter ?? null,
      profile: fieldOrder.flatMap((field) => {
        const { value, share } = fields[field];

        return share && value !== null ? [{ field, value }] : [];
      }),
      answers: library.questions.flatMap((item) =>
        item.answer === null ? [] : [{ question: item.text, answer: item.answer }],
      ),
    };
  }

  return { openJob, resumeFor, saveCoverLetter, assemble };
}

export type PackagesRepository = ReturnType<typeof createPackagesRepository>;
