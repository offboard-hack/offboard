import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, expect, it } from "vitest";
import { createClient, createRequestScopedClient } from "../src/client.ts";
import { eq } from "drizzle-orm";
import { seedTalentProfiles } from "../src/talent-profile.fixture.ts";
import { seedJobs } from "../src/job.fixture.ts";
import { authSession, jobs, offboardingCases, talentProfiles, tasks } from "../src/schema/index.ts";
import { seedCases, seedDatabase } from "../src/seed-database.ts";

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
