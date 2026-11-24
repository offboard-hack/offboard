import type { Database } from "@offboard/db/client";
import { applicationEvents, applications, interviews, jobs } from "@offboard/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import {
  summarize,
  transition,
  type ApplicationStatus,
  type ClosedReason,
  type FunnelState,
  type Stage,
} from "./funnel.js";

export type ApplicationView = {
  id: string;
  status: ApplicationStatus;
  closedReason: ClosedReason | null;
  appliedAt: string;
  statusChangedAt: string;
  job: {
    id: string;
    title: string;
    company: string;
    workModel: "remote" | "hybrid" | "onsite" | null;
    city: string | null;
    state: string | null;
  };
};

export type InterviewView = {
  id: string;
  applicationId: string;
  startsAt: string;
  mode: "video" | "in_person" | "phone";
  with: string;
  notes: string;
  job: { title: string; company: string };
};

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type Reader = Pick<Database, "select">;

const furthestStage = sql<Stage>`${applications.furthestStage}`;

function selectApplications(reader: Reader, where: SQL | undefined) {
  return reader
    .select({
      id: applications.id,
      status: applications.status,
      closedReason: applications.closedReason,
      appliedAt: applications.appliedAt,
      statusChangedAt: applications.statusChangedAt,
      job: {
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        workModel: jobs.workModel,
        city: jobs.city,
        state: jobs.state,
      },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(where)
    .orderBy(desc(applications.appliedAt), desc(applications.id));
}

type ApplicationRow = Awaited<ReturnType<typeof selectApplications>>[number];

function toApplication(row: ApplicationRow) {
  return {
    ...row,
    appliedAt: row.appliedAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
  } satisfies ApplicationView;
}

function selectInterviews(reader: Reader, where: SQL | undefined) {
  return reader
    .select({
      id: interviews.id,
      applicationId: interviews.applicationId,
      startsAt: interviews.startsAt,
      mode: interviews.mode,
      with: interviews.withWhom,
      notes: interviews.notes,
      job: { title: jobs.title, company: jobs.company },
    })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(where)
    .orderBy(asc(interviews.startsAt), asc(interviews.id));
}

type InterviewRow = Awaited<ReturnType<typeof selectInterviews>>[number];

function toInterview(row: InterviewRow) {
  return { ...row, startsAt: row.startsAt.toISOString() } satisfies InterviewView;
}

function owned(profileId: string, applicationId: string) {
  return and(eq(applications.id, applicationId), eq(applications.profileId, profileId));
}

async function lock(tx: Transaction, profileId: string, applicationId: string) {
  const [row] = await tx
    .select({
      status: applications.status,
      closedReason: applications.closedReason,
      furthestStage,
    })
    .from(applications)
    .where(owned(profileId, applicationId))
    .for("update");

  return row;
}

async function advance(
  tx: Transaction,
  profileId: string,
  applicationId: string,
  next: FunnelState,
) {
  await tx
    .update(applications)
    .set({
      status: next.status,
      closedReason: next.closedReason,
      furthestStage: next.furthestStage,
      statusChangedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(owned(profileId, applicationId));

  await tx
    .insert(applicationEvents)
    .values({ applicationId, status: next.status, closedReason: next.closedReason });
}

export function createApplicationsRepository(db: Database) {
  async function apply(profileId: string, jobId: string) {
    return db.transaction(async (tx) => {
      const [job] = await tx
        .select({ url: jobs.url })
        .from(jobs)
        .where(and(eq(jobs.id, jobId), isNull(jobs.closedAt)))
        .for("share");

      if (!job) return "job_not_found" as const;

      const [created] = await tx
        .insert(applications)
        .values({ profileId, jobId })
        .onConflictDoNothing({ target: [applications.profileId, applications.jobId] })
        .returning({ id: applications.id });

      if (!created) return "already_applied" as const;

      await tx.insert(applicationEvents).values({ applicationId: created.id, status: "sent" });

      return { applicationId: created.id, jobUrl: job.url };
    });
  }

  async function list(profileId: string) {
    const rows = await selectApplications(db, eq(applications.profileId, profileId));

    return rows.map(toApplication);
  }

  async function summary(profileId: string) {
    const rows = await db
      .select({ closedReason: applications.closedReason, furthestStage })
      .from(applications)
      .where(eq(applications.profileId, profileId));

    return summarize(rows);
  }

  async function changeStatus(
    profileId: string,
    applicationId: string,
    change: { status: ApplicationStatus; closedReason?: ClosedReason },
  ) {
    return db.transaction(async (tx) => {
      const current = await lock(tx, profileId, applicationId);

      if (!current) return "not_found" as const;

      const next = transition(current, change);

      if (next === "invalid_transition") return next;

      await advance(tx, profileId, applicationId, next);

      const [row] = await selectApplications(tx, owned(profileId, applicationId));

      return toApplication(row);
    });
  }

  async function addInterview(
    profileId: string,
    applicationId: string,
    input: { startsAt: Date; mode: InterviewView["mode"]; with: string; notes?: string },
  ) {
    return db.transaction(async (tx) => {
      const current = await lock(tx, profileId, applicationId);

      if (!current) return "not_found" as const;

      if (current.status === "closed") return "application_closed" as const;

      const promoted = transition(current, { status: "interview" });

      if (promoted !== "invalid_transition") {
        await advance(tx, profileId, applicationId, promoted);
      }

      const [created] = await tx
        .insert(interviews)
        .values({
          applicationId,
          startsAt: input.startsAt,
          mode: input.mode,
          withWhom: input.with,
          notes: input.notes,
        })
        .returning({ id: interviews.id });

      const [row] = await selectInterviews(
        tx,
        and(eq(interviews.id, created.id), eq(applications.profileId, profileId)),
      );

      return toInterview(row);
    });
  }

  async function removeInterview(profileId: string, interviewId: string) {
    const deleted = await db
      .delete(interviews)
      .where(
        and(
          eq(interviews.id, interviewId),
          inArray(
            interviews.applicationId,
            db
              .select({ id: applications.id })
              .from(applications)
              .where(eq(applications.profileId, profileId)),
          ),
        ),
      )
      .returning({ id: interviews.id });

    return deleted.length > 0;
  }

  async function interviewsBetween(profileId: string, start: Date, end: Date) {
    const rows = await selectInterviews(
      db,
      and(
        eq(applications.profileId, profileId),
        gte(interviews.startsAt, start),
        lt(interviews.startsAt, end),
      ),
    );

    return rows.map(toInterview);
  }

  return {
    apply,
    list,
    summary,
    changeStatus,
    addInterview,
    removeInterview,
    interviewsBetween,
  };
}

export type ApplicationsRepository = ReturnType<typeof createApplicationsRepository>;
