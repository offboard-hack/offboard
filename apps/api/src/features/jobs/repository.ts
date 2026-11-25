import type { Database } from "@offboard/db/client";
import { applications, jobMatches, jobs, resumes } from "@offboard/db/schema";
import { and, count, desc, eq, getTableColumns, gte, isNull, sql } from "drizzle-orm";
import type { JobDraft } from "./extract.js";

type WorkModel = "remote" | "hybrid" | "onsite";

export type JobView = {
  id: string;
  origin: "external" | "hr" | "recruiter";
  title: string;
  company: string;
  workModel: WorkModel | null;
  city: string | null;
  state: string | null;
  salaryMinCents: number | null;
  salaryMaxCents: number | null;
  url: string;
  postedAt: string | null;
};

export type TalentJobView = JobView & {
  match: { score: number; reasons: string[] } | null;
  applied: boolean;
};

type Row = typeof jobs.$inferSelect;

type ShareOrigin = "hr" | "recruiter";

export const shareSources = { hr: "hr-link", recruiter: "recruiter-link" } as const;

function toJob(row: Row) {
  return {
    id: row.id,
    origin: row.origin,
    title: row.title,
    company: row.company,
    workModel: row.workModel,
    city: row.city,
    state: row.state,
    salaryMinCents: row.salaryMinCents,
    salaryMaxCents: row.salaryMaxCents,
    url: row.url,
    postedAt: row.postedAt?.toISOString() ?? null,
  } satisfies JobView;
}

export function createJobsRepository(db: Database) {
  async function findBySource(source: string, sourceKey: string) {
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.source, source), eq(jobs.sourceKey, sourceKey)));

    return row ? toJob(row) : undefined;
  }

  async function createShared(
    input: JobDraft & {
      url: string;
      sourceKey: string;
      origin?: ShareOrigin;
      recruiterPartnerId?: string;
    },
  ) {
    const origin = input.origin ?? "hr";
    const source = shareSources[origin];
    const now = new Date();

    const [row] = await db
      .insert(jobs)
      .values({
        origin,
        source,
        sourceKey: input.sourceKey,
        title: input.title,
        company: input.company,
        workModel: input.workModel,
        city: input.city,
        state: input.state,
        salaryMinCents: input.salaryMinCents,
        salaryMaxCents: input.salaryMaxCents,
        url: input.url,
        description: input.description,
        recruiterPartnerId: input.recruiterPartnerId ?? null,
        postedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [jobs.source, jobs.sourceKey] })
      .returning();

    if (row) return { job: toJob(row), created: true };

    const [existing] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.source, source), eq(jobs.sourceKey, input.sourceKey)));

    if (!existing) throw new Error("Shared job vanished after a source conflict");

    return { job: toJob(existing), created: false };
  }

  async function countByPartnerSince(partnerId: string, since: Date) {
    const [row] = await db
      .select({ total: count() })
      .from(jobs)
      .where(and(eq(jobs.recruiterPartnerId, partnerId), gte(jobs.createdAt, since)));

    return row.total;
  }

  async function listForTalent(
    profileId: string,
    filter: { workModel?: WorkModel; page: number; pageSize: number },
  ) {
    const where = and(
      isNull(jobs.closedAt),
      filter.workModel === undefined ? undefined : eq(jobs.workModel, filter.workModel),
    );

    const baseVersion = db
      .select({
        version: sql`date_trunc('milliseconds', coalesce(${resumes.updatedAt}, ${resumes.createdAt}))`,
      })
      .from(resumes)
      .where(and(eq(resumes.profileId, profileId), eq(resumes.kind, "base")));

    const [rows, [totals]] = await Promise.all([
      db
        .select({
          job: getTableColumns(jobs),
          score: jobMatches.score,
          reasons: jobMatches.reasons,
          applied: sql<boolean>`exists (select 1 from ${applications} where ${applications.profileId} = ${profileId} and ${applications.jobId} = ${jobs.id})`,
        })
        .from(jobs)
        .leftJoin(
          jobMatches,
          and(
            eq(jobMatches.jobId, jobs.id),
            eq(jobMatches.profileId, profileId),
            sql`${jobMatches.resumeUpdatedAt} = (${baseVersion})`,
          ),
        )
        .where(where)
        .orderBy(
          sql`(${jobMatches.score} is null)`,
          sql`${jobMatches.score} desc`,
          sql`${jobs.postedAt} desc nulls last`,
          desc(jobs.createdAt),
          jobs.id,
        )
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      db.select({ total: count() }).from(jobs).where(where),
    ]);

    const items = rows.map(({ job, score, reasons, applied }) => ({
      ...toJob(job),
      match: score === null || reasons === null ? null : { score, reasons },
      applied,
    })) satisfies TalentJobView[];

    return { items, total: totals.total };
  }

  return { findBySource, createShared, countByPartnerSince, listForTalent };
}

export type JobsRepository = ReturnType<typeof createJobsRepository>;
