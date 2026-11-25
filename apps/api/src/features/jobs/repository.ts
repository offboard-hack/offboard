import type { Database } from "@offboard/db/client";
import { applications, jobMatches, jobs, resumes } from "@offboard/db/schema";
import { and, count, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";

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

  return { listForTalent };
}

export type JobsRepository = ReturnType<typeof createJobsRepository>;
