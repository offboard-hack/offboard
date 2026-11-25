import type { Database } from "@offboard/db/client";
import { jobMatches, jobs, resumes, talentPreferences, talentProfiles } from "@offboard/db/schema";
import { and, asc, desc, eq, gte, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { notRejectedBy } from "../../shared/not-rejected.js";
import { toPreferences } from "../../shared/talent-preferences.js";
import type { MatchJob, MatchResult } from "./score.js";

const version = sql<Date>`coalesce(${resumes.updatedAt}, ${resumes.createdAt})`.mapWith(
  resumes.updatedAt,
);

const baseOf = (profileId: string) =>
  and(eq(resumes.profileId, profileId), eq(resumes.kind, "base"));

const jobColumns = {
  id: jobs.id,
  title: jobs.title,
  company: jobs.company,
  workModel: jobs.workModel,
  city: jobs.city,
  state: jobs.state,
  description: jobs.description,
};

const vector = sql`to_tsvector('portuguese', ${jobs.title} || ' ' || ${jobs.description})`;

const newest = [sql`${jobs.postedAt} desc nulls last`, desc(jobs.createdAt), asc(jobs.id)];

const openFor = (profileId: string) => and(isNull(jobs.closedAt), notRejectedBy(profileId));

const saoPauloOffsetMs = 3 * 60 * 60_000;

export function createMatchesRepository(db: Database) {
  async function baseResume(profileId: string) {
    const [row] = await db
      .select({ content: resumes.content, version })
      .from(resumes)
      .where(baseOf(profileId));

    return row;
  }

  async function targetTitles(profileId: string) {
    const [row] = await db
      .select()
      .from(talentPreferences)
      .where(eq(talentPreferences.profileId, profileId));

    return toPreferences(row).targetTitles;
  }

  async function candidates(profileId: string, tsQuery: string | null, limit: number) {
    const open = openFor(profileId);

    if (tsQuery === null) {
      return db
        .select(jobColumns)
        .from(jobs)
        .where(open)
        .orderBy(...newest)
        .limit(limit);
    }

    const query = sql`to_tsquery('portuguese', ${tsQuery})`;

    const matched: MatchJob[] = await db
      .select(jobColumns)
      .from(jobs)
      .where(and(open, sql`${vector} @@ ${query}`))
      .orderBy(sql`ts_rank_cd(${vector}, ${query}) desc`, ...newest)
      .limit(limit);

    if (matched.length === limit) return matched;

    const rest = await db
      .select(jobColumns)
      .from(jobs)
      .where(
        and(
          open,
          notInArray(
            jobs.id,
            matched.map((job) => job.id),
          ),
        ),
      )
      .orderBy(...newest)
      .limit(limit - matched.length);

    return [...matched, ...rest];
  }

  async function freshJobIds(profileId: string, resumeVersion: Date) {
    const rows = await db
      .select({ jobId: jobMatches.jobId })
      .from(jobMatches)
      .where(
        and(eq(jobMatches.profileId, profileId), eq(jobMatches.resumeUpdatedAt, resumeVersion)),
      );

    return new Set(rows.map((row) => row.jobId));
  }

  async function saveMatches(
    profileId: string,
    resumeVersion: Date,
    results: MatchResult[],
    now: Date,
  ) {
    if (results.length === 0) return true;

    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ version })
        .from(resumes)
        .where(baseOf(profileId))
        .for("update");

      if (current?.version.getTime() !== resumeVersion.getTime()) return false;

      await tx
        .insert(jobMatches)
        .values(
          results.map((result) => ({
            profileId,
            jobId: result.jobId,
            score: result.score,
            reasons: result.reasons,
            resumeUpdatedAt: resumeVersion,
            computedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [jobMatches.profileId, jobMatches.jobId],
          set: {
            score: sql`excluded.score`,
            reasons: sql`excluded.reasons`,
            resumeUpdatedAt: sql`excluded.resume_updated_at`,
            computedAt: sql`excluded.computed_at`,
          },
        });

      return true;
    });
  }

  async function profilesForMatching(now: Date) {
    const today = new Date(now.getTime() - saoPauloOffsetMs).toISOString().slice(0, 10);

    const rows = await db
      .select({ profileId: resumes.profileId })
      .from(resumes)
      .innerJoin(talentProfiles, eq(talentProfiles.id, resumes.profileId))
      .where(
        and(
          eq(resumes.kind, "base"),
          isNotNull(talentProfiles.termsAcceptedAt),
          gte(talentProfiles.sponsoredUntil, today),
        ),
      )
      .orderBy(asc(resumes.profileId));

    return rows.map((row) => row.profileId);
  }

  return { baseResume, targetTitles, candidates, freshJobIds, saveMatches, profilesForMatching };
}

export type MatchesRepository = ReturnType<typeof createMatchesRepository>;
