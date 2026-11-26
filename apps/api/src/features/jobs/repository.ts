import type { Database } from "@offboard/db/client";
import {
  applications,
  backgroundJobs,
  jobMatches,
  jobs,
  resumes,
  talentPreferences,
} from "@offboard/db/schema";
import { and, count, desc, eq, getTableColumns, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { aiApplyCapable } from "../../shared/ai-apply-access.js";
import { notRejectedBy } from "../../shared/not-rejected.js";
import { toPreferences } from "../../shared/talent-preferences.js";

type WorkModel = "remote" | "hybrid" | "onsite";

const compatibleScore = 50;

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
  fitsPreferences: boolean;
  aiApplyCapable: boolean;
  description: string;
};

type Row = Omit<typeof jobs.$inferSelect, "embedding" | "embeddedAt">;

const { embedding: _embedding, embeddedAt: _embeddedAt, ...listColumns } = getTableColumns(jobs);

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

function fitsExpression(preferences: ReturnType<typeof toPreferences>["jobPreferences"]) {
  const { workModels, locations, relocate, salaryFloorCents, excludedCompanies } = preferences;

  const placesFit = or(
    sql`${jobs.workModel} = 'remote'`,
    isNull(jobs.state),
    ...locations.map(({ state, city }) =>
      and(
        sql`lower(${jobs.state}) = lower(${state})`,
        (city ?? null) === null
          ? undefined
          : sql`(${jobs.city} is null or lower(trim(${jobs.city})) = lower(trim(${city})))`,
      ),
    ),
  );

  const fits = and(
    workModels.length === 0
      ? undefined
      : or(isNull(jobs.workModel), inArray(jobs.workModel, workModels)),
    locations.length === 0 || relocate ? undefined : placesFit,
    excludedCompanies.length === 0
      ? undefined
      : sql`lower(trim(${jobs.company})) not in (${sql.join(
          excludedCompanies.map((company) => sql`lower(trim(${company}))`),
          sql`, `,
        )})`,
    salaryFloorCents === null
      ? undefined
      : or(isNull(jobs.salaryMaxCents), gte(jobs.salaryMaxCents, salaryFloorCents)),
  );

  return sql<boolean>`coalesce((${fits ?? sql`true`}), false)`;
}

export function createJobsRepository(db: Database) {
  async function listForTalent(
    profileId: string,
    filter: {
      workModel?: WorkModel;
      view?: "compatible" | "all";
      page: number;
      pageSize: number;
    },
  ) {
    const [stored] = await db
      .select()
      .from(talentPreferences)
      .where(eq(talentPreferences.profileId, profileId));

    const fits = fitsExpression(toPreferences(stored).jobPreferences);

    const where = and(
      isNull(jobs.closedAt),
      notRejectedBy(profileId),
      filter.workModel === undefined ? undefined : eq(jobs.workModel, filter.workModel),
      filter.view === "compatible" ? gte(jobMatches.score, compatibleScore) : undefined,
    );

    const baseVersion = db
      .select({
        version: sql`date_trunc('milliseconds', coalesce(${resumes.updatedAt}, ${resumes.createdAt}))`,
      })
      .from(resumes)
      .where(and(eq(resumes.profileId, profileId), eq(resumes.kind, "base")));

    const matchJoin = and(
      eq(jobMatches.jobId, jobs.id),
      eq(jobMatches.profileId, profileId),
      sql`${jobMatches.resumeUpdatedAt} = (${baseVersion})`,
    );

    const [rows, [totals], [computing]] = await Promise.all([
      db
        .select({
          job: listColumns,
          score: jobMatches.score,
          reasons: jobMatches.reasons,
          fits: fits.as("fits"),
          applied: sql<boolean>`exists (select 1 from ${applications} where ${applications.profileId} = ${profileId} and ${applications.jobId} = ${jobs.id})`,
        })
        .from(jobs)
        .leftJoin(jobMatches, matchJoin)
        .where(where)
        .orderBy(
          sql`${fits} desc`,
          sql`(${jobMatches.score} is null)`,
          sql`${jobMatches.score} desc`,
          sql`${jobs.postedAt} desc nulls last`,
          desc(jobs.createdAt),
          jobs.id,
        )
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      db.select({ total: count() }).from(jobs).leftJoin(jobMatches, matchJoin).where(where),
      db
        .select({ total: count() })
        .from(backgroundJobs)
        .where(
          and(
            eq(backgroundJobs.kind, "compute_matches"),
            eq(backgroundJobs.subject, profileId),
            inArray(backgroundJobs.status, ["pending", "running"]),
          ),
        ),
    ]);

    const items = rows.map(({ job, score, reasons, applied, fits }) => ({
      ...toJob(job),
      match: score === null || reasons === null ? null : { score, reasons },
      applied,
      fitsPreferences: fits,
      aiApplyCapable: aiApplyCapable(job),
      description: job.description,
    })) satisfies TalentJobView[];

    return { items, total: totals.total, matching: computing.total > 0 };
  }

  return { listForTalent };
}

export type JobsRepository = ReturnType<typeof createJobsRepository>;
