import type { Database } from "@offboard/db/client";
import type { ConfirmedAnswer, DraftAnswer, FormQuestion } from "@offboard/db/schema";
import {
  aiApplications,
  applicationPackages,
  applications,
  jobRejections,
  jobs,
  resumes,
  talentPreferences,
} from "@offboard/db/schema";
import { and, asc, desc, eq, exists, gt, inArray, isNull, notExists } from "drizzle-orm";
import { z } from "zod";
import { uniqueViolation } from "../../shared/http.js";
import { toPreferences } from "../../shared/talent-preferences.js";
import { toAttemptView } from "./view.js";

const sourceKey = /^([a-z0-9][a-z0-9_-]*):(\d+)$/;

const nonFinal = ["draft", "queued", "running", "submitting", "needs_check"] as const;

type NewAttempt = {
  form: { questions: FormQuestion[] };
  draft: DraftAnswer[];
  state: "draft" | "assisted";
  reason: string | null;
  resumeId: string;
};

const expiry = 7 * 24 * 60 * 60 * 1000;

export type SaveAnswer = (
  profileId: string,
  label: string,
  text: string,
  options: { sensitive: boolean },
  now: Date,
) => Promise<void>;

type Confirmation = {
  confirmed: ConfirmedAnswer[];
  rehearsal: boolean;
  entries: { label: string; text: string; sensitive: boolean }[];
};

const jobColumns = { id: jobs.id, title: jobs.title, company: jobs.company, url: jobs.url };

