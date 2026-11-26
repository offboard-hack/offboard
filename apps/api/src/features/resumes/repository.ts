import type { Database } from "@offboard/db/client";
import { resumes, type ResumeScoreBreakdown } from "@offboard/db/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { ResumeContent } from "./content.js";

export type ResumeView = {
  id: string;
  kind: "base";
  content: ResumeContent;
  score: number | null;
  scoreBreakdown: ResumeScoreBreakdown | null;
  scoredAt: string | null;
  updatedAt: string;
};

export const resumeColumns = {
  id: resumes.id,
  content: resumes.content,
  score: resumes.score,
  scoreBreakdown: resumes.scoreBreakdown,
  scoredAt: resumes.scoredAt,
  updatedAt: sql<Date>`coalesce(${resumes.updatedAt}, ${resumes.createdAt})`.mapWith(
    resumes.updatedAt,
  ),
};

export function toResumeView(row: {
  id: string;
  content: ResumeContent;
  score: number | null;
  scoreBreakdown: ResumeScoreBreakdown | null;
  scoredAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    kind: "base",
    content: row.content,
    score: row.score,
    scoreBreakdown: row.scoreBreakdown,
    scoredAt: row.scoredAt?.toISOString() ?? null,
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

  async function replaceBase(profileId: string, content: ResumeContent, sourceFileKey: string) {
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
      .set({ content, scoredAt: null, updatedAt: new Date() })
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

  async function expireLegacyScore(profileId: string) {
    const expired = await db
      .update(resumes)
      .set({ scoredAt: null })
      .where(
        and(
          baseOf(profileId),
          isNotNull(resumes.score),
          isNull(resumes.scoreBreakdown),
          isNotNull(resumes.scoredAt),
        ),
      )
      .returning({ id: resumes.id });

    return expired.at(0)?.id;
  }

  async function contentOf(profileId: string, id: string) {
    const [row] = await db
      .select({ content: resumes.content })
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.profileId, profileId)));

    return row?.content;
  }

  return { getBase, replaceBase, updateBaseContent, forScoring, expireLegacyScore, contentOf };
}

export type ResumesRepository = ReturnType<typeof createResumesRepository>;
