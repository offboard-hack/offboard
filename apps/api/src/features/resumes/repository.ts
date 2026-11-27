import type { Database } from "@offboard/db/client";
import { backgroundJobs, resumes, type ResumeScoreBreakdown } from "@offboard/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { ResumeContent } from "./content.js";

export type ResumeView = {
  id: string;
  kind: "base";
  content: ResumeContent;
  score: number | null;
  scoreBreakdown: ResumeScoreBreakdown | null;
  scoredAt: string | null;
  rescoring: boolean;
  updatedAt: string;
};

export const resumeColumns = {
  id: resumes.id,
  content: resumes.content,
  score: resumes.score,
  scoreBreakdown: resumes.scoreBreakdown,
  scoredAt: resumes.scoredAt,
  rescoring: sql<boolean>`exists (select 1 from background_jobs pending_score where pending_score.kind = 'score_resume' and pending_score.subject = "resumes"."id"::text and pending_score.status in ('pending', 'running'))`,
  updatedAt: sql<Date>`coalesce(${resumes.updatedAt}, ${resumes.createdAt})`.mapWith(
    resumes.updatedAt,
  ),
};

export function scoreIsCurrent(resume: {
  scoreBreakdown: ResumeScoreBreakdown | null;
  scoredAt: Date | string | null;
  updatedAt: Date | string;
}) {
  return (
    resume.scoreBreakdown !== null &&
    resume.scoredAt !== null &&
    new Date(resume.scoredAt).getTime() >= new Date(resume.updatedAt).getTime()
  );
}

export function toResumeView(row: {
  id: string;
  content: ResumeContent;
  score: number | null;
  scoreBreakdown: ResumeScoreBreakdown | null;
  scoredAt: Date | null;
  rescoring: boolean;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    kind: "base",
    content: row.content,
    score: row.score,
    scoreBreakdown: row.scoreBreakdown,
    scoredAt: row.scoredAt?.toISOString() ?? null,
    rescoring: row.rescoring,
    updatedAt: row.updatedAt.toISOString(),
  } satisfies ResumeView;
}

export function baseOf(profileId: string) {
  return and(eq(resumes.profileId, profileId), eq(resumes.kind, "base"));
}

export function createResumesRepository(db: Database) {
  async function getBase(profileId: string) {
    const [row] = await db.select(resumeColumns).from(resumes).where(baseOf(profileId));

    return row && toResumeView(row);
  }

  async function replaceBase(
    profileId: string,
    content: ResumeContent,
    sourceFileKey: string | null,
  ) {
    return db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ sourceFileKey: resumes.sourceFileKey })
        .from(resumes)
        .where(baseOf(profileId))
        .for("update");

      const now = new Date();

      const [row] = await tx
        .insert(resumes)
        .values({
          profileId,
          kind: "base",
          content,
          sourceFileKey,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: resumes.profileId,
          targetWhere: sql`${resumes.kind} = 'base'`,
          set: {
            content,
            sourceFileKey,
            score: null,
            scoreBreakdown: null,
            scoredAt: null,
            updatedAt: now,
          },
        })
        .returning(resumeColumns);

      return { resume: toResumeView(row), previousFileKey: previous?.sourceFileKey ?? null };
    });
  }

  async function updateBaseContent(profileId: string, content: ResumeContent) {
    const [row] = await db
      .update(resumes)
      .set({ content, updatedAt: new Date() })
      .where(baseOf(profileId))
      .returning(resumeColumns);

    return row && toResumeView(row);
  }

  async function forScoring(resumeId: string) {
    const [row] = await db
      .select({
        profileId: resumes.profileId,
        content: resumes.content,
        scoreBreakdown: resumes.scoreBreakdown,
        scoredAt: resumes.scoredAt,
        updatedAt: resumeColumns.updatedAt,
      })
      .from(resumes)
      .where(eq(resumes.id, resumeId));

    return row;
  }

  async function lastScoreFailed(resumeId: string) {
    const [job] = await db
      .select({ status: backgroundJobs.status })
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.kind, "score_resume"), eq(backgroundJobs.subject, resumeId)))
      .orderBy(desc(backgroundJobs.createdAt), desc(backgroundJobs.id))
      .limit(1);

    return job?.status === "failed";
  }

  async function contentOf(profileId: string, id: string) {
    const [row] = await db
      .select({ content: resumes.content })
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.profileId, profileId)));

    return row?.content;
  }

  async function forProfileEmbedding(resumeId: string) {
    const [row] = await db
      .select({ content: resumes.content, hash: resumes.profileEmbeddedHash })
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.kind, "base")));

    return row;
  }

  async function saveProfileEmbedding(resumeId: string, hash: string, embedding: number[]) {
    await db
      .update(resumes)
      .set({ profileEmbedding: embedding, profileEmbeddedHash: hash })
      .where(and(eq(resumes.id, resumeId), eq(resumes.kind, "base")));
  }

  async function withoutProfileEmbedding(limit: number) {
    const rows = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.kind, "base"), isNull(resumes.profileEmbeddedHash)))
      .orderBy(resumes.id)
      .limit(limit);

    return rows.map((row) => row.id);
  }

  return {
    getBase,
    replaceBase,
    updateBaseContent,
    forScoring,
    lastScoreFailed,
    contentOf,
    forProfileEmbedding,
    saveProfileEmbedding,
    withoutProfileEmbedding,
  };
}

export type ResumesRepository = ReturnType<typeof createResumesRepository>;
