import type { Database } from "@offboard/db/client";
import { resumes } from "@offboard/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { ResumeContent } from "./content.js";

export type ResumeView = {
  id: string;
  kind: "base";
  content: ResumeContent;
  score: number | null;
  scoredAt: string | null;
  updatedAt: string;
};

const columns = {
  id: resumes.id,
  content: resumes.content,
  score: resumes.score,
  scoredAt: resumes.scoredAt,
  updatedAt: sql<Date>`coalesce(${resumes.updatedAt}, ${resumes.createdAt})`.mapWith(
    resumes.updatedAt,
  ),
};

function toView(row: {
  id: string;
  content: ResumeContent;
  score: number | null;
  scoredAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    kind: "base",
    content: row.content,
    score: row.score,
    scoredAt: row.scoredAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  } satisfies ResumeView;
}

function base(profileId: string) {
  return and(eq(resumes.profileId, profileId), eq(resumes.kind, "base"));
}

export function createResumesRepository(db: Database) {
  async function getBase(profileId: string) {
    const [row] = await db.select(columns).from(resumes).where(base(profileId));

    return row && toView(row);
  }

  async function replaceBase(profileId: string, content: ResumeContent, sourceFileKey: string) {
    return db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ sourceFileKey: resumes.sourceFileKey })
        .from(resumes)
        .where(base(profileId))
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
          set: { content, sourceFileKey, score: null, scoredAt: null, updatedAt: now },
        })
        .returning(columns);

      return { resume: toView(row), previousFileKey: previous?.sourceFileKey ?? null };
    });
  }

  async function updateBaseContent(profileId: string, content: ResumeContent) {
    const [row] = await db
      .update(resumes)
      .set({ content, score: null, scoredAt: null, updatedAt: new Date() })
      .where(base(profileId))
      .returning(columns);

    return row && toView(row);
  }

  return { getBase, replaceBase, updateBaseContent };
}

export type ResumesRepository = ReturnType<typeof createResumesRepository>;
