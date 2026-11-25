import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, expect, it } from "vitest";
import { createClient, createRequestScopedClient } from "../src/client.ts";
import { and, eq } from "drizzle-orm";
import type { Database } from "../src/client.ts";
import {
  seedBystanderProfiles,
  seedCohortProfiles,
  seedTalentProfiles,
} from "../src/talent-profile.fixture.ts";
import { seedApplications, seedCohortApplications } from "../src/application.fixture.ts";
import { seedJobs } from "../src/job.fixture.ts";
import {
  applicationEvents,
  applications,
  authSession,
  backgroundJobs,
  interviews,
  jobMatches,
  jobSources,
  jobs,
  llmUsage,
  offboardingCases,
  publicPageDailyViews,
  publicPages,
  resumeSuggestions,
  resumes,
  talentProfiles,
  tasks,
} from "../src/schema/index.ts";
import { seedCases, seedDatabase, testSeedFixtures } from "../src/seed-database.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const marinaProfileId = async (db: Database) => {
  const [marina] = await db
    .select({ id: talentProfiles.id })
    .from(talentProfiles)
    .where(eq(talentProfiles.name, "Marina Lopes"));

  return marina.id;
};

it.skipIf(!url)(
  "allows queries and transactions only inside a database request scope",
  async () => {
    const { db, run } = createRequestScopedClient(() => url ?? "");
    const query = sql`select 1 as value`;

    expect(() => db.$client.query("select 1")).toThrow(
      "Database access requires an active request",
    );

    await run(async () => {
      expect((await db.execute(query)).rows).toEqual([{ value: 1 }]);
      await db.transaction(async (transaction) => {
        expect((await transaction.execute(query)).rows).toEqual([{ value: 1 }]);
      });
    });

    expect(() => db.$client.query("select 1")).toThrow(
      "Database access requires an active request",
    );
  },
);

it.skipIf(!url)("seeds the database with the example cases and tasks", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    await seedDatabase(db);

    expect(await db.select().from(offboardingCases)).toHaveLength(seedCases.length);
    expect(await db.select().from(tasks)).toHaveLength(
      seedCases.reduce((sum, entry) => sum + entry.tasks.length, 0),
    );
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)(
  "detaches talent profiles from deleted cases and enforces one session audience",
  async () => {
    const db = createClient(url ?? "");

    try {
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
      });
      await seedDatabase(db);

      const marinaId = await marinaProfileId(db);
      const profiles = await db.select().from(talentProfiles);
      expect(profiles).toHaveLength(
        seedTalentProfiles.length + seedCohortProfiles.length + seedBystanderProfiles.length,
      );

      const profile = profiles.find((item) => item.id === marinaId);

      if (!profile) throw new Error("Marina profile missing");
      expect(profile.caseId).not.toBeNull();

      const [other] = await db
        .select()
        .from(offboardingCases)
        .where(sql`${offboardingCases.id} <> ${profile.caseId}`);

      await expect(
        db.insert(talentProfiles).values({
          caseId: other.id,
          personalEmail: profile.personalEmail.toUpperCase(),
          name: "Duplicate",
          sponsoredUntil: "2027-01-01",
        }),
      ).rejects.toMatchObject({ cause: { code: "23505" } });

      await expect(
        db.insert(authSession).values({
          id: "session-without-audience",
          token: "token-without-audience",
          userId: "missing-user",
          expiresAt: new Date(),
        }),
      ).rejects.toMatchObject({ cause: { code: "23514" } });

      await db.delete(offboardingCases).where(eq(offboardingCases.id, profile.caseId ?? ""));

      const [detached] = await db
        .select()
        .from(talentProfiles)
        .where(eq(talentProfiles.id, profile.id));

      expect(detached.caseId).toBeNull();
    } finally {
      await db.$client.end();
    }
  },
);

