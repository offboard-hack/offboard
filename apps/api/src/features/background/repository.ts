import type { Database } from "@offboard/db/client";
import { backgroundJobs, type ConfigValue } from "@offboard/db/schema";
import { and, asc, eq, inArray, lt, lte, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export type BackgroundJob = {
  id: string;
  kind: string;
  subject: string;
  payload: Record<string, ConfigValue>;
  attempts: number;
};

const lockMs = 5 * 60_000;
const maxAttempts = 3;
const maxErrorLength = 2_000;

const twin = alias(backgroundJobs, "pending_twin");

function running(id: string) {
  return and(eq(backgroundJobs.id, id), eq(backgroundJobs.status, "running"));
}

function withoutPendingTwin(db: Database) {
  return notExists(
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
}

export function createBackgroundRepository(db: Database) {
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

  async function claim(limit: number, now = new Date()) {
    return db.transaction(async (tx) => {
      const due = await tx
        .select({ id: backgroundJobs.id })
        .from(backgroundJobs)
        .where(
          or(
            and(eq(backgroundJobs.status, "pending"), lte(backgroundJobs.runAfter, now)),
            and(eq(backgroundJobs.status, "running"), lt(backgroundJobs.lockedUntil, now)),
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

  async function complete(id: string) {
    await db
      .update(backgroundJobs)
      .set({ status: "done", lockedUntil: null, updatedAt: new Date() })
      .where(running(id));
  }

  async function retry(id: string, error: string, attempts: number, now = new Date()) {
    const lastError = error.slice(0, maxErrorLength);

    if (attempts < maxAttempts) {
      const rescheduled = await db
        .update(backgroundJobs)
        .set({
          status: "pending",
          runAfter: new Date(now.getTime() + 2 ** attempts * 60_000),
          lockedUntil: null,
          lastError,
          updatedAt: now,
        })
        .where(and(running(id), withoutPendingTwin(db)))
        .returning({ id: backgroundJobs.id });

      if (rescheduled.length > 0) return;
    }

    await db
      .update(backgroundJobs)
      .set({ status: "failed", lockedUntil: null, lastError, updatedAt: now })
      .where(running(id));
  }

  async function postpone(id: string, runAfter: Date) {
    const now = new Date();

    const postponed = await db
      .update(backgroundJobs)
      .set({
        status: "pending",
        runAfter,
        lockedUntil: null,
        attempts: sql`${backgroundJobs.attempts} - 1`,
        updatedAt: now,
      })
      .where(and(running(id), withoutPendingTwin(db)))
      .returning({ id: backgroundJobs.id });

    if (postponed.length > 0) return;

    await db
      .update(backgroundJobs)
      .set({ status: "done", lockedUntil: null, updatedAt: now })
      .where(running(id));
  }

  return { enqueue, claim, complete, retry, postpone };
}

export type BackgroundRepository = ReturnType<typeof createBackgroundRepository>;
