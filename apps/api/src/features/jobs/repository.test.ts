import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  applications,
  jobMatches,
  jobs,
  offboardingCases,
  recruiterPartners,
  resumes,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";
import { createJobsRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const draft = {
  title: "Engenheira de Software",
  company: "Acme",
  workModel: "remote" as const,
  city: "São Paulo",
  state: "SP",
  salaryMinCents: 800000,
  salaryMaxCents: 1200000,
  description: "Descrição",
};

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

  it("creates a shared job from HR", async () => {
    const result = await repository.createShared({
      ...draft,
      url: "https://jobs.example.com/vaga",
      sourceKey: "https://jobs.example.com/vaga",
    });

    expect(result.created).toBe(true);
    expect(result.job).toMatchObject({
      origin: "hr",
      title: "Engenheira de Software",
      company: "Acme",
      workModel: "remote",
      city: "São Paulo",
      state: "SP",
      salaryMinCents: 800000,
      salaryMaxCents: 1200000,
      url: "https://jobs.example.com/vaga",
    });
    expect(result.job.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await repository.findBySource("hr-link", "https://jobs.example.com/vaga")).toEqual(
      result.job,
    );
  });

  it("deduplicates by normalized url", async () => {
    const input = {
      ...draft,
      url: "https://jobs.example.com/vaga",
      sourceKey: "https://jobs.example.com/vaga",
    };

    const first = await repository.createShared(input);
    const second = await repository.createShared({ ...input, title: "Outro título" });

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.title).toBe("Engenheira de Software");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("fails clearly when a conflicting row cannot be read back", async () => {
    const stub = Object.assign(Object.create(db), {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
      }),
      select: () => ({ from: () => ({ where: async () => [] }) }),
    });

    await expect(
      createJobsRepository(stub).createShared({
        ...draft,
        url: "https://x.example.com",
        sourceKey: "k",
      }),
    ).rejects.toThrow("vanished");
  });

  async function partner(company = "Talentos") {
    const [row] = await db
      .insert(recruiterPartners)
      .values({
        name: "Ana",
        company,
        tokenHash: crypto.randomUUID().replaceAll("-", "").repeat(2),
      })
      .returning({ id: recruiterPartners.id });

    return row.id;
  }

  it("stores a recruiter share apart from HR shares of the same url", async () => {
    const partnerId = await partner();
    const link = "https://jobs.example.com/vaga";
    const hr = await repository.createShared({ ...draft, url: link, sourceKey: link });

    const recruiter = await repository.createShared({
      ...draft,
      url: link,
      sourceKey: link,
      origin: "recruiter",
      recruiterPartnerId: partnerId,
    });

    expect(recruiter.created).toBe(true);
    expect(recruiter.job.id).not.toBe(hr.job.id);
    expect(recruiter.job.origin).toBe("recruiter");
    expect(await repository.findBySource("recruiter-link", link)).toEqual(recruiter.job);

    const again = await repository.createShared({
      ...draft,
      url: link,
      sourceKey: link,
      origin: "recruiter",
      recruiterPartnerId: await partner("Outra"),
    });

    expect(again).toEqual({ job: recruiter.job, created: false });
    expect(
      await db
        .select({ source: jobs.source, recruiterPartnerId: jobs.recruiterPartnerId })
        .from(jobs)
        .orderBy(jobs.source),
    ).toEqual([
      { source: "hr-link", recruiterPartnerId: null },
      { source: "recruiter-link", recruiterPartnerId: partnerId },
    ]);
  });

  it("counts a partner's jobs created since a moment", async () => {
    const partnerId = await partner();
    const otherId = await partner("Outra");
    const since = new Date("2026-11-24T03:00:00.000Z");

    await insert("before", {
      recruiterPartnerId: partnerId,
      createdAt: new Date("2026-11-24T02:59:59.999Z"),
    });
    await insert("at", { recruiterPartnerId: partnerId, createdAt: since });
    await insert("after", {
      recruiterPartnerId: partnerId,
      createdAt: new Date("2026-11-24T20:00:00.000Z"),
    });
    await insert("other", { recruiterPartnerId: otherId, createdAt: since });
    await insert("hr", { createdAt: since });

    expect(await repository.countByPartnerSince(partnerId, since)).toBe(2);
    expect(await repository.countByPartnerSince(crypto.randomUUID(), since)).toBe(0);
  });

  it("stamps shared jobs with the app clock", async () => {
    const now = new Date("2020-01-02T03:04:05.678Z");

    vi.useFakeTimers({ toFake: ["Date"], now });

    try {
      const { job } = await repository.createShared({
        ...draft,
        url: "https://jobs.example.com/agora",
        sourceKey: "https://jobs.example.com/agora",
      });

      expect(
        await db
          .select({ createdAt: jobs.createdAt, updatedAt: jobs.updatedAt })
          .from(jobs)
          .where(eq(jobs.id, job.id)),
      ).toEqual([{ createdAt: now, updatedAt: now }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns nothing for an unknown source key", async () => {
    expect(await repository.findBySource("hr-link", "missing")).toBeUndefined();
  });

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
