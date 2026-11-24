import type { Database } from "@offboard/db/client";
import { jobs } from "@offboard/db/schema";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { JobDraft } from "./extract.js";

type WorkModel = "remote" | "hybrid" | "onsite";

export type JobView = {
  id: string;
  origin: "external" | "hr" | "recruiter";
  title: string;
  company: string;
  workModel: WorkModel | null;
  city: string | null;
  state: string | null;
  salaryMinCents: number | null;
  salaryMaxCents: number | null;
  url: string;
  postedAt: string | null;
};

type Row = typeof jobs.$inferSelect;

function toJob(row: Row) {
  return {
    id: row.id,
    origin: row.origin,
    title: row.title,
    company: row.company,
    workModel: row.workModel,
    city: row.city,
    state: row.state,
    salaryMinCents: row.salaryMinCents,
    salaryMaxCents: row.salaryMaxCents,
    url: row.url,
    postedAt: row.postedAt?.toISOString() ?? null,
  } satisfies JobView;
}

export function createJobsRepository(db: Database) {
  async function findBySource(source: string, sourceKey: string) {
    const [row] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.source, source), eq(jobs.sourceKey, sourceKey)));

    return row ? toJob(row) : undefined;
  }

  async function createShared(input: JobDraft & { url: string; sourceKey: string }) {
    const [row] = await db
      .insert(jobs)
      .values({
        origin: "hr",
        source: "hr-link",
        sourceKey: input.sourceKey,
        title: input.title,
        company: input.company,
        workModel: input.workModel,
        city: input.city,
        state: input.state,
        salaryMinCents: input.salaryMinCents,
        salaryMaxCents: input.salaryMaxCents,
        url: input.url,
        description: input.description,
        postedAt: new Date(),
      })
      .onConflictDoNothing({ target: [jobs.source, jobs.sourceKey] })
      .returning();

    if (row) return { job: toJob(row), created: true };

    const [existing] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.source, "hr-link"), eq(jobs.sourceKey, input.sourceKey)));

    return { job: toJob(existing), created: false };
  }

  async function listOpen(filter: { workModel?: WorkModel; page: number; pageSize: number }) {
    const where = and(
      isNull(jobs.closedAt),
      filter.workModel === undefined ? undefined : eq(jobs.workModel, filter.workModel),
    );

    const [rows, [totals]] = await Promise.all([
      db
        .select()
        .from(jobs)
        .where(where)
        .orderBy(sql`${jobs.postedAt} desc nulls last`, desc(jobs.createdAt), jobs.id)
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      db.select({ total: count() }).from(jobs).where(where),
    ]);

    return { items: rows.map(toJob), total: totals.total };
  }

  return { findBySource, createShared, listOpen };
}

export type JobsRepository = ReturnType<typeof createJobsRepository>;
