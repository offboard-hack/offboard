import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  applications,
  backgroundJobs,
  defaultOrgId,
  jobMatches,
  jobRejections,
  jobs,
  offboardingCases,
  resumes,
  talentPreferences,
} from "@offboard/db/schema";
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
        orgId: defaultOrgId,
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

      const result = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

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

      const other = await repository.listForTalent(otherProfileId, {
        page: 1,
        pageSize: 10,
      });

      expect(other.items.map((job) => job.title).slice(0, 1)).toEqual(["newest"]);
      expect(other.items[0].applied).toBe(true);
      expect(other.items.filter((job) => job.match)).toHaveLength(1);
    });

    it("tells which jobs AI Apply can take and returns their description", async () => {
      await insert("acme:42", {
        source: "greenhouse",
        description: "Vaga <b>backend</b>\n\nRemoto",
        postedAt: new Date("2026-05-01T00:00:00Z"),
      });
      await insert("acme", {
        source: "greenhouse",
        postedAt: new Date("2026-04-01T00:00:00Z"),
      });
      await insert("acme:43", { postedAt: new Date("2026-03-01T00:00:00Z") });

      const result = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(
        result.items.map(({ title, aiApplyCapable, description }) => ({
          title,
          aiApplyCapable,
          description,
        })),
      ).toEqual([
        {
          title: "acme:42",
          aiApplyCapable: true,
          description: "Vaga <b>backend</b>\n\nRemoto",
        },
        { title: "acme", aiApplyCapable: false, description: "" },
        { title: "acme:43", aiApplyCapable: false, description: "" },
      ]);
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

      const result = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(result.items[0].match).toEqual({
        score: 70,
        reasons: ["motivo job"],
      });
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

      const result = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(result.items[0].match?.score).toBe(70);
    });

    it("shows no matches for a profile without a résumé", async () => {
      await insert("job");
      await match(profileId, "job", 70);
      await db.delete(resumes).where(eq(resumes.profileId, profileId));

      const result = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(result.items[0].match).toBeNull();
    });

    it("filters by work model and paginates", async () => {
      await insert("old", {
        postedAt: new Date("2026-01-01T00:00:00Z"),
        workModel: "remote",
      });
      await insert("new", {
        postedAt: new Date("2026-03-01T00:00:00Z"),
        workModel: "hybrid",
      });
      await insert("undated", { workModel: "remote" });

      const remote = await repository.listForTalent(profileId, {
        workModel: "remote",
        page: 1,
        pageSize: 10,
      });

      expect(remote.total).toBe(2);
      expect(remote.items.map((job) => job.title)).toEqual(["old", "undated"]);

      const second = await repository.listForTalent(profileId, {
        page: 2,
        pageSize: 1,
      });

      expect(second.total).toBe(3);
      expect(second.items.map((job) => job.title)).toEqual(["old"]);
    });

    it("lists only compatible jobs in the compatible view", async () => {
      await insert("best", { workModel: "remote" });
      await insert("edge", { workModel: "remote" });
      await insert("weak", { workModel: "remote" });
      await insert("stale", { workModel: "remote" });
      await insert("hybrid", { workModel: "hybrid" });
      await insert("rejected", { workModel: "remote" });
      await insert("theirs", { workModel: "remote" });
      await insert("unmatched", { workModel: "remote" });

      await match(profileId, "best", 90);
      await match(profileId, "edge", 50);
      await match(profileId, "weak", 49);
      await match(profileId, "stale", 99, new Date("2020-01-01T00:00:00Z"));
      await match(profileId, "hybrid", 80);
      const rejectedId = await match(profileId, "rejected", 95);
      await match(otherProfileId, "theirs", 99);
      await db.insert(jobRejections).values({ profileId, jobId: rejectedId, reason: "salary" });

      const compatible = await repository.listForTalent(profileId, {
        view: "compatible",
        page: 1,
        pageSize: 10,
      });

      expect(compatible.total).toBe(3);
      expect(compatible.items.map((job) => job.title)).toEqual(["best", "hybrid", "edge"]);

      const remote = await repository.listForTalent(profileId, {
        view: "compatible",
        workModel: "remote",
        page: 1,
        pageSize: 10,
      });

      expect(remote.total).toBe(2);
      expect(remote.items.map((job) => job.title)).toEqual(["best", "edge"]);

      const second = await repository.listForTalent(profileId, {
        view: "compatible",
        page: 2,
        pageSize: 2,
      });

      expect(second.total).toBe(3);
      expect(second.items.map((job) => job.title)).toEqual(["edge"]);

      const all = await repository.listForTalent(profileId, {
        view: "all",
        page: 1,
        pageSize: 20,
      });

      expect(all.total).toBe(7);
    });

    it("reports whether matches are being computed for this profile", async () => {
      const idle = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(idle.matching).toBe(false);

      await db.insert(backgroundJobs).values([
        {
          kind: "compute_matches",
          subject: otherProfileId,
          runAfter: new Date(),
        },
        {
          kind: "compute_matches",
          subject: profileId,
          status: "done",
          runAfter: new Date(),
        },
        { kind: "score_resume", subject: profileId, runAfter: new Date() },
      ]);

      const other = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(other.matching).toBe(false);

      await db.insert(backgroundJobs).values({
        kind: "compute_matches",
        subject: profileId,
        runAfter: new Date(),
      });

      const pending = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(pending.matching).toBe(true);

      await db
        .update(backgroundJobs)
        .set({ status: "running" })
        .where(eq(backgroundJobs.subject, profileId));

      const running = await repository.listForTalent(profileId, {
        page: 1,
        pageSize: 10,
      });

      expect(running.matching).toBe(true);

      await db.delete(backgroundJobs);
    });

    describe("rejections and preferences", () => {
      type Stored = typeof talentPreferences.$inferInsert.jobPreferences;

      function prefer(jobPreferences: Stored, id = profileId) {
        return db.insert(talentPreferences).values({ profileId: id, jobPreferences });
      }

      async function titles(id = profileId, page = 1, pageSize = 20) {
        const result = await repository.listForTalent(id, { page, pageSize });

        return result.items.map((job) => job.title);
      }

      async function fits() {
        const result = await repository.listForTalent(profileId, {
          page: 1,
          pageSize: 50,
        });

        return Object.fromEntries(result.items.map((job) => [job.title, job.fitsPreferences]));
      }

      async function reject(sourceKey: string, id = profileId) {
        const [job] = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.sourceKey, sourceKey));

        await db.insert(jobRejections).values({ profileId: id, jobId: job.id, reason: "salary" });
      }

      it("hides rejected jobs", async () => {
        await insert("keep", {
          workModel: "remote",
          postedAt: new Date("2026-03-01T00:00:00Z"),
        });
        await insert("drop", {
          workModel: "remote",
          postedAt: new Date("2026-02-01T00:00:00Z"),
        });
        await insert("other", {
          workModel: "hybrid",
          postedAt: new Date("2026-01-01T00:00:00Z"),
        });
        await match(profileId, "drop", 99);
        await reject("drop");
        await reject("other", otherProfileId);

        const listed = await repository.listForTalent(profileId, {
          page: 1,
          pageSize: 10,
        });

        expect(listed.total).toBe(2);
        expect(listed.items.map((job) => job.title)).toEqual(["keep", "other"]);

        const remote = await repository.listForTalent(profileId, {
          workModel: "remote",
          page: 1,
          pageSize: 10,
        });

        expect(remote.total).toBe(1);
        expect(remote.items.map((job) => job.title)).toEqual(["keep"]);

        const paged = await repository.listForTalent(profileId, {
          page: 2,
          pageSize: 1,
        });

        expect(paged.total).toBe(2);
        expect(paged.items.map((job) => job.title)).toEqual(["other"]);
        expect(await titles(otherProfileId)).toEqual(["keep", "drop"]);
      });

      it("keeps the existing order and fits everything without preferences", async () => {
        await insert("a", {
          postedAt: new Date("2026-01-01T00:00:00Z"),
          workModel: "onsite",
        });
        await insert("b", {
          postedAt: new Date("2026-02-01T00:00:00Z"),
          company: "Zed",
        });
        await insert("c");
        await match(profileId, "a", 50);

        const before = await titles();

        expect(before).toEqual(["a", "b", "c"]);
        expect(Object.values(await fits())).toEqual([true, true, true]);

        await prefer({});

        expect(await titles()).toEqual(before);
        expect(Object.values(await fits())).toEqual([true, true, true]);
      });

      it("ranks jobs that fit preferences first", async () => {
        await insert("remote-new", {
          postedAt: new Date("2026-03-01T00:00:00Z"),
          workModel: "remote",
        });
        await insert("onsite-top", {
          postedAt: new Date("2026-04-01T00:00:00Z"),
          workModel: "onsite",
        });
        await insert("hybrid-old", {
          postedAt: new Date("2026-01-01T00:00:00Z"),
          workModel: "hybrid",
        });
        await insert("unknown", { postedAt: new Date("2026-02-01T00:00:00Z") });
        await match(profileId, "onsite-top", 99);
        await match(profileId, "hybrid-old", 80);
        await prefer({ workModels: ["remote", "hybrid"] });

        expect(await titles()).toEqual(["hybrid-old", "remote-new", "unknown", "onsite-top"]);
        expect(await fits()).toEqual({
          "hybrid-old": true,
          "remote-new": true,
          unknown: true,
          "onsite-top": false,
        });
      });

      it("matches locations by state and city, with remote, relocate and unknown fitting", async () => {
        await insert("sp-city", {
          workModel: "onsite",
          state: "sp",
          city: " São Paulo ",
        });
        await insert("sp-other", {
          workModel: "onsite",
          state: "SP",
          city: "Campinas",
        });
        await insert("sp-nocity", { workModel: "onsite", state: "SP" });
        await insert("rj", { workModel: "onsite", state: "RJ", city: "Rio" });
        await insert("rj-remote", { workModel: "remote", state: "RJ" });
        await insert("nowhere", { workModel: "onsite" });
        await prefer({ locations: [{ city: "são paulo", state: "SP" }] });

        expect(await fits()).toEqual({
          "sp-city": true,
          "sp-other": false,
          "sp-nocity": true,
          rj: false,
          "rj-remote": true,
          nowhere: true,
        });

        await db.update(talentPreferences).set({
          jobPreferences: { locations: [{ city: null, state: "sp" }] },
        });

        expect(await fits()).toMatchObject({
          "sp-other": true,
          "sp-nocity": true,
          rj: false,
        });

        await db.update(talentPreferences).set({
          jobPreferences: {
            locations: [{ city: null, state: "SP" }],
            relocate: true,
          },
        });

        expect(await fits()).toMatchObject({ rj: true });
      });

      it("returns a real boolean for an unknown work model in an unlisted state", async () => {
        await insert("odd", { workModel: null, state: "RJ" });
        await prefer({ locations: [{ state: "SP", city: null }] });

        const result = await repository.listForTalent(profileId, {
          page: 1,
          pageSize: 10,
        });

        expect(result.items.map((job) => job.fitsPreferences)).toEqual([false]);
      });

      it("ignores a stored location without a city", async () => {
        await insert("sp", {
          workModel: "onsite",
          state: "SP",
          city: "Campinas",
        });
        await insert("rj", { workModel: "onsite", state: "RJ" });
        await db.execute(
          sql`insert into talent_preferences (profile_id, job_preferences) values (${profileId}, '{"locations":[{"state":"SP"}]}'::jsonb)`,
        );

        expect(await fits()).toEqual({ sp: true, rj: false });
      });

      it("excludes companies case-insensitively", async () => {
        await insert("a", { company: "  ACME Corp " });
        await insert("b", { company: "Other" });
        await prefer({ excludedCompanies: [" acme corp", "x"] });

        expect(await fits()).toEqual({ a: false, b: true });
        expect(await titles()).toEqual(["b", "a"]);
      });

      it("applies the salary floor and lets unknown salaries fit", async () => {
        await insert("high", { salaryMaxCents: 1_000_000 });
        await insert("exact", { salaryMaxCents: 500_000 });
        await insert("low", {
          salaryMaxCents: 100_000,
          salaryMinCents: 50_000,
        });
        await insert("unknown");
        await prefer({ salaryFloorCents: 500_000 });

        expect(await fits()).toEqual({
          high: true,
          exact: true,
          low: false,
          unknown: true,
        });
      });

      it("lists with the largest salary floor the column can hold", async () => {
        await insert("big", { salaryMaxCents: 2_147_483_647 });
        await insert("small", { salaryMaxCents: 100 });
        await prefer({ salaryFloorCents: 2_147_483_647 });

        expect(await fits()).toEqual({ big: true, small: false });
      });

      it("keeps fitting jobs first across pages", async () => {
        await insert("n1", {
          company: "Bad",
          postedAt: new Date("2026-05-01T00:00:00Z"),
        });
        await insert("n2", {
          company: "Bad",
          postedAt: new Date("2026-04-01T00:00:00Z"),
        });
        await insert("f1", { postedAt: new Date("2026-02-01T00:00:00Z") });
        await insert("f2", { postedAt: new Date("2026-01-01T00:00:00Z") });
        await prefer({ excludedCompanies: ["bad"] });

        expect(await titles(profileId, 1, 3)).toEqual(["f1", "f2", "n1"]);
        expect(await titles(profileId, 2, 3)).toEqual(["n2"]);
      });
    });
  });
});
