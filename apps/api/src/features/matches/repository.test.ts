import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  jobMatches,
  jobs,
  offboardingCases,
  resumes,
  type ResumeContent,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";
import { searchTerms, toTsQuery } from "./terms.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const identified = z.object({ id: z.uuid() });

const content: ResumeContent = {
  headline: { id: "headline", text: "Engenheira de Software" },
  summary: { id: "summary", text: "Backend com TypeScript." },
  experiences: [],
  education: [],
  skills: [{ id: "skill", name: "TypeScript" }],
  languages: [],
  contact: { email: "ana@example.com", phone: null, city: null, links: [] },
};

describe.skipIf(!url)("matches repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.matches;
  let profileId: string;
  let otherProfileId: string;

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);

    const [first, second] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    profileId = await enable(first.id, "pessoa@exemplo.com");
    otherProfileId = await enable(second.id, "outra@exemplo.com");
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function enable(caseId: string, personalEmail: string) {
    const profile = await repos.talent.enable({
      caseId,
      personalEmail,
      sponsoredUntil: "2026-12-31",
    });

    return identified.parse(profile).id;
  }

  async function job(sourceKey: string, values: Partial<typeof jobs.$inferInsert> = {}) {
    const [row] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "seed",
        sourceKey,
        title: sourceKey,
        company: "Acme",
        url: `https://jobs.example.com/${sourceKey}`,
        ...values,
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  async function base(id: string, values: Partial<typeof resumes.$inferInsert> = {}) {
    await db.insert(resumes).values({ profileId: id, kind: "base", content, ...values });
  }

  function storedMatches() {
    return db
      .select({
        profileId: jobMatches.profileId,
        jobId: jobMatches.jobId,
        score: jobMatches.score,
        reasons: jobMatches.reasons,
        resumeUpdatedAt: jobMatches.resumeUpdatedAt,
        computedAt: jobMatches.computedAt,
      })
      .from(jobMatches)
      .orderBy(asc(jobMatches.score));
  }

  it("reads the base résumé with its version", async () => {
    expect(await repository.baseResume(profileId)).toBeUndefined();

    const updatedAt = new Date("2026-11-20T10:00:00.123Z");

    await base(profileId, { updatedAt });

    expect(await repository.baseResume(profileId)).toEqual({ content, version: updatedAt });

    const createdAt = new Date("2026-11-19T08:00:00.456Z");

    await db
      .update(resumes)
      .set({ updatedAt: null, createdAt })
      .where(eq(resumes.profileId, profileId));

    expect(await repository.baseResume(profileId)).toEqual({ content, version: createdAt });
    expect(await repository.baseResume(otherProfileId)).toBeUndefined();
  });

  it("saves matches for a résumé stored with database timestamps", async () => {
    const jobId = await job("vaga");

    await base(profileId);

    const current = await repository.baseResume(profileId);

    if (!current) throw new Error("expected a base résumé");

    const now = new Date("2026-11-24T12:00:00.000Z");

    expect(
      await repository.saveMatches(
        profileId,
        current.version,
        [{ jobId, score: 80, reasons: ["Boa"] }],
        now,
      ),
    ).toBe(true);
    expect(await storedMatches()).toEqual([
      {
        profileId,
        jobId,
        score: 80,
        reasons: ["Boa"],
        resumeUpdatedAt: current.version,
        computedAt: now,
      },
    ]);
    expect(await repository.freshJobIds(profileId, current.version)).toEqual(new Set([jobId]));
  });

  it("discards matches for a stale résumé version", async () => {
    const jobId = await job("vaga");
    const version = new Date("2026-11-20T10:00:00.000Z");

    await base(profileId, { updatedAt: new Date(version.getTime() + 1) });

    expect(
      await repository.saveMatches(
        profileId,
        version,
        [{ jobId, score: 80, reasons: [] }],
        new Date(),
      ),
    ).toBe(false);
    expect(await storedMatches()).toEqual([]);
    expect(
      await repository.saveMatches(
        otherProfileId,
        version,
        [{ jobId, score: 80, reasons: [] }],
        new Date(),
      ),
    ).toBe(false);
    expect(await storedMatches()).toEqual([]);
    expect(await repository.saveMatches(profileId, version, [], new Date())).toBe(true);
  });

  it("replaces an older match with the newer score", async () => {
    const first = await job("primeira");
    const second = await job("segunda");
    const old = new Date("2026-11-20T10:00:00.000Z");
    const version = new Date("2026-11-21T10:00:00.000Z");
    const now = new Date("2026-11-24T12:00:00.000Z");

    await base(profileId, { updatedAt: old });
    await repository.saveMatches(
      profileId,
      old,
      [{ jobId: first, score: 10, reasons: ["Antiga"] }],
      old,
    );
    await db.update(resumes).set({ updatedAt: version }).where(eq(resumes.profileId, profileId));

    expect(
      await repository.saveMatches(
        profileId,
        version,
        [
          { jobId: first, score: 90, reasons: ["Nova"] },
          { jobId: second, score: 40, reasons: [] },
        ],
        now,
      ),
    ).toBe(true);
    expect(await storedMatches()).toEqual([
      {
        profileId,
        jobId: second,
        score: 40,
        reasons: [],
        resumeUpdatedAt: version,
        computedAt: now,
      },
      {
        profileId,
        jobId: first,
        score: 90,
        reasons: ["Nova"],
        resumeUpdatedAt: version,
        computedAt: now,
      },
    ]);
  });

  it("returns only this profile's matches for the current version as fresh", async () => {
    const fresh = await job("fresca");
    const stale = await job("antiga");
    const foreign = await job("outra");
    const version = new Date("2026-11-21T10:00:00.000Z");
    const old = new Date("2026-11-20T10:00:00.000Z");
    const row = { score: 50, reasons: [], computedAt: version };

    await db.insert(jobMatches).values([
      { ...row, profileId, jobId: fresh, resumeUpdatedAt: version },
      { ...row, profileId, jobId: stale, resumeUpdatedAt: old },
      { ...row, profileId: otherProfileId, jobId: foreign, resumeUpdatedAt: version },
    ]);

    expect(await repository.freshJobIds(profileId, version)).toEqual(new Set([fresh]));
    expect(await repository.freshJobIds(otherProfileId, old)).toEqual(new Set());
  });

  it("lists profiles that have a base résumé", async () => {
    expect(await repository.profilesWithBaseResume()).toEqual([]);

    await base(otherProfileId);

    expect(await repository.profilesWithBaseResume()).toEqual([otherProfileId]);
  });

  describe("candidates", () => {
    const older = new Date("2026-11-01T00:00:00.000Z");
    const newer = new Date("2026-11-10T00:00:00.000Z");

    async function catalog() {
      return {
        exact: await job("exata", {
          title: "Engenheira de Software TypeScript",
          description: "Vaga para engenheira com TypeScript e Node.",
          postedAt: older,
          createdAt: older,
        }),
        partial: await job("parcial", {
          title: "Desenvolvedora Backend",
          description: "Usamos TypeScript.",
          postedAt: older,
          createdAt: older,
        }),
        unrelated: await job("financeiro", {
          title: "Analista Financeiro",
          description: "Planilhas e contas.",
          postedAt: newer,
          createdAt: newer,
        }),
        undated: await job("sem-data", {
          title: "Motorista",
          description: "Entregas.",
          postedAt: null,
        }),
        closed: await job("fechada", {
          title: "Engenheira TypeScript",
          description: "TypeScript TypeScript engenheira",
          postedAt: newer,
          closedAt: newer,
        }),
      };
    }

    it("ranks jobs matching the résumé first, then the newest open jobs", async () => {
      const ids = await catalog();

      const query = toTsQuery(["engenheira", "typescript"]);

      expect((await repository.candidates(query, 30)).map((item) => item.id)).toEqual([
        ids.exact,
        ids.partial,
        ids.unrelated,
        ids.undated,
      ]);
      expect(await repository.candidates(query, 1)).toEqual([
        {
          id: ids.exact,
          title: "Engenheira de Software TypeScript",
          company: "Acme",
          workModel: null,
          city: null,
          state: null,
          description: "Vaga para engenheira com TypeScript e Node.",
        },
      ]);
      expect((await repository.candidates(query, 3)).map((item) => item.id)).toEqual([
        ids.exact,
        ids.partial,
        ids.unrelated,
      ]);
    });

    it("falls back to the newest open jobs without terms", async () => {
      const ids = await catalog();
      const tied = await job("empatada", { postedAt: newer, createdAt: older });

      expect((await repository.candidates(null, 30)).map((item) => item.id)).toEqual([
        ids.unrelated,
        tied,
        ...[ids.exact, ids.partial].sort(),
        ids.undated,
      ]);
      expect((await repository.candidates(null, 2)).map((item) => item.id)).toEqual([
        ids.unrelated,
        tied,
      ]);
    });

    it("builds safe search terms that run in Postgres", async () => {
      const ids = await catalog();

      const query = toTsQuery(
        searchTerms({
          ...content,
          headline: { id: "headline", text: "C++ O'Reilly &|!:* (a|b) 'x' \\ \" <-> ½ Ⅻ ²" },
          summary: { id: "summary", text: "engenheira:* & !typescript" },
        }),
      );

      expect(query).not.toBeNull();
      expect((await repository.candidates(query, 30))[0]?.id).toBe(ids.exact);
      expect(
        (await repository.candidates(toTsQuery(["para", "com", "que"]), 30)).map((item) => item.id),
      ).toEqual((await repository.candidates(null, 30)).map((item) => item.id));
    });
  });
});
