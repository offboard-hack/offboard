import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, expect, it } from "vitest";
import { createClient, createRequestScopedClient } from "../src/client.ts";
import { eq } from "drizzle-orm";
import { seedTalentProfiles } from "../src/talent-profile.fixture.ts";
import { seedApplications } from "../src/application.fixture.ts";
import { seedJobs } from "../src/job.fixture.ts";
import {
  applicationEvents,
  applications,
  authSession,
  interviews,
  jobs,
  offboardingCases,
  talentProfiles,
  tasks,
} from "../src/schema/index.ts";
import { seedCases, seedDatabase, testSeedFixtures } from "../src/seed-database.ts";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

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

      const profiles = await db.select().from(talentProfiles);
      expect(profiles).toHaveLength(seedTalentProfiles.length);

      const [profile] = profiles;
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

    const rows = await db.select().from(applications);
    expect(rows).toHaveLength(seedApplications.length);
    expect(await db.select().from(applicationEvents)).toHaveLength(9);
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
      .values({ origin: "hr", source: "t", sourceKey: "t1", title: "t", company: "t", url: "t" })
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

    expect(await db.select().from(applications)).toHaveLength(0);
    expect(await db.select().from(applicationEvents)).toHaveLength(0);
    expect(await db.select().from(interviews)).toHaveLength(0);
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
