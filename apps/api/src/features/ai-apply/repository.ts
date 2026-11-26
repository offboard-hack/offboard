import type { Database } from "@offboard/db/client";
import type {
  AttemptEvidence,
  ConfirmedAnswer,
  DraftAnswer,
  FormQuestion,
} from "@offboard/db/schema";
import {
  aiApplications,
  applicationEvents,
  applicationPackages,
  applications,
  jobRejections,
  jobs,
  resumes,
  talentPreferences,
  talentProfiles,
} from "@offboard/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  or,
} from "drizzle-orm";
import { z } from "zod";
import { uniqueViolation } from "../../shared/http.js";
import { toPreferences } from "../../shared/talent-preferences.js";
import { toAttemptView } from "./view.js";

const sourceKey = /^([a-z0-9][a-z0-9_-]*):(\d+)$/;

const nonFinal = ["queued", "running", "submitting", "needs_check"] as const;

type AttemptState = (typeof aiApplications.$inferSelect)["state"];

type Finish = {
  state: Exclude<AttemptState, "draft" | "queued" | "running" | "submitting" | "submitted">;
  reason: string | null;
  evidence?: AttemptEvidence;
  screenshotKey?: string | null;
};

type NewAttempt = {
  form: { questions: FormQuestion[] };
  draft: DraftAnswer[];
  state: "draft" | "assisted";
  reason: string | null;
  resumeId: string;
};

