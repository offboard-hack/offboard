import type { Database } from "@offboard/db/client";
import {
  applications,
  jobMatches,
  jobRejections,
  jobs,
  resumes,
  talentPreferences,
} from "@offboard/db/schema";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { toPreferences } from "../../shared/talent-preferences.js";

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
  fitsPreferences: boolean;
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

function fitsExpression(preferences: ReturnType<typeof toPreferences>["jobPreferences"]) {
  const { workModels, locations, relocate, salaryFloorCents, excludedCompanies } = preferences;

  const placesFit = or(
    sql`${jobs.workModel} = 'remote'`,
    isNull(jobs.state),
    ...locations.map((location) =>
      and(
        sql`lower(${jobs.state}) = ${location.state.toLowerCase()}`,
        location.city === null
          ? undefined
          : sql`lower(trim(coalesce(${jobs.city}, ''))) = ${location.city.trim().toLowerCase()}`,
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
      : notInArray(
          sql`lower(trim(${jobs.company}))`,
          excludedCompanies.map((company) => company.trim().toLowerCase()),
        ),
    salaryFloorCents === null
      ? undefined
      : or(isNull(jobs.salaryMaxCents), gte(jobs.salaryMaxCents, salaryFloorCents)),
  );

  return sql<boolean>`(${fits ?? sql`true`})`;
}

export function createJobsRepository(db: Database) {
  async function listForTalent(
    profileId: string,
    filter: { workModel?: WorkModel; page: number; pageSize: number },
  ) {
    const [stored] = await db
      .select()
      .from(talentPreferences)
      .where(eq(talentPreferences.profileId, profileId));

    const fits = fitsExpression(toPreferences(stored).jobPreferences);

    const where = and(
      isNull(jobs.closedAt),
      sql`not exists (select 1 from ${jobRejections} where ${jobRejections.profileId} = ${profileId} and ${jobRejections.jobId} = ${jobs.id})`,
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
          fits: fits.as("fits"),
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
          sql`(${fits}) is true desc`,
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

    const items = rows.map(({ job, score, reasons, applied, fits }) => ({
      ...toJob(job),
      match: score === null || reasons === null ? null : { score, reasons },
      applied,
      fitsPreferences: fits,
    })) satisfies TalentJobView[];

    return { items, total: totals.total };
  }

  return { listForTalent };
}

export type JobsRepository = ReturnType<typeof createJobsRepository>;
