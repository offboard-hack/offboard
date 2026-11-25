import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { aiApplications, applications, jobs, offboardingCases } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("ai apply repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("rethrows failures other than a duplicate attempt", async () => {
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      caseId: first.id,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    await expect(
      repos.aiApply.createAttempt(
        created.id,
        "00000000-0000-4000-8000-000000000001",
        {
          form: { questions: [] },
          draft: [],
          state: "draft",
          reason: null,
          resumeId: "00000000-0000-4000-8000-000000000002",
        },
        new Date(),
      ),
    ).rejects.toThrow();
  });

  it("diagnoses a confirm that lost the race to expiry or a manual application", async () => {
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      caseId: first.id,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    const [job] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "greenhouse",
        sourceKey: "acme:1",
        title: "Backend",
        company: "Acme",
        url: "https://example.com/1",
      })
      .returning({ id: jobs.id });

    const day = 24 * 60 * 60 * 1000;

    const [stale] = await db
      .insert(aiApplications)
      .values({
        profileId: created.id,
        jobId: job.id,
        state: "draft",
        form: { questions: [] },
        draft: [],
        preparedAt: new Date(Date.now() - 8 * day),
      })
      .returning({ id: aiApplications.id });

    const confirmation = { confirmed: [], rehearsal: false, entries: [] };
    const save = async () => undefined;

    expect(await repos.aiApply.confirm(created.id, stale.id, confirmation, new Date(), save)).toBe(
      "expired",
    );

    await db
      .update(aiApplications)
      .set({ preparedAt: new Date() })
      .where(eq(aiApplications.id, stale.id));

    await db.insert(applications).values({ profileId: created.id, jobId: job.id });

    expect(await repos.aiApply.confirm(created.id, stale.id, confirmation, new Date(), save)).toBe(
      "applied",
    );
  });
});