export function createAiApplyRepository(db: Database) {
  async function openJob(jobId: string) {
    if (!z.uuid().safeParse(jobId).success) return undefined;

    const [row] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        company: jobs.company,
        url: jobs.url,
        sourceKey: jobs.sourceKey,
      })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.source, "greenhouse"), isNull(jobs.closedAt)));

    const match = row === undefined ? null : sourceKey.exec(row.sourceKey);

    return row === undefined || match === null
      ? undefined
      : {
          id: row.id,
          title: row.title,
          company: row.company,
          url: row.url,
          board: match[1],
          posting: match[2],
        };
  }

  async function baseResume(profileId: string) {
    const [row] = await db
      .select({ id: resumes.id, content: resumes.content })
      .from(resumes)
      .where(and(eq(resumes.profileId, profileId), eq(resumes.kind, "base")));

    return row;
  }

  async function hasApplied(profileId: string, jobId: string) {
    const [row] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.profileId, profileId), eq(applications.jobId, jobId)));

    return row !== undefined;
  }

  async function isRejected(profileId: string, jobId: string) {
    const [row] = await db
      .select({ jobId: jobRejections.jobId })
      .from(jobRejections)
      .where(and(eq(jobRejections.profileId, profileId), eq(jobRejections.jobId, jobId)));

    return row !== undefined;
  }

  async function hasActive(profileId: string, jobId: string) {
    const [row] = await db
      .select({ id: aiApplications.id })
      .from(aiApplications)
      .where(
        and(
          eq(aiApplications.profileId, profileId),
          eq(aiApplications.jobId, jobId),
          inArray(aiApplications.state, nonFinal),
        ),
      );

    return row !== undefined;
  }

  async function profileFields(profileId: string) {
    const [row] = await db
      .select()
      .from(talentPreferences)
      .where(eq(talentPreferences.profileId, profileId));

    return toPreferences(row).profileFields;
  }

  async function coverLetter(profileId: string, jobId: string) {
    const [row] = await db
      .select({ coverLetter: applicationPackages.coverLetter })
      .from(applicationPackages)
      .where(
        and(eq(applicationPackages.profileId, profileId), eq(applicationPackages.jobId, jobId)),
      );

    return row?.coverLetter ?? null;
  }

  async function createAttempt(profileId: string, jobId: string, attempt: NewAttempt, now: Date) {
    try {
      const [row] = await db
        .insert(aiApplications)
        .values({ profileId, jobId, ...attempt, preparedAt: now })
        .returning();

      const [job] = await db
        .select({ id: jobs.id, title: jobs.title, company: jobs.company, url: jobs.url })
        .from(jobs)
        .where(eq(jobs.id, jobId));

      return toAttemptView(row, job);
    } catch (error) {
      if (uniqueViolation.safeParse(error).success) return "in_progress" as const;

      throw error;
    }
  }

  async function assistedAttempt(profileId: string, jobId: string) {
    const [row] = await db
      .select({
        attempt: aiApplications,
        job: { id: jobs.id, title: jobs.title, company: jobs.company, url: jobs.url },
      })
      .from(aiApplications)
      .innerJoin(jobs, eq(jobs.id, aiApplications.jobId))
      .where(
        and(
          eq(aiApplications.profileId, profileId),
          eq(aiApplications.jobId, jobId),
          eq(aiApplications.state, "assisted"),
          eq(aiApplications.reason, "document_required"),
        ),
      )
      .orderBy(desc(aiApplications.createdAt))
      .limit(1);

    return row === undefined ? undefined : toAttemptView(row.attempt, row.job);
  }

  async function attempt(profileId: string, id: string) {
    if (!z.uuid().safeParse(id).success) return undefined;

    const [row] = await db
      .select({ attempt: aiApplications, job: jobColumns })
      .from(aiApplications)
      .innerJoin(jobs, eq(jobs.id, aiApplications.jobId))
      .where(and(eq(aiApplications.id, id), eq(aiApplications.profileId, profileId)));

    return row;
  }

  async function withJob(row: typeof aiApplications.$inferSelect) {
    const [job] = await db.select(jobColumns).from(jobs).where(eq(jobs.id, row.jobId));

    return toAttemptView(row, job);
  }

  async function get(profileId: string, id: string) {
    const row = await attempt(profileId, id);

    return row === undefined ? undefined : toAttemptView(row.attempt, row.job);
  }

  async function list(profileId: string) {
    const rows = await db
      .select({ attempt: aiApplications, job: jobColumns })
      .from(aiApplications)
      .innerJoin(jobs, eq(jobs.id, aiApplications.jobId))
      .where(eq(aiApplications.profileId, profileId))
      .orderBy(desc(aiApplications.createdAt), asc(aiApplications.id));

    return rows.map((row) => toAttemptView(row.attempt, row.job));
  }

  async function confirm(
    profileId: string,
    id: string,
    confirmation: Confirmation,
    now: Date,
    save: SaveAnswer,
  ) {
    const [queued] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(aiApplications)
        .set({
          state: "queued",
          confirmed: confirmation.confirmed,
          rehearsal: confirmation.rehearsal,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(aiApplications.id, id),
            eq(aiApplications.profileId, profileId),
            eq(aiApplications.state, "draft"),
            gt(aiApplications.preparedAt, new Date(now.getTime() - expiry)),
            notExists(
              tx
                .select({ id: applications.id })
                .from(applications)
                .where(
                  and(
                    eq(applications.profileId, profileId),
                    eq(applications.jobId, aiApplications.jobId),
                  ),
                ),
            ),
            exists(
              tx
                .select({ id: jobs.id })
                .from(jobs)
                .where(and(eq(jobs.id, aiApplications.jobId), isNull(jobs.closedAt))),
            ),
          ),
        )
        .returning();

      if (rows.length > 0) {
        for (const entry of confirmation.entries) {
          await save(profileId, entry.label, entry.text, { sensitive: entry.sensitive }, now);
        }
      }

      return rows;
    });

    if (queued !== undefined) return withJob(queued);

    const current = await attempt(profileId, id);

    if (current === undefined || current.attempt.state !== "draft") {
      return "in_progress" as const;
    }

    if (current.attempt.preparedAt.getTime() <= now.getTime() - expiry) return "expired" as const;

    return (await hasApplied(profileId, current.attempt.jobId))
      ? ("applied" as const)
      : ("job_closed" as const);
  }

  async function cancel(profileId: string, id: string, now: Date) {
    if (!z.uuid().safeParse(id).success) return "not_found" as const;

    const [row] = await db
      .update(aiApplications)
      .set({ state: "cancelled", reason: "cancelled_by_person", finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(aiApplications.id, id),
          eq(aiApplications.profileId, profileId),
          inArray(aiApplications.state, ["draft", "queued"]),
        ),
      )
      .returning();

    if (row !== undefined) return withJob(row);

    return (await attempt(profileId, id)) === undefined
      ? ("not_found" as const)
      : ("not_cancellable" as const);
  }

  return {
    attempt,
    get,
    list,
    confirm,
    cancel,
    openJob,
    assistedAttempt,
    baseResume,
    hasApplied,
    isRejected,
    hasActive,
    profileFields,
    coverLetter,
    createAttempt,
  };
}

export type AiApplyRepository = ReturnType<typeof createAiApplyRepository>;