const expiry = 7 * 24 * 60 * 60 * 1000;
const liveRunMs = 5 * 60_000;
export const stuckMs = 15 * 60_000;

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type SaveAnswer = (
  tx: Transaction,
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

export function draftBlock(
  row: { state: string; reason: string | null; preparedAt: Date; finishedAt: Date | null },
  now: Date,
) {
  if (row.state !== "draft" && row.state !== "rehearsed") {
    return row.reason === "applied_manually" ? ("applied" as const) : ("in_progress" as const);
  }

  const since = row.state === "rehearsed" ? row.finishedAt : row.preparedAt;

  return since === null || since.getTime() <= now.getTime() - expiry
    ? ("expired" as const)
    : undefined;
}

async function recordApplication(
  tx: Transaction,
  attempt: { profileId: string; jobId: string; resumeId: string | null },
  now: Date,
) {
  const [created] = await tx
    .insert(applications)
    .values({
      ...attempt,
      channel: "ai_apply",
      appliedAt: now,
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [applications.profileId, applications.jobId] })
    .returning({ id: applications.id });

  if (created !== undefined) {
    await tx
      .insert(applicationEvents)
      .values({ applicationId: created.id, status: "sent", createdAt: now });
  }

  return created;
}

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

  async function hasActive(profileId: string, jobId: string, now: Date) {
    const [row] = await db
      .select({ id: aiApplications.id })
      .from(aiApplications)
      .where(
        and(
          eq(aiApplications.profileId, profileId),
          eq(aiApplications.jobId, jobId),
          or(
            inArray(aiApplications.state, nonFinal),
            and(
              eq(aiApplications.state, "draft"),
              gt(aiApplications.preparedAt, new Date(now.getTime() - expiry)),
            ),
          ),
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
      return await db.transaction(async (tx) => {
        const [consenting] = await tx
          .select({ id: talentProfiles.id })
          .from(talentProfiles)
          .where(and(eq(talentProfiles.id, profileId), isNotNull(talentProfiles.aiApplyConsentAt)))
          .for("update");

        if (consenting === undefined) return "no_consent" as const;

        await tx
          .update(aiApplications)
          .set({ state: "cancelled", reason: "expired", finishedAt: now, updatedAt: now })
          .where(
            and(
              eq(aiApplications.profileId, profileId),
              eq(aiApplications.jobId, jobId),
              eq(aiApplications.state, "draft"),
              lte(aiApplications.preparedAt, new Date(now.getTime() - expiry)),
            ),
          );

        const [row] = await tx
          .insert(aiApplications)
          .values({
            profileId,
            jobId,
            ...attempt,
            preparedAt: now,
            createdAt: now,
            updatedAt: now,
            finishedAt: attempt.state === "assisted" ? now : null,
          })
          .returning();

        const [job] = await tx.select(jobColumns).from(jobs).where(eq(jobs.id, jobId));

        return toAttemptView(row, job);
      });
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
    const since = new Date(now.getTime() - expiry);

    const queued = await db
      .transaction(async (tx) => {
        const rows = await tx
          .update(aiApplications)
          .set({
            state: "queued",
            reason: null,
            confirmed: confirmation.confirmed,
            rehearsal: confirmation.rehearsal,
            confirmedAt: now,
            finishedAt: null,
            evidence: null,
            screenshotKey: null,
            liveUrl: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(aiApplications.id, id),
              eq(aiApplications.profileId, profileId),
              or(
                and(eq(aiApplications.state, "draft"), gt(aiApplications.preparedAt, since)),
                and(eq(aiApplications.state, "rehearsed"), gt(aiApplications.finishedAt, since)),
              ),
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
            await save(tx, profileId, entry.label, entry.text, { sensitive: entry.sensitive }, now);
          }
        }

        return rows[0];
      })
      .catch((error) => {
        if (uniqueViolation.safeParse(error).success) return "in_progress" as const;

        throw error;
      });

    if (queued === "in_progress") return queued;

    if (queued !== undefined) return withJob(queued);

    const current = await attempt(profileId, id);

    if (current === undefined || draftBlock(current.attempt, now) === "in_progress") {
      return "in_progress" as const;
    }

    const block = draftBlock(current.attempt, now);

    if (block !== undefined) return block;

    return (await hasApplied(profileId, current.attempt.jobId))
      ? ("applied" as const)
      : ("job_closed" as const);
  }

  async function cancel(profileId: string, id: string, now: Date) {
    if (!z.uuid().safeParse(id).success) return "not_found" as const;

    const [row] = await db
      .update(aiApplications)
      .set({
        state: "cancelled",
        reason: "cancelled_by_person",
        finishedAt: now,
        liveUrl: null,
        updatedAt: now,
      })
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

  async function runnable(id: string) {
    if (!z.uuid().safeParse(id).success) return undefined;

    const [row] = await db
      .select({
        attempt: aiApplications,
        job: { sourceKey: jobs.sourceKey, closedAt: jobs.closedAt },
        profile: {
          name: talentProfiles.name,
          email: talentProfiles.personalEmail,
          consentAt: talentProfiles.aiApplyConsentAt,
        },
        resume: resumes.content,
        resumeUpdatedAt: resumes.updatedAt,
        coverLetter: applicationPackages.coverLetter,
        letterUpdatedAt: applicationPackages.updatedAt,
        preferencesUpdatedAt: talentPreferences.updatedAt,
      })
      .from(aiApplications)
      .innerJoin(jobs, eq(jobs.id, aiApplications.jobId))
      .innerJoin(talentProfiles, eq(talentProfiles.id, aiApplications.profileId))
      .leftJoin(resumes, eq(resumes.id, aiApplications.resumeId))
      .leftJoin(
        applicationPackages,
        and(
          eq(applicationPackages.profileId, aiApplications.profileId),
          eq(applicationPackages.jobId, aiApplications.jobId),
        ),
      )
      .leftJoin(talentPreferences, eq(talentPreferences.profileId, aiApplications.profileId))
      .where(eq(aiApplications.id, id));

    if (row === undefined) return undefined;

    const key = sourceKey.exec(row.job.sourceKey);

    return {
      ...row,
      formUrl: key === null ? null : `https://job-boards.greenhouse.io/${key[1]}/jobs/${key[2]}`,
      applied: await hasApplied(row.attempt.profileId, row.attempt.jobId),
    };
  }

  async function queuedIds() {
    const rows = await db
      .select({ id: aiApplications.id })
      .from(aiApplications)
      .where(eq(aiApplications.state, "queued"));

    return rows.map((row) => row.id);
  }

  async function claimForRun(id: string, now: Date) {
    const rows = await db
      .update(aiApplications)
      .set({ state: "running", liveUrl: null, updatedAt: now })
      .where(
        and(
          eq(aiApplications.id, id),
          or(
            eq(aiApplications.state, "queued"),
            and(
              eq(aiApplications.state, "running"),
              lt(aiApplications.updatedAt, new Date(now.getTime() - liveRunMs)),
            ),
          ),
        ),
      )
      .returning({ id: aiApplications.id });

    return rows.length > 0;
  }

  async function requeue(id: string, now: Date) {
    const rows = await db
      .update(aiApplications)
      .set({ state: "queued", liveUrl: null, updatedAt: now })
      .where(and(eq(aiApplications.id, id), eq(aiApplications.state, "running")))
      .returning({ id: aiApplications.id });

    return rows.length > 0;
  }

  async function showLive(id: string, liveUrl: string) {
    await db
      .update(aiApplications)
      .set({ liveUrl })
      .where(and(eq(aiApplications.id, id), eq(aiApplications.state, "running")));
  }

  async function markSubmitting(id: string, now: Date) {
    const rows = await db
      .update(aiApplications)
      .set({ state: "submitting", updatedAt: now })
      .where(
        and(
          eq(aiApplications.id, id),
          eq(aiApplications.state, "running"),
          exists(
            db
              .select({ id: talentProfiles.id })
              .from(talentProfiles)
              .where(
                and(
                  eq(talentProfiles.id, aiApplications.profileId),
                  isNotNull(talentProfiles.aiApplyConsentAt),
                ),
              ),
          ),
          notExists(
            db
              .select({ id: applications.id })
              .from(applications)
              .where(
                and(
                  eq(applications.profileId, aiApplications.profileId),
                  eq(applications.jobId, aiApplications.jobId),
                ),
              ),
          ),
        ),
      )
      .returning({ id: aiApplications.id });

    return rows.length > 0;
  }

  async function sweepStale(now: Date) {
    const cutoff = new Date(now.getTime() - stuckMs);

    await db
      .update(aiApplications)
      .set({ state: "needs_check", reason: null, finishedAt: null, liveUrl: null, updatedAt: now })
      .where(and(eq(aiApplications.state, "submitting"), lt(aiApplications.updatedAt, cutoff)));

    await db
      .update(aiApplications)
      .set({ state: "assisted", reason: "error", finishedAt: now, liveUrl: null, updatedAt: now })
      .where(and(eq(aiApplications.state, "running"), lt(aiApplications.updatedAt, cutoff)));
  }

  async function finish(id: string, from: AttemptState[], outcome: Finish, now: Date) {
    const rows = await db
      .update(aiApplications)
      .set({
        ...outcome,
        finishedAt: outcome.state === "needs_check" ? null : now,
        liveUrl: null,
        updatedAt: now,
      })
      .where(and(eq(aiApplications.id, id), inArray(aiApplications.state, from)))
      .returning({ id: aiApplications.id });

    return rows.length > 0;
  }

  async function submittedWithApplication(
    id: string,
    record: { evidence: AttemptEvidence; screenshotKey: string | null },
    now: Date,
  ) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(aiApplications)
        .set({
          state: "submitted",
          reason: null,
          ...record,
          finishedAt: now,
          liveUrl: null,
          updatedAt: now,
        })
        .where(and(eq(aiApplications.id, id), eq(aiApplications.state, "submitting")))
        .returning({
          profileId: aiApplications.profileId,
          jobId: aiApplications.jobId,
          resumeId: aiApplications.resumeId,
        });

      if (row === undefined) return "lost" as const;

      const created = await recordApplication(tx, row, now);

      if (created === undefined) {
        await tx
          .update(aiApplications)
          .set({ state: "needs_check", finishedAt: null, liveUrl: null, updatedAt: now })
          .where(eq(aiApplications.id, id));

        return "needs_check" as const;
      }

      return "submitted" as const;
    });
  }

  async function check(profileId: string, id: string, sent: boolean, now: Date) {
    if (!z.uuid().safeParse(id).success) return "not_found" as const;

    const resolved = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          state: aiApplications.state,
          jobId: aiApplications.jobId,
          resumeId: aiApplications.resumeId,
        })
        .from(aiApplications)
        .where(and(eq(aiApplications.id, id), eq(aiApplications.profileId, profileId)))
        .for("update");

      if (row === undefined) return "not_found" as const;

      if (row.state !== "needs_check") return "nothing_to_check" as const;

      if (sent) {
        await recordApplication(tx, { profileId, jobId: row.jobId, resumeId: row.resumeId }, now);
      }

      const [updated] = await tx
        .update(aiApplications)
        .set(
          sent
            ? { state: "submitted", reason: null, finishedAt: now, liveUrl: null, updatedAt: now }
            : {
                state: "assisted",
                reason: "not_sent",
                finishedAt: now,
                liveUrl: null,
                updatedAt: now,
              },
        )
        .where(eq(aiApplications.id, id))
        .returning();

      return updated;
    });

    if (resolved === "not_found" || resolved === "nothing_to_check") return resolved;

    return withJob(resolved);
  }

  return {
    attempt,
    runnable,
    queuedIds,
    sweepStale,
    claimForRun,
    requeue,
    showLive,
    markSubmitting,
    finish,
    submittedWithApplication,
    check,
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
