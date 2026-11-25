import type { Database } from "@offboard/db/client";
import { applications, jobs, talentProfiles } from "@offboard/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";

export type TalentAggregates = {
  enabled: number;
  activated: number | null;
  funnel: {
    sent: number | null;
    responded: number | null;
    interviews: number | null;
    offers: number | null;
  };
  hiresShared: number | null;
  topJobs: { title: string; company: string; applications: number }[];
  sharedJobs: { title: string; company: string; sharedAt: string }[];
};

const minimumPeople = 5;
const listLimit = 5;

function suppressed(total: number, people: number) {
  return people < minimumPeople ? null : total;
}

function applicationsWhere(condition: SQL | undefined) {
  return sql<number>`count(*) filter (where ${condition})::int`;
}

function peopleWhere(condition: SQL | undefined) {
  return sql<number>`count(distinct ${applications.profileId}) filter (where ${condition})::int`;
}

const sent = sql`true`;

const responded = or(
  inArray(applications.furthestStage, ["in_review", "interview", "offer"]),
  inArray(applications.closedReason, ["rejected", "hired"]),
);

const interviewed = inArray(applications.furthestStage, ["interview", "offer"]);
const offered = inArray(applications.furthestStage, ["offer"]);

const hiredShared = and(
  eq(applications.closedReason, "hired"),
  eq(talentProfiles.shareOutcomeWithHr, true),
);

const applicants = sql<number>`count(distinct ${applications.profileId})`;
const total = sql<number>`count(*)::int`;

export function createInsightsRepository(db: Database) {
  async function aggregates() {
    const [[profiles], [figures], top, shared] = await Promise.all([
      db
        .select({
          enabled: total,
          activated: sql<number>`count(*) filter (where ${isNotNull(talentProfiles.firstSignedInAt)})::int`,
        })
        .from(talentProfiles),
      db
        .select({
          sent: applicationsWhere(sent),
          sentPeople: peopleWhere(sent),
          responded: applicationsWhere(responded),
          respondedPeople: peopleWhere(responded),
          interviews: applicationsWhere(interviewed),
          interviewPeople: peopleWhere(interviewed),
          offers: applicationsWhere(offered),
          offerPeople: peopleWhere(offered),
          hiresShared: applicationsWhere(hiredShared),
          hiresSharedPeople: peopleWhere(hiredShared),
        })
        .from(applications)
        .innerJoin(talentProfiles, eq(talentProfiles.id, applications.profileId)),
      db
        .select({ title: jobs.title, company: jobs.company, applications: total })
        .from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId))
        .groupBy(jobs.id)
        .having(sql`${applicants} >= ${minimumPeople}`)
        .orderBy(desc(total), asc(jobs.title))
        .limit(listLimit),
      db
        .select({
          title: jobs.title,
          company: jobs.company,
          sharedAt: sql<Date>`coalesce(${jobs.postedAt}, ${jobs.createdAt})`.mapWith(jobs.postedAt),
        })
        .from(jobs)
        .where(eq(jobs.origin, "hr"))
        .orderBy(sql`${jobs.postedAt} desc nulls last`, desc(jobs.createdAt))
        .limit(listLimit),
    ]);

    return {
      enabled: profiles.enabled,
      activated: suppressed(profiles.activated, profiles.activated),
      funnel: {
        sent: suppressed(figures.sent, figures.sentPeople),
        responded: suppressed(figures.responded, figures.respondedPeople),
        interviews: suppressed(figures.interviews, figures.interviewPeople),
        offers: suppressed(figures.offers, figures.offerPeople),
      },
      hiresShared: suppressed(figures.hiresShared, figures.hiresSharedPeople),
      topJobs: top,
      sharedJobs: shared.map((row) => ({
        title: row.title,
        company: row.company,
        sharedAt: row.sharedAt.toISOString(),
      })),
    } satisfies TalentAggregates;
  }

  return { aggregates };
}

export type InsightsRepository = ReturnType<typeof createInsightsRepository>;
