import type { Database } from "@offboard/db/client";
import { jobRejections, jobs, rejectionReasonEnum } from "@offboard/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export const noteLimit = 500;

export type Rejection = {
  reason: (typeof rejectionReasonEnum.enumValues)[number];
  note: string | null;
};

export function createRejectionsRepository(db: Database) {
  async function reject(profileId: string, jobId: string, rejection: Rejection, now: Date) {
    if (!z.uuid().safeParse(jobId).success) return false;

    const [open] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.id, jobId), isNull(jobs.closedAt)));

    if (!open) return false;

    await db
      .insert(jobRejections)
      .values({ profileId, jobId, ...rejection, createdAt: now })
      .onConflictDoUpdate({
        target: [jobRejections.profileId, jobRejections.jobId],
        set: { ...rejection, createdAt: now },
      });

    return true;
  }

  async function unreject(profileId: string, jobId: string) {
    if (!z.uuid().safeParse(jobId).success) return;

    await db
      .delete(jobRejections)
      .where(and(eq(jobRejections.profileId, profileId), eq(jobRejections.jobId, jobId)));
  }

  async function list(profileId: string) {
    const rows = await db
      .select({
        job: { id: jobs.id, title: jobs.title, company: jobs.company },
        reason: jobRejections.reason,
        note: jobRejections.note,
        createdAt: jobRejections.createdAt,
      })
      .from(jobRejections)
      .innerJoin(jobs, eq(jobs.id, jobRejections.jobId))
      .where(eq(jobRejections.profileId, profileId))
      .orderBy(desc(jobRejections.createdAt), asc(jobRejections.jobId));

    const reasons = await db
      .select({ reason: jobRejections.reason, count: sql<number>`count(*)::int` })
      .from(jobRejections)
      .where(eq(jobRejections.profileId, profileId))
      .groupBy(jobRejections.reason)
      .orderBy(sql`count(*) desc`, sql`${jobRejections.reason}::text asc`);

    return {
      items: rows.map((row) => ({ ...row, createdAt: row.createdAt?.toISOString() ?? null })),
      reasons,
    };
  }

  return { reject, unreject, list };
}

export type RejectionsRepository = ReturnType<typeof createRejectionsRepository>;
