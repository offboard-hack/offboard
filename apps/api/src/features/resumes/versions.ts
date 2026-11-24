import type { Database } from "@offboard/db/client";
import { applications, jobs, resumes } from "@offboard/db/schema";
import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { ResumeContent } from "./content.js";
import { resumeColumns } from "./repository.js";

export type VersionView = {
  id: string;
  job: { id: string; title: string; company: string };
  status: "draft" | "ready";
  matchScore: number | null;
  content: ResumeContent;
  application: { id: string; status: string; appliedAt: string } | null;
  updatedAt: string;
};

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type Reader = Pick<Database, "select">;

function tailoredOf(profileId: string) {
  return and(eq(resumes.profileId, profileId), eq(resumes.kind, "tailored"));
}

function selectVersions(reader: Reader, where: SQL | undefined) {
  return reader
    .select({
      id: resumes.id,
      job: { id: jobs.id, title: jobs.title, company: jobs.company },
      status: resumes.status,
      matchScore: resumes.matchScore,
      content: resumes.content,
      application: {
        id: applications.id,
        status: applications.status,
        appliedAt: applications.appliedAt,
      },
      updatedAt: resumeColumns.updatedAt,
    })
    .from(resumes)
    .innerJoin(jobs, eq(jobs.id, resumes.jobId))
    .leftJoin(
      applications,
      and(eq(applications.resumeId, resumes.id), eq(applications.profileId, resumes.profileId)),
    )
    .where(where)
    .orderBy(desc(resumeColumns.updatedAt), asc(resumes.id));
}

type VersionRow = Awaited<ReturnType<typeof selectVersions>>[number];

function toVersion(row: VersionRow) {
  return {
    ...row,
    application: row.application && {
      ...row.application,
      appliedAt: row.application.appliedAt.toISOString(),
    },
    updatedAt: row.updatedAt.toISOString(),
  } satisfies VersionView;
}

async function find(reader: Reader, profileId: string, id: string) {
  const [row] = await selectVersions(reader, and(eq(resumes.id, id), tailoredOf(profileId)));

  return row;
}

async function used(tx: Transaction, profileId: string, id: string) {
  const [application] = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.resumeId, id), eq(applications.profileId, profileId)));

  return application !== undefined;
}

async function lock(tx: Transaction, profileId: string, where: SQL | undefined) {
  const [row] = await tx
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(tailoredOf(profileId), where))
    .for("update");

  return row;
}

export function createVersionsRepository(db: Database) {
  async function jobForTailoring(jobId: string) {
    const [row] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        workModel: jobs.workModel,
        city: jobs.city,
        state: jobs.state,
        description: jobs.description,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), isNull(jobs.closedAt)));

    return row;
  }

  async function saveDraft(
    profileId: string,
    jobId: string,
    content: ResumeContent,
    matchScore: number | null,
    now: Date,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${profileId} || ':' || ${jobId}, 0))`,
      );

      const existing = await lock(tx, profileId, eq(resumes.jobId, jobId));

      if (existing && (await used(tx, profileId, existing.id))) return "used" as const;

      const [row] = await tx
        .insert(resumes)
        .values({
          profileId,
          kind: "tailored",
          status: "draft",
          jobId,
          content,
          matchScore,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [resumes.profileId, resumes.jobId],
          targetWhere: sql`${resumes.kind} = 'tailored'`,
          set: { content, matchScore, status: "draft", updatedAt: now },
        })
        .returning({ id: resumes.id });

      return toVersion(await find(tx, profileId, row.id));
    });
  }

  async function list(profileId: string) {
    const rows = await selectVersions(db, tailoredOf(profileId));

    return rows.map(toVersion);
  }

  async function get(profileId: string, id: string) {
    const row = await find(db, profileId, id);

    return row && toVersion(row);
  }

  async function update(profileId: string, id: string, content: ResumeContent, now: Date) {
    return db.transaction(async (tx) => {
      const existing = await lock(tx, profileId, eq(resumes.id, id));

      if (!existing) return "not_found" as const;

      if (await used(tx, profileId, id)) return "used" as const;

      await tx
        .update(resumes)
        .set({ content, status: "draft", updatedAt: now })
        .where(eq(resumes.id, id));

      return toVersion(await find(tx, profileId, id));
    });
  }

  async function markReady(profileId: string, id: string, now: Date) {
    return db.transaction(async (tx) => {
      await tx
        .update(resumes)
        .set({ status: "ready", updatedAt: now })
        .where(and(eq(resumes.id, id), tailoredOf(profileId), eq(resumes.status, "draft")));

      const row = await find(tx, profileId, id);

      return row ? toVersion(row) : ("not_found" as const);
    });
  }

  return { jobForTailoring, saveDraft, list, get, update, markReady };
}

export type VersionsRepository = ReturnType<typeof createVersionsRepository>;