it.skipIf(!url)("stores jobs with a unique source key and a valid salary range", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    await seedDatabase(db);

    const rows = await db.select().from(jobs);
    expect(rows).toHaveLength(seedJobs.length);

    const [job] = rows;

    const base = {
      origin: job.origin,
      title: job.title,
      company: job.company,
      url: job.url,
    };

    await expect(
      db.insert(jobs).values({ ...base, source: job.source, sourceKey: job.sourceKey }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    await expect(
      db.insert(jobs).values({
        ...base,
        source: "seed",
        sourceKey: "invalid-range",
        salaryMinCents: 200,
        salaryMaxCents: 100,
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("refuses to seed applications without a talent profile", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });

    await expect(
      seedDatabase(db, { ...testSeedFixtures, jobs: seedJobs, applications: seedApplications }),
    ).rejects.toThrow("Seeding applications requires at least one talent profile");
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("stores applications with one per job and a consistent closed reason", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedDatabase(db);

    const marinaId = await marinaProfileId(db);
    const all = await db.select().from(applications);
    expect(all).toHaveLength(seedApplications.length + seedCohortApplications.length);
    const rows = all.filter((item) => item.profileId === marinaId);
    expect(rows).toHaveLength(seedApplications.length);
    expect(
      await db
        .select()
        .from(applicationEvents)
        .where(
          sql`${applicationEvents.applicationId} in (${sql.join(
            rows.map((item) => sql`${item.id}`),
            sql`, `,
          )})`,
        ),
    ).toHaveLength(9);
    const [agenda] = await db.select().from(interviews);
    expect(agenda.startsAt.toISOString().slice(11)).toBe("13:00:00.000Z");
    expect(agenda.mode).toBe("video");

    const [application] = rows;
    const key = { profileId: application.profileId, jobId: application.jobId };

    await expect(db.insert(applications).values(key)).rejects.toMatchObject({
      cause: { code: "23505" },
    });

    const [freshJob] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "t",
        sourceKey: "t1",
        title: "t",
        company: "t",
        url: "t",
      })
      .returning();

    const fresh = { profileId: application.profileId, jobId: freshJob.id };

    await expect(
      db.insert(applications).values({ ...fresh, status: "closed" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(applications).values({ ...fresh, closedReason: "rejected" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(applications).values({ ...fresh, furthestStage: "closed" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await expect(db.delete(jobs).where(eq(jobs.id, application.jobId))).rejects.toMatchObject({
      cause: { code: "23503" },
    });

    await db.delete(talentProfiles).where(eq(talentProfiles.id, application.profileId));

    expect(await db.select().from(applications)).toHaveLength(seedCohortApplications.length);
    expect(await db.select().from(interviews)).toHaveLength(0);
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("stores one base résumé per profile", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedDatabase(db);

    const [base] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.kind, "base"), eq(resumes.profileId, await marinaProfileId(db))));

    expect(base.kind).toBe("base");
    expect(base.status).toBe("ready");
    expect(base.jobId).toBeNull();
    expect(base.score).toBe(82);
    expect(base.scoredAt).toBeInstanceOf(Date);
    expect(base.content.headline.text).toBe("Analista de Marketing");

    const profileId = base.profileId;
    const content = base.content;

    await expect(
      db.insert(resumes).values({ profileId, kind: "base", content }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const [job] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "r",
        sourceKey: "r1",
        title: "t",
        company: "t",
        url: "t",
      })
      .returning();

    await expect(
      db.insert(resumes).values({ profileId, kind: "base", jobId: job.id, content }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(resumes).values({ profileId, kind: "tailored", content }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await db.delete(resumes);

    await expect(
      db.insert(resumes).values({ profileId, kind: "base", status: "draft", content }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(resumes).values({ profileId, kind: "base", score: 101, content }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await db.insert(resumes).values({ profileId, kind: "base", score: 100, content });
    await db
      .insert(resumes)
      .values({ profileId, kind: "tailored", status: "draft", jobId: job.id, content });
    await expect(
      db.insert(resumes).values({ profileId, kind: "tailored", jobId: job.id, content }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    await expect(db.delete(jobs).where(eq(jobs.id, job.id))).rejects.toMatchObject({
      cause: { code: "23503" },
    });

    await db.delete(talentProfiles).where(eq(talentProfiles.id, profileId));

    expect(await db.select().from(resumes)).toHaveLength(0);
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("links applications to the résumé they used", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedDatabase(db);

    const tailored = await db.select().from(resumes).where(eq(resumes.kind, "tailored"));
    const ready = tailored.filter((item) => item.status === "ready");
    const drafts = tailored.filter((item) => item.status === "draft");
    expect(tailored).toHaveLength(2);
    expect(ready.map((item) => item.matchScore)).toEqual([92]);
    expect(drafts.map((item) => item.matchScore)).toEqual([85]);

    const used = await db
      .select()
      .from(applications)
      .where(
        and(
          sql`${applications.resumeId} is not null`,
          eq(applications.profileId, await marinaProfileId(db)),
        ),
      );

    expect(used.map((item) => item.resumeId)).toEqual([ready[0].id]);
    expect(used[0].jobId).toBe(ready[0].jobId);
    expect(drafts[0].jobId).not.toBe(ready[0].jobId);

    const draftJobId = drafts[0].jobId ?? "";
    const [draftJob] = await db.select().from(jobs).where(eq(jobs.id, draftJobId));
    expect(draftJob.closedAt).toBeNull();
    expect(
      await db
        .select()
        .from(applications)
        .where(
          and(
            eq(applications.jobId, draftJobId),
            eq(applications.profileId, await marinaProfileId(db)),
          ),
        ),
    ).toEqual([]);
    expect(ready[0].updatedAt?.getTime()).toBeGreaterThan(drafts[0].updatedAt?.getTime() ?? 0);
    expect(
      tailored.every(
        (item) => (item.updatedAt?.getTime() ?? 0) >= (item.createdAt?.getTime() ?? Infinity),
      ),
    ).toBe(true);

    const [job] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "m",
        sourceKey: "m1",
        title: "t",
        company: "t",
        url: "t",
      })
      .returning();

    const { profileId, content } = ready[0];

    await expect(
      db
        .insert(resumes)
        .values({ profileId, kind: "tailored", jobId: job.id, matchScore: 101, content }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db
        .insert(resumes)
        .values({ profileId, kind: "tailored", jobId: job.id, matchScore: -1, content }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await db.delete(resumes).where(eq(resumes.id, ready[0].id));

    const [after] = await db.select().from(applications).where(eq(applications.id, used[0].id));
    expect(after.resumeId).toBeNull();
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("stores jobs, suggestions and usage", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedDatabase(db);

    const [base] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.kind, "base"), eq(resumes.profileId, await marinaProfileId(db))));

    const suggestions = await db.select().from(resumeSuggestions);
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((item) => item.estimatedGain).sort()).toEqual([3, 4, 4]);
    expect(suggestions.every((item) => item.status === "open")).toBe(true);
    expect(await db.select().from(backgroundJobs)).toHaveLength(0);
    expect(await db.select().from(llmUsage)).toHaveLength(0);

    const nodes = [
      base.content.headline,
      base.content.summary,
      ...base.content.experiences.flatMap((experience) => experience.bullets),
    ];

    for (const item of suggestions) {
      expect(item.resumeId).toBe(base.id);
      expect(item.originalText).toBe(nodes.find((node) => node.id === item.targetNodeId)?.text);
      expect(item.updatedAt).toEqual(item.createdAt);

      for (const figure of item.suggestedText.match(/\d+/g) ?? []) {
        expect(item.originalText).toContain(figure);
      }
    }

    expect(new Set(suggestions.map((item) => item.createdAt?.getTime())).size).toBe(3);

    const runAfter = new Date();
    await db.insert(backgroundJobs).values({ kind: "score", subject: "a", runAfter });
    await expect(
      db.insert(backgroundJobs).values({ kind: "score", subject: "a", runAfter }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await db
      .insert(backgroundJobs)
      .values({ kind: "score", subject: "a", status: "running", runAfter });
    await db.insert(backgroundJobs).values({ kind: "score", subject: "b", runAfter });
    const [stored] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.subject, "b"));
    expect(stored.payload).toEqual({});
    expect(stored.attempts).toBe(0);
    expect(stored.lockedUntil).toBeNull();

    const row = {
      resumeId: base.id,
      targetNodeId: base.content.summary.id,
      originalText: "a",
      suggestedText: "b",
      rationale: "c",
    };

    await expect(
      db.insert(resumeSuggestions).values({ ...row, estimatedGain: 0 }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(resumeSuggestions).values({ ...row, estimatedGain: 21 }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await db.insert(llmUsage).values({ profileId: base.profileId, day: "2026-11-24" });
    await expect(
      db.insert(llmUsage).values({ profileId: base.profileId, day: "2026-11-24" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    const [usage] = await db.select().from(llmUsage);
    expect(usage.calls).toBe(0);

    await db.delete(resumes).where(eq(resumes.id, base.id));
    expect(await db.select().from(resumeSuggestions)).toHaveLength(0);

    await db.delete(talentProfiles).where(eq(talentProfiles.id, base.profileId));
    expect(await db.select().from(llmUsage)).toHaveLength(0);
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("stores public pages and daily counters", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedDatabase(db);

    const [page] = await db.select().from(publicPages);
    expect(page.slug).toBe("marina-lopes");
    expect(page.enabled).toBe(true);
    expect(page.resumeId).toBeNull();

    const views = await db.select().from(publicPageDailyViews);
    expect(views).toHaveLength(7);
    expect(views.reduce((sum, item) => sum + item.visits, 0)).toBe(31);
    expect(views.reduce((sum, item) => sum + item.recruiterVisits, 0)).toBe(6);
    expect(views.every((item) => item.recruiterVisits <= item.visits)).toBe(true);

    const saoPaulo = (offset: number) =>
      new Date(Date.now() - 3 * 3_600_000 - offset * 86_400_000).toISOString().slice(0, 10);

    expect(views.map((item) => item.day).sort()).toEqual(
      [6, 5, 4, 3, 2, 1, 0].map((offset) => saoPaulo(offset)),
    );

    const tokens = (
      await db.select().from(applications).where(eq(applications.profileId, page.profileId))
    ).map((item) => item.publicToken);

    expect(tokens).toHaveLength(4);
    expect(new Set(tokens).size).toBe(4);
    expect(tokens.every((token) => /^[A-Za-z0-9_-]{32}$/.test(token ?? ""))).toBe(true);

    await expect(
      db.insert(publicPageDailyViews).values({ profileId: page.profileId, day: saoPaulo(0) }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const [other] = await db
      .insert(talentProfiles)
      .values({
        personalEmail: "outra@exemplo.com",
        name: "Outra",
        sponsoredUntil: saoPaulo(-30),
      })
      .returning();

    await expect(
      db.insert(publicPages).values({ profileId: other.id, slug: "marina-lopes" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await expect(
      db.insert(publicPages).values({ profileId: other.id, slug: "Marina" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(publicPages).values({ profileId: other.id, slug: "ab" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(publicPages).values({ profileId: other.id, slug: "a--b" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(publicPageDailyViews).values({
        profileId: other.id,
        day: saoPaulo(0),
        visits: 1,
        recruiterVisits: 2,
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    const [created] = await db
      .insert(publicPages)
      .values({ profileId: other.id, slug: "outra" })
      .returning();

    expect(created.enabled).toBe(false);
    expect(created.resumeId).toBeNull();
    await db.delete(publicPages).where(eq(publicPages.profileId, other.id));

    const [application] = await db.select().from(applications);
    await expect(
      db
        .update(applications)
        .set({ publicToken: tokens.find((token) => token !== application.publicToken) })
        .where(eq(applications.id, application.id)),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const [ready] = await db.select().from(resumes).where(eq(resumes.kind, "tailored"));
    await db.update(publicPages).set({ resumeId: ready.id });
    await db.delete(resumes).where(eq(resumes.id, ready.id));
    const [after] = await db.select().from(publicPages);
    expect(after.resumeId).toBeNull();

    await db.delete(talentProfiles).where(eq(talentProfiles.id, page.profileId));
    expect(await db.select().from(publicPages)).toHaveLength(0);
    expect(await db.select().from(publicPageDailyViews)).toHaveLength(0);
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("stores one match per profile and job", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedDatabase(db);

    const [base] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.kind, "base"), eq(resumes.profileId, await marinaProfileId(db))));

    const seeded = await db
      .select({ score: jobMatches.score, reasons: jobMatches.reasons, title: jobs.title })
      .from(jobMatches)
      .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
      .orderBy(sql`${jobMatches.score} desc`);

    expect(seeded.map((item) => item.score)).toEqual([94, 89, 86, 85, 83]);
    expect(seeded.map((item) => item.title)).toEqual(seedJobs.map((item) => item.title));
    expect(seeded.every((item) => item.reasons.length === 2)).toBe(true);

    const matches = await db.select().from(jobMatches);
    expect(matches).toHaveLength(5);
    expect(matches.every((item) => item.profileId === base.profileId)).toBe(true);
    expect(
      matches.every((item) => item.resumeUpdatedAt.getTime() === base.updatedAt?.getTime()),
    ).toBe(true);

    const [first] = matches;
    await expect(db.insert(jobMatches).values({ ...first, score: 50 })).rejects.toMatchObject({
      cause: { code: "23505" },
    });

    const [spare] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "test",
        sourceKey: "spare",
        title: "Vaga",
        company: "Empresa",
        url: "https://example.com/spare",
      })
      .returning({ id: jobs.id });

    const row = { profileId: base.profileId, jobId: spare.id, resumeUpdatedAt: new Date() };
    await expect(
      db.insert(jobMatches).values({ ...row, score: 101, computedAt: new Date() }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      db.insert(jobMatches).values({ ...row, score: -1, computedAt: new Date() }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.insert(jobMatches).values({ ...row, score: 0, computedAt: new Date() });
    const [stored] = await db.select().from(jobMatches).where(eq(jobMatches.jobId, spare.id));
    expect(stored.reasons).toEqual([]);

    await db.delete(jobs).where(eq(jobs.id, spare.id));
    expect(await db.select().from(jobMatches)).toHaveLength(5);

    await db.delete(applications);
    await db.delete(resumes).where(eq(resumes.kind, "tailored"));
    await db.delete(jobs).where(eq(jobs.id, first.jobId));
    expect(await db.select().from(jobMatches)).toHaveLength(4);

    await db.delete(talentProfiles).where(eq(talentProfiles.id, base.profileId));
    expect(await db.select().from(jobMatches)).toHaveLength(0);

    const indexes = await db.execute(
      sql`select indexdef from pg_indexes where indexname = 'jobs_search_idx'`,
    );

    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0].indexdef).toContain("gin");
  } finally {
    await db.$client.end();
  }
});

describe("createClient", () => {
  it("strips sslmode and disables certificate verification for cloud hosts", async () => {
    const cloud = createClient(
      "postgres://u:p@db.supabase.co:5432/db?sslmode=require&application_name=x",
    );

    const options = cloud.$client.options;
    expect(options.connectionString).toBe(
      "postgres://u:p@db.supabase.co:5432/db?application_name=x",
    );
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
    await cloud.$client.end();

    const only = createClient("postgres://u:p@x.neon.tech/db?sslmode=require");
    expect(only.$client.options.connectionString).toBe("postgres://u:p@x.neon.tech/db");
    await only.$client.end();
  });

  it("leaves local urls untouched", async () => {
    const local = createClient("postgres://u:p@localhost:5432/db?sslmode=disable");
    expect(local.$client.options.connectionString).toBe(
      "postgres://u:p@localhost:5432/db?sslmode=disable",
    );
    expect(local.$client.options.ssl).toBeUndefined();
    await local.$client.end();
  });
});

it.skipIf(!url)("seeds enough people for HR aggregates", async () => {
  const db = createClient(url ?? "");

  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await seedDatabase(db);

    const profiles = await db.select().from(talentProfiles);

    expect(profiles).toHaveLength(
      seedTalentProfiles.length + seedCohortProfiles.length + seedBystanderProfiles.length,
    );

    const bystanderNames = new Set(seedBystanderProfiles.map((item) => item.name));

    const cohort = profiles.filter(
      (item) => item.name !== "Marina Lopes" && !bystanderNames.has(item.name),
    );

    expect(cohort).toHaveLength(seedCohortProfiles.length);
    expect(cohort.every((item) => item.personalEmail.endsWith("@exemplo.com"))).toBe(true);
    expect(cohort.every((item) => item.termsAcceptedAt !== null && item.caseId !== null)).toBe(
      true,
    );

    const bystanders = profiles.filter((item) => bystanderNames.has(item.name));
    expect(bystanders).toHaveLength(seedBystanderProfiles.length);
    expect(
      bystanders.every(
        (item) =>
          item.termsAcceptedAt === null && item.firstSignedInAt === null && item.caseId !== null,
      ),
    ).toBe(true);

    const rows = await db.select().from(applications);
    const applicantIds = new Set(rows.map((item) => item.profileId));
    expect(bystanders.some((item) => applicantIds.has(item.id))).toBe(false);
    expect(
      profiles
        .filter((item) => applicantIds.has(item.id))
        .every((item) => item.firstSignedInAt !== null),
    ).toBe(true);

    const reached = (stages: string[], closedReasons: string[] = []) =>
      new Set(
        rows
          .filter(
            (item) =>
              stages.includes(item.furthestStage) ||
              (item.closedReason !== null && closedReasons.includes(item.closedReason)),
          )
          .map((item) => item.profileId),
      ).size;

    expect(new Set(rows.map((item) => item.profileId)).size).toBeGreaterThanOrEqual(6);
    expect(
      reached(["in_review", "interview", "offer"], ["rejected", "hired"]),
    ).toBeGreaterThanOrEqual(5);
    expect(reached(["interview", "offer"])).toBeGreaterThanOrEqual(5);
    expect(reached(["offer"])).toBeLessThan(5);

    const hired = rows.filter((item) => item.closedReason === "hired");

    const shared = new Set(
      profiles.filter((item) => item.shareOutcomeWithHr).map((item) => item.id),
    );

    expect(hired.filter((item) => shared.has(item.profileId))).toHaveLength(2);
    expect(hired.filter((item) => !shared.has(item.profileId))).toHaveLength(1);
    expect(hired.every((item) => item.furthestStage === "offer")).toBe(true);
    expect(rows.every((item) => item.furthestStage !== "closed")).toBe(true);
    expect(rows.every((item) => (item.status === "closed") === (item.closedReason !== null))).toBe(
      true,
    );

    const resumeRows = await db.select().from(resumes).where(eq(resumes.kind, "base"));
    const baseByProfile = new Map(resumeRows.map((item) => [item.profileId, item.id]));

    for (const item of rows.filter(
      (row) => row.profileId !== profiles.find((p) => p.name === "Marina Lopes")?.id,
    )) {
      expect(item.resumeId).toBe(baseByProfile.get(item.profileId));
    }

    const events = await db.select().from(applicationEvents);

    for (const item of rows) {
      const own = events.filter((event) => event.applicationId === item.id);
      const stages = ["sent", "in_review", "interview", "offer"];
      const expected = stages.slice(0, stages.indexOf(item.furthestStage) + 1);
      expect(
        own
          .filter((event) => event.status !== "closed")
          .map((event) => event.status)
          .sort(),
      ).toEqual([...expected].sort());
      expect(
        own.filter((event) => event.status === "closed").map((event) => event.closedReason),
      ).toEqual(item.closedReason ? [item.closedReason] : []);
    }
  } finally {
    await db.$client.end();
  }
});

it.skipIf(!url)("stores job sources and closes shared jobs", async () => {
  const db = createClient(url ?? "");
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

  try {
    await migrate(db, { migrationsFolder });
    await seedDatabase(db);

    const sources = await db.select().from(jobSources).orderBy(jobSources.target);
    expect(
      sources.map((source) => [source.kind, source.target, source.label, source.enabled]),
    ).toEqual([
      ["greenhouse", "quintoandar", "QuintoAndar", false],
      ["greenhouse", "stone", "Stone", false],
    ]);
    expect(sources.every((source) => source.lastSyncedAt === null)).toBe(true);
    expect(sources.every((source) => source.lastError === null)).toBe(true);

    await expect(
      db.insert(jobSources).values({ kind: "greenhouse", target: "stone" }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await expect(
      db.insert(jobSources).values({ kind: "lever", target: "Bad Slug" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await db.insert(jobSources).values({ kind: "lever", target: "stone" });

    const seeded = await db.select().from(jobs);
    expect(seeded).toHaveLength(seedJobs.length);
    expect(seeded.every((job) => job.origin === "external" && job.lastSeenAt === null)).toBe(true);

    const marinaId = await marinaProfileId(db);
    const closedBefore = new Date("2026-01-01T00:00:00Z");
    const migration = await readFile(`${migrationsFolder}/0018_add_job_sources.sql`, "utf8");

    const replayed = db.transaction(async (tx) => {
      await tx.execute(sql.raw('DROP TABLE "job_sources"'));
      await tx.execute(sql.raw('DROP TYPE "public"."job_source_kind"'));
      await tx.execute(sql.raw('ALTER TABLE "jobs" DROP COLUMN "last_seen_at"'));

      const opened = (origin: "external" | "hr" | "recruiter", key: string, closedAt?: string) =>
        tx.execute(
          sql`insert into jobs (origin, source, source_key, title, company, url, closed_at) values (${origin}, 'legacy', ${key}, ${key}, 'Acme', ${`https://jobs.example.com/${key}`}, ${closedAt ?? null}) returning id`,
        );

      const [hr] = (await opened("hr", "hr-open")).rows;
      await opened("recruiter", "recruiter-open");
      await opened("hr", "hr-closed", "2026-01-01 00:00:00");
      await opened("external", "external-open");
      await tx.execute(
        sql`insert into applications (profile_id, job_id) values (${marinaId}, ${hr.id})`,
      );

      for (const statement of migration.split("--> statement-breakpoint")) {
        await tx.execute(sql.raw(statement));
      }

      const legacy = await tx
        .select({ key: jobs.sourceKey, closedAt: jobs.closedAt })
        .from(jobs)
        .where(eq(jobs.source, "legacy"))
        .orderBy(jobs.sourceKey);

      expect(legacy.map((job) => [job.key, job.closedAt === null])).toEqual([
        ["external-open", true],
        ["hr-closed", false],
        ["hr-open", false],
        ["recruiter-open", false],
      ]);
      expect(legacy.find((job) => job.key === "hr-closed")?.closedAt).toEqual(closedBefore);

      const applied = await tx
        .select({ title: jobs.title, closedAt: jobs.closedAt })
        .from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId))
        .where(and(eq(applications.profileId, marinaId), eq(jobs.source, "legacy")));

      expect(applied).toEqual([{ title: "hr-open", closedAt: expect.any(Date) }]);
      expect(await tx.select().from(jobSources)).toEqual([]);

      tx.rollback();
    });

    await expect(replayed).rejects.toThrow("Rollback");
    expect(await db.select().from(jobSources)).toHaveLength(3);
  } finally {
    await db.$client.end();
  }
});
