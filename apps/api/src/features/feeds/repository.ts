import type { Database } from "@offboard/db/client";
import { jobSources, jobs } from "@offboard/db/schema";
import { and, asc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { uniqueViolation } from "../../shared/http.js";
import type { FeedJob, FeedResult } from "./sources.js";

type Provider = (typeof jobSources.$inferSelect)["kind"];

export type FeedView = {
  id: string;
  provider: Provider;
  board: string;
  companyLabel: string | null;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  openJobs: number;
};

const hourMs = 60 * 60_000;
const dueAfterMs = 6 * hourMs;
const closeAfterMs = 72 * hourMs;
const upsertChunk = 500;

const ownedBy = (provider: Provider | SQL, board: string | SQL) =>
  and(
    eq(jobs.origin, "external"),
    sql`${jobs.source} = ${provider}::text`,
    sql`left(${jobs.sourceKey}, length(${board}::text) + 1) = ${board}::text || ':'`,
  );

const errorCode = (result: Extract<FeedResult, { error: string }>) =>
  result.error === "http_error" ? `http_${result.status}` : result.error;

const latestByKey = (feedJobs: FeedJob[]) => [
  ...new Map(feedJobs.map((job) => [job.sourceKey, job])).values(),
];

const feedColumns = {
  id: jobSources.id,
  provider: jobSources.kind,
  board: jobSources.target,
  companyLabel: jobSources.label,
  enabled: jobSources.enabled,
  lastSyncedAt: jobSources.lastSyncedAt,
  lastError: jobSources.lastError,
};

type FeedRow = Omit<FeedView, "lastSyncedAt" | "openJobs"> & { lastSyncedAt: Date | null };

const toView = (row: FeedRow, openJobs: number) =>
  ({
    ...row,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    openJobs,
  }) satisfies FeedView;

export function createFeedsRepository(db: Database) {
  const openJobs = sql<number>`(select count(*)::int from ${jobs} where ${and(
    ownedBy(sql`${jobSources.kind}`, sql`${jobSources.target}`),
    isNull(jobs.closedAt),
  )})`;

  async function views(where?: SQL) {
    const rows = await db
      .select({ ...feedColumns, openJobs })
      .from(jobSources)
      .where(where)
      .orderBy(asc(jobSources.target), asc(jobSources.kind));

    return rows.map(({ openJobs: count, ...row }) => toView(row, count));
  }

  async function get(id: string) {
    const [view] = await views(eq(jobSources.id, id));

    return view;
  }

  async function create(input: { provider: Provider; board: string; companyLabel: string | null }) {
    try {
      const [{ openJobs: count, ...row }] = await db
        .insert(jobSources)
        .values({ kind: input.provider, target: input.board, label: input.companyLabel })
        .returning({ ...feedColumns, openJobs });

      return toView(row, count);
    } catch (error) {
      if (uniqueViolation.safeParse(error).success) return "exists";

      throw error;
    }
  }

  async function update(id: string, changes: { enabled?: boolean; companyLabel?: string | null }) {
    const [row] = await db
      .update(jobSources)
      .set({ enabled: changes.enabled, label: changes.companyLabel, updatedAt: new Date() })
      .where(eq(jobSources.id, id))
      .returning({ id: jobSources.id });

    return row && get(row.id);
  }

  function remove(id: string, now: Date) {
    return db.transaction(async (tx) => {
      const [feed] = await tx
        .delete(jobSources)
        .where(eq(jobSources.id, id))
        .returning({ provider: jobSources.kind, board: jobSources.target });

      if (!feed) return false;

      await tx
        .update(jobs)
        .set({ closedAt: now, updatedAt: now })
        .where(and(ownedBy(feed.provider, feed.board), isNull(jobs.closedAt)));

      return true;
    });
  }

  async function dueIds(now: Date) {
    const rows = await db
      .select({ id: jobSources.id })
      .from(jobSources)
      .where(
        and(
          eq(jobSources.enabled, true),
          or(
            isNull(jobSources.lastSyncedAt),
            lt(jobSources.lastSyncedAt, new Date(now.getTime() - dueAfterMs)),
          ),
        ),
      );

    return rows.map((row) => row.id);
  }

  async function sync(feedId: string, result: FeedResult, now: Date) {
    if ("error" in result) {
      await db
        .update(jobSources)
        .set({ lastSyncedAt: now, lastError: errorCode(result) })
        .where(eq(jobSources.id, feedId));

      return "failed" as const;
    }

    return db.transaction(async (tx) => {
      const [feed] = await tx
        .update(jobSources)
        .set({ lastSyncedAt: now, lastError: null })
        .where(eq(jobSources.id, feedId))
        .returning({ provider: jobSources.kind, board: jobSources.target });

      if (!feed) return "failed" as const;

      const unique = latestByKey(result.jobs);
      let created = 0;
      let updated = 0;

      for (let start = 0; start < unique.length; start += upsertChunk) {
        const rows = await tx
          .insert(jobs)
          .values(
            unique.slice(start, start + upsertChunk).map((job) => ({
              origin: "external" as const,
              source: feed.provider,
              sourceKey: job.sourceKey,
              title: job.title,
              company: job.company,
              workModel: job.workModel,
              city: job.city,
              state: job.state,
              url: job.url,
              description: job.description,
              postedAt: job.postedAt,
              lastSeenAt: now,
              closedAt: null,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [jobs.source, jobs.sourceKey],
            set: {
              title: sql`excluded.title`,
              company: sql`excluded.company`,
              workModel: sql`excluded.work_model`,
              city: sql`excluded.city`,
              state: sql`excluded.state`,
              url: sql`excluded.url`,
              description: sql`excluded.description`,
              postedAt: sql`excluded.posted_at`,
              lastSeenAt: now,
              closedAt: null,
              updatedAt: now,
            },
            setWhere: eq(jobs.origin, "external"),
          })
          .returning({ inserted: sql<boolean>`xmax = 0` });

        for (const row of rows) {
          if (row.inserted) created += 1;
          else updated += 1;
        }
      }

      const closed = await tx
        .update(jobs)
        .set({ closedAt: now, updatedAt: now })
        .where(
          and(
            ownedBy(feed.provider, feed.board),
            isNull(jobs.closedAt),
            lt(jobs.lastSeenAt, new Date(now.getTime() - closeAfterMs)),
          ),
        )
        .returning({ id: jobs.id });

      return { created, updated, closed: closed.length, skipped: result.skipped };
    });
  }

  return { list: () => views(), get, create, update, remove, dueIds, sync };
}

export type FeedsRepository = ReturnType<typeof createFeedsRepository>;
