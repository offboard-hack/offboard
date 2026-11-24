import type { Database } from "@offboard/db/client";
import { backgroundJobs, type ConfigValue } from "@offboard/db/schema";
import { and, asc, eq, gte, inArray, lt, lte, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias, type PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";

export type BackgroundJob = {
  id: string;
  kind: string;
  subject: string;
  payload: Record<string, ConfigValue>;
  attempts: number;
};

type Claimed = Pick<BackgroundJob, "id" | "attempts">;

export type ClaimTarget = { kind: string; subject: string };

const lockMs = 5 * 60_000;
const maxAttempts = 3;
const maxErrorLength = 2_000;
const enqueueChunk = 1_000;

const twin = alias(backgroundJobs, "pending_twin");

const pendingViolation = z.object({
  cause: z.object({
    code: z.literal("23505"),
    constraint: z.literal("background_jobs_pending_idx"),
  }),
});

function held(job: Claimed) {
  return and(
    eq(backgroundJobs.id, job.id),
    eq(backgroundJobs.status, "running"),
    eq(backgroundJobs.attempts, job.attempts),
  );
}

function expired(now: Date) {
  return and(eq(backgroundJobs.status, "running"), lt(backgroundJobs.lockedUntil, now));
}

export function createBackgroundRepository(db: Database) {
  const withoutPendingTwin = notExists(
    db
      .select({ id: twin.id })
      .from(twin)
      .where(
        and(
          eq(twin.kind, backgroundJobs.kind),
          eq(twin.subject, backgroundJobs.subject),
          eq(twin.status, "pending"),
        ),
      ),
  );

  async function requeue(where: SQL | undefined, values: PgUpdateSetSource<typeof backgroundJobs>) {
    try {
      const requeued = await db
        .update(backgroundJobs)
        .set({ ...values, status: "pending", lockedUntil: null })
        .where(and(where, withoutPendingTwin))
        .returning({ id: backgroundJobs.id });

      return requeued.length > 0;
    } catch (error) {
      if (pendingViolation.safeParse(error).success) return false;

      throw error;
    }
  }

  async function enqueue(
    kind: string,
    subject: string,
    payload: Record<string, ConfigValue> = {},
    runAfter = new Date(),
  ) {
    const now = new Date();

    await db
      .insert(backgroundJobs)
      .values({ kind, subject, payload, runAfter, createdAt: now, updatedAt: now })
      .onConflictDoNothing({
        target: [backgroundJobs.kind, backgroundJobs.subject],
        where: sql`status = 'pending'`,
      });
  }

  async function enqueueMany(kind: string, subjects: string[]) {
    const unique = [...new Set(subjects)];

    for (let start = 0; start < unique.length; start += enqueueChunk) {
      const now = new Date();

      await db
        .insert(backgroundJobs)
        .values(
          unique.slice(start, start + enqueueChunk).map((subject) => ({
            kind,
            subject,
            payload: {},
            runAfter: now,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing({
          target: [backgroundJobs.kind, backgroundJobs.subject],
          where: sql`status = 'pending'`,
        });
    }
  }

  async function claim(limit: number, now = new Date(), target?: ClaimTarget) {
    const targeted =
      target &&
      and(eq(backgroundJobs.kind, target.kind), eq(backgroundJobs.subject, target.subject));

    return db.transaction(async (tx) => {
      await tx
        .update(backgroundJobs)
        .set({
          status: "failed",
          lockedUntil: null,
          lastError: "Stopped while running",
          updatedAt: now,
        })
        .where(
          inArray(
            backgroundJobs.id,
            tx
              .select({ id: backgroundJobs.id })
              .from(backgroundJobs)
              .where(and(targeted, expired(now), gte(backgroundJobs.attempts, maxAttempts)))
              .for("update", { skipLocked: true }),
          ),
        );

      const due = await tx
        .select({ id: backgroundJobs.id })
        .from(backgroundJobs)
        .where(
          and(
            targeted,
            or(
              and(eq(backgroundJobs.status, "pending"), lte(backgroundJobs.runAfter, now)),
              and(expired(now), lt(backgroundJobs.attempts, maxAttempts)),
            ),
          ),
        )
        .orderBy(asc(backgroundJobs.runAfter), asc(backgroundJobs.id))
        .limit(limit)
        .for("update", { skipLocked: true });

      if (due.length === 0) return [];

      const ids = due.map((job) => job.id);

      const claimed = await tx
        .update(backgroundJobs)
        .set({
          status: "running",
          lockedUntil: new Date(now.getTime() + lockMs),
          attempts: sql`${backgroundJobs.attempts} + 1`,
          updatedAt: now,
        })
        .where(inArray(backgroundJobs.id, ids))
        .returning({
          id: backgroundJobs.id,
          kind: backgroundJobs.kind,
          subject: backgroundJobs.subject,
          payload: backgroundJobs.payload,
          attempts: backgroundJobs.attempts,
        });

      return claimed.sort(
        (a, b) => ids.indexOf(a.id) - ids.indexOf(b.id),
      ) satisfies BackgroundJob[];
    });
  }

  async function complete(job: Claimed) {
    await db
      .update(backgroundJobs)
      .set({ status: "done", lockedUntil: null, updatedAt: new Date() })
      .where(held(job));
  }

  async function retry(job: Claimed, error: string, now = new Date()) {
    const lastError = error.slice(0, maxErrorLength);

    const rescheduled =
      job.attempts < maxAttempts &&
      (await requeue(held(job), {
        runAfter: new Date(now.getTime() + 2 ** job.attempts * 60_000),
        lastError,
        updatedAt: now,
      }));

    if (rescheduled) return;

    await db
      .update(backgroundJobs)
      .set({ status: "failed", lockedUntil: null, lastError, updatedAt: now })
      .where(held(job));
  }

  async function postpone(job: Claimed, runAfter: Date) {
    const now = new Date();

    const postponed = await requeue(held(job), {
      runAfter,
      attempts: sql`${backgroundJobs.attempts} - 1`,
      updatedAt: now,
    });

    if (postponed) return;

    await db
      .update(backgroundJobs)
      .set({ status: "done", lockedUntil: null, updatedAt: now })
      .where(held(job));
  }

  return { enqueue, enqueueMany, claim, complete, retry, postpone };
}

export type BackgroundRepository = ReturnType<typeof createBackgroundRepository>;
