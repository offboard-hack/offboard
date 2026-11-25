import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { applications, jobMatches, jobs, offboardingCases, resumes } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";
import { createJobsRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("jobs repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = createJobsRepository(db);

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

  function insert(sourceKey: string, values: Partial<typeof jobs.$inferInsert> = {}) {
    return db.insert(jobs).values({
      origin: "external",
      source: "seed",
      sourceKey,
      title: sourceKey,
      company: "Acme",
      url: `https://jobs.example.com/${sourceKey}`,
      ...values,
    });
  }

  describe("listForTalent", () => {
    let profileId: string;
    let otherProfileId: string;

    function resumeContent() {
      return {
        headline: { id: "headline", text: "Engenheira" },
        summary: { id: "summary", text: "Backend." },
        experiences: [],
        education: [],
        skills: [],
        languages: [],
        contact: { email: null, phone: null, city: null, links: [] },
      };
    }

    async function enable(index: number, personalEmail: string) {
      const cases = await db.select({ id: offboardingCases.id }).from(offboardingCases);

      const profile = await repos.talent.enable({
        caseId: cases[index].id,
        personalEmail,
        sponsoredUntil: "2026-12-31",
      });

      const { id } = z.object({ id: z.uuid() }).parse(profile);

      await repos.resumes.replaceBase(id, resumeContent(), `resumes/${id}.pdf`);

      return id;
    }

    async function baseVersion(id: string) {
      const [row] = await db
        .select({ updatedAt: resumes.updatedAt })
        .from(resumes)
        .where(and(eq(resumes.profileId, id), eq(resumes.kind, "base")));

      return row.updatedAt ?? new Date(0);
    }

    async function match(id: string, sourceKey: string, score: number, resumeUpdatedAt?: Date) {
      const [job] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.sourceKey, sourceKey));

      await db.insert(jobMatches).values({
        profileId: id,
        jobId: job.id,
        score,
        reasons: [`motivo ${sourceKey}`],
        resumeUpdatedAt: resumeUpdatedAt ?? (await baseVersion(id)),
        computedAt: new Date(),
      });

      return job.id;
    }

    beforeEach(async () => {
      profileId = await enable(0, "pessoa@exemplo.com");
      otherProfileId = await enable(1, "outra@exemplo.com");
    });

    it("lists jobs with this profile's fresh matches only", async () => {
      await insert("low", { postedAt: new Date("2026-01-01T00:00:00Z") });
      await insert("high", { postedAt: new Date("2026-01-02T00:00:00Z") });
      await insert("stale", { postedAt: new Date("2026-03-01T00:00:00Z") });
      await insert("newest", { postedAt: new Date("2026-05-01T00:00:00Z") });
      await insert("older", { postedAt: new Date("2026-04-01T00:00:00Z") });
      await insert("undated");
      await insert("closed", { closedAt: new Date("2026-04-02T00:00:00Z") });

      await match(profileId, "low", 40);
      await match(profileId, "high", 90);
      await match(profileId, "stale", 99, new Date("2020-01-01T00:00:00Z"));
      await match(profileId, "closed", 100);
      await match(otherProfileId, "newest", 95);

      const [applied] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.sourceKey, "low"));

      const [otherApplied] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.sourceKey, "newest"));

      await db.insert(applications).values([
        { profileId, jobId: applied.id },
        { profileId: otherProfileId, jobId: otherApplied.id },
      ]);

      const result = await repository.listForTalent(profileId, { page: 1, pageSize: 10 });

      expect(result.total).toBe(6);
      expect(result.items.map((job) => job.title)).toEqual([
        "high",
        "low",
        "newest",
        "older",
        "stale",
        "undated",
      ]);
      expect(result.items.map((job) => job.match)).toEqual([
        { score: 90, reasons: ["motivo high"] },
        { score: 40, reasons: ["motivo low"] },
        null,
        null,
        null,
        null,
      ]);
      expect(result.items.map((job) => job.applied)).toEqual([
        false,
        true,
        false,
        false,
        false,
        false,
      ]);

      const other = await repository.listForTalent(otherProfileId, { page: 1, pageSize: 10 });

      expect(other.items.map((job) => job.title).slice(0, 1)).toEqual(["newest"]);
      expect(other.items[0].applied).toBe(true);
      expect(other.items.filter((job) => job.match)).toHaveLength(1);
    });

    it("treats a résumé version with microseconds as fresh", async () => {
      await insert("job");

      const saved = await baseVersion(profileId);

      await db.execute(
        sql`update resumes set updated_at = date_trunc('milliseconds', updated_at) + interval '456 microseconds' where profile_id = ${profileId}`,
      );
      await match(profileId, "job", 70, saved);

      const [row] = await db
        .select({ micro: sql<string>`to_char(updated_at, 'US')` })
        .from(resumes)
        .where(eq(resumes.profileId, profileId));

      expect(row.micro.endsWith("456")).toBe(true);

      const result = await repository.listForTalent(profileId, { page: 1, pageSize: 10 });

      expect(result.items[0].match).toEqual({ score: 70, reasons: ["motivo job"] });
    });

    it("falls back to the created time when the résumé was never updated", async () => {
      await insert("job");
      await match(profileId, "job", 70);
      await db.execute(
        sql`update resumes set updated_at = null, created_at = date_trunc('milliseconds', now()) where profile_id = ${profileId}`,
      );

      const [row] = await db
        .select({ createdAt: resumes.createdAt })
        .from(resumes)
        .where(eq(resumes.profileId, profileId));

      await db
        .update(jobMatches)
        .set({ resumeUpdatedAt: row.createdAt ?? new Date(0) })
        .where(eq(jobMatches.profileId, profileId));

      const result = await repository.listForTalent(profileId, { page: 1, pageSize: 10 });

      expect(result.items[0].match?.score).toBe(70);
    });

    it("shows no matches for a profile without a résumé", async () => {
      await insert("job");
      await match(profileId, "job", 70);
      await db.delete(resumes).where(eq(resumes.profileId, profileId));

      const result = await repository.listForTalent(profileId, { page: 1, pageSize: 10 });

      expect(result.items[0].match).toBeNull();
    });

    it("filters by work model and paginates", async () => {
      await insert("old", { postedAt: new Date("2026-01-01T00:00:00Z"), workModel: "remote" });
      await insert("new", { postedAt: new Date("2026-03-01T00:00:00Z"), workModel: "hybrid" });
      await insert("undated", { workModel: "remote" });

      const remote = await repository.listForTalent(profileId, {
        workModel: "remote",
        page: 1,
        pageSize: 10,
      });

      expect(remote.total).toBe(2);
      expect(remote.items.map((job) => job.title)).toEqual(["old", "undated"]);

      const second = await repository.listForTalent(profileId, { page: 2, pageSize: 1 });

      expect(second.total).toBe(3);
      expect(second.items.map((job) => job.title)).toEqual(["old"]);
    });
  });
});
