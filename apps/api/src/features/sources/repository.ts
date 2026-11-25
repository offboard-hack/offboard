import type { Database } from "@offboard/db/client";
import { jobSources, jobs } from "@offboard/db/schema";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { CatalogSource } from "./catalog.js";
import type { FeedJob, FeedResult } from "./sources.js";

type Kind = CatalogSource["kind"];

const hourMs = 60 * 60_000;
const dueAfterMs = 6 * hourMs;
const closeAfterMs = 72 * hourMs;
const upsertChunk = 500;

const ownedBy = (kind: Kind, target: string) =>
  and(
    eq(jobs.origin, "external"),
    sql`${jobs.source} = ${kind}::text`,
    sql`left(${jobs.sourceKey}, length(${target}::text) + 1) = ${target}::text || ':'`,
  );

const errorCode = (result: Extract<FeedResult, { error: string }>) =>
  result.error === "http_error" ? `http_${result.status}` : result.error;

const latestByKey = (sourceJobs: FeedJob[]) => [
  ...new Map(sourceJobs.map((job) => [job.sourceKey, job])).values(),
];

const keyOf = (source: { kind: Kind; target: string }) => `${source.kind}:${source.target}`;

export function createSourcesRepository(db: Database) {
  async function get(id: string) {
    const [source] = await db
      .select({
        id: jobSources.id,
        kind: jobSources.kind,
        target: jobSources.target,
        label: jobSources.label,
        enabled: jobSources.enabled,
      })
      .from(jobSources)
      .where(eq(jobSources.id, id));

    return source;
  }

  function syncCatalog(catalog: readonly CatalogSource[], now: Date) {
    return db.transaction(async (tx) => {
      const listed = new Map(catalog.map((entry) => [keyOf(entry), entry]));

      const existing = await tx
        .select({
          id: jobSources.id,
          kind: jobSources.kind,
          target: jobSources.target,
          label: jobSources.label,
          enabled: jobSources.enabled,
        })
        .from(jobSources)
        .for("update");

      const known = new Set(existing.map(keyOf));
      const fresh = [...listed.values()].filter((entry) => !known.has(keyOf(entry)));

      const added =
        fresh.length === 0
          ? []
          : await tx
              .insert(jobSources)
              .values(fresh.map((entry) => ({ ...entry, createdAt: now, updatedAt: now })))
              .onConflictDoNothing()
              .returning({ id: jobSources.id });

      let enabled = 0;

      for (const source of existing) {
        const entry = listed.get(keyOf(source));

        if (entry === undefined || (source.enabled && source.label === entry.label)) continue;

        if (!source.enabled) enabled += 1;

        await tx
          .update(jobSources)
          .set({ enabled: true, label: entry.label, updatedAt: now })
          .where(eq(jobSources.id, source.id));
      }

      const removed = existing.filter((source) => source.enabled && !listed.has(keyOf(source)));

      if (removed.length === 0) return { added: added.length, enabled, disabled: 0, closed: 0 };

      await tx
        .update(jobSources)
        .set({ enabled: false, updatedAt: now })
        .where(
          inArray(
            jobSources.id,
            removed.map((source) => source.id),
          ),
        );

      const closed = await tx
        .update(jobs)
        .set({ closedAt: now, updatedAt: now })
        .where(
          and(
            or(...removed.map((source) => ownedBy(source.kind, source.target))),
            isNull(jobs.closedAt),
          ),
        )
        .returning({ id: jobs.id });

      return { added: added.length, enabled, disabled: removed.length, closed: closed.length };
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

  async function sync(sourceId: string, result: FeedResult, now: Date) {
    if ("error" in result) {
      await db
        .update(jobSources)
        .set({ lastSyncedAt: now, lastError: errorCode(result) })
        .where(eq(jobSources.id, sourceId));

      return "failed" as const;
    }

    return db.transaction(async (tx) => {
      const [source] = await tx
        .update(jobSources)
        .set({ lastSyncedAt: now, lastError: null })
        .where(and(eq(jobSources.id, sourceId), eq(jobSources.enabled, true)))
        .returning({ kind: jobSources.kind, target: jobSources.target });

      if (!source) return "failed" as const;

      const unique = latestByKey(result.jobs);
      let created = 0;
      let updated = 0;

      for (let start = 0; start < unique.length; start += upsertChunk) {
        const rows = await tx
          .insert(jobs)
          .values(
            unique.slice(start, start + upsertChunk).map((job) => ({
              origin: "external" as const,
              source: source.kind,
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
            ownedBy(source.kind, source.target),
            isNull(jobs.closedAt),
            lt(jobs.lastSeenAt, new Date(now.getTime() - closeAfterMs)),
          ),
        )
        .returning({ id: jobs.id });

      return { created, updated, closed: closed.length, skipped: result.skipped };
    });
  }

  return { get, syncCatalog, dueIds, sync };
}

export type SourcesRepository = ReturnType<typeof createSourcesRepository>;
