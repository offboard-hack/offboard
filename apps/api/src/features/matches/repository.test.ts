import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  type ResumeContent,
  defaultOrgId,
  employeeAccess,
  jobMatches,
  jobRejections,
  jobs,
  offboardingCases,
  resumes,
  talentPreferences,
  talentProfiles,
  talentSubscriptions,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { emptyEmployeePlan } from "@offboard/employee";
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
      orgId: defaultOrgId,
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

  it("lists profiles to match: a base résumé, terms accepted and still sponsored", async () => {
    const lastDay = new Date("2027-01-01T02:59:59.999Z");
    const lapsed = new Date("2027-01-01T03:00:00.000Z");

    expect(await repository.profilesForMatching(lastDay)).toEqual([]);

    await base(profileId);
    await base(otherProfileId);

    expect(await repository.profilesForMatching(lastDay)).toEqual([]);

    await repos.talent.acceptTerms(otherProfileId);

    expect(await repository.profilesForMatching(lastDay)).toEqual([
      { profileId: otherProfileId, orgId: defaultOrgId, collaborator: false, individual: false },
    ]);
    expect(await repository.profilesForMatching(lapsed)).toEqual([]);

    await repos.talent.acceptTerms(profileId);
    await db.delete(resumes).where(eq(resumes.profileId, otherProfileId));

    expect(await repository.profilesForMatching(lastDay)).toEqual([
      { profileId, orgId: defaultOrgId, collaborator: false, individual: false },
    ]);
  });

  it("keeps matching collaborators whose case still has a grant", async () => {
    const lapsed = new Date("2027-01-01T03:00:00.000Z");

    const [profile] = await db
      .select()
      .from(talentProfiles)
      .where(eq(talentProfiles.id, profileId));

    await base(profileId);
    await repos.talent.acceptTerms(profileId);
    await db.insert(employeeAccess).values({
      caseId: profile.caseId ?? "",
      orgId: defaultOrgId,
      email: "colaboradora@exemplo.com",
      plan: emptyEmployeePlan,
    });

    expect(await repository.profilesForMatching(lapsed)).toEqual([
      { profileId, orgId: defaultOrgId, collaborator: true, individual: false },
    ]);

    await db.update(employeeAccess).set({ email: null });

    expect(await repository.profilesForMatching(lapsed)).toEqual([]);
  });

  it("keeps matching a person with an active Carreira Pro after the sponsorship lapses", async () => {
    const lapsed = new Date("2027-01-01T03:00:00.000Z");

    await base(profileId);
    await repos.talent.acceptTerms(profileId);
    await db.insert(talentSubscriptions).values({
      profileId,
      status: "active",
      currentPeriodEnd: "2027-01-01",
      createdAt: lapsed,
      updatedAt: lapsed,
    });

    expect(await repository.profilesForMatching(lapsed)).toEqual([
      { profileId, orgId: defaultOrgId, collaborator: false, individual: true },
    ]);

    await db.update(talentSubscriptions).set({ currentPeriodEnd: null });

    expect(await repository.profilesForMatching(lapsed)).toHaveLength(1);

    await db.update(talentSubscriptions).set({ currentPeriodEnd: "2026-12-31" });

    expect(await repository.profilesForMatching(lapsed)).toEqual([]);

    await db.update(talentSubscriptions).set({ status: "past_due", currentPeriodEnd: null });

    expect(await repository.profilesForMatching(lapsed)).toEqual([]);
  });

  it("reads the target titles with defaults", async () => {
    expect(await repository.targetTitles(profileId)).toEqual([]);

    await db.insert(talentPreferences).values({ profileId, targetTitles: ["Backend", "SRE"] });

    expect(await repository.targetTitles(profileId)).toEqual(["Backend", "SRE"]);
    expect(await repository.targetTitles(otherProfileId)).toEqual([]);
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

      expect((await repository.candidates(profileId, query, 30)).map((item) => item.id)).toEqual([
        ids.exact,
        ids.partial,
        ids.unrelated,
        ids.undated,
      ]);
      expect(await repository.candidates(profileId, query, 1)).toEqual([
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
      expect((await repository.candidates(profileId, query, 3)).map((item) => item.id)).toEqual([
        ids.exact,
        ids.partial,
        ids.unrelated,
      ]);
    });

    it("skips jobs this profile rejected on both queries and still fills the limit", async () => {
      const ids = await catalog();

      await db.insert(jobRejections).values([
        { profileId, jobId: ids.exact, reason: "salary" },
        { profileId, jobId: ids.unrelated, reason: "other" },
        { profileId: otherProfileId, jobId: ids.partial, reason: "other" },
      ]);

      const query = toTsQuery(["engenheira", "typescript"]);

      expect((await repository.candidates(profileId, query, 30)).map((item) => item.id)).toEqual([
        ids.partial,
        ids.undated,
      ]);
      expect((await repository.candidates(profileId, query, 2)).map((item) => item.id)).toEqual([
        ids.partial,
        ids.undated,
      ]);
      expect((await repository.candidates(profileId, null, 30)).map((item) => item.id)).toEqual([
        ids.partial,
        ids.undated,
      ]);
      expect(
        (await repository.candidates(otherProfileId, null, 30)).map((item) => item.id),
      ).toContain(ids.exact);
    });

    it("falls back to the newest open jobs without terms", async () => {
      const ids = await catalog();
      const tied = await job("empatada", { postedAt: newer, createdAt: older });

      expect((await repository.candidates(profileId, null, 30)).map((item) => item.id)).toEqual([
        ids.unrelated,
        tied,
        ...[ids.exact, ids.partial].sort(),
        ids.undated,
      ]);
      expect((await repository.candidates(profileId, null, 2)).map((item) => item.id)).toEqual([
        ids.unrelated,
        tied,
      ]);
    });

    it("builds safe search terms that run in Postgres", async () => {
      const ids = await catalog();

      const query = toTsQuery(
        searchTerms(
          {
            ...content,
            headline: { id: "headline", text: "C++ O'Reilly &|!:* (a|b) 'x' \\ \" <-> ½ Ⅻ ²" },
            summary: { id: "summary", text: "engenheira:* & !typescript" },
          },
          [],
        ),
      );

      expect(query).not.toBeNull();
      expect((await repository.candidates(profileId, query, 30))[0]?.id).toBe(ids.exact);
      expect(
        (await repository.candidates(profileId, toTsQuery(["para", "com", "que"]), 30)).map(
          (item) => item.id,
        ),
      ).toEqual((await repository.candidates(profileId, null, 30)).map((item) => item.id));
    });
  });

  describe("embeddings", () => {
    const vectorAt = (offset: number) =>
      Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : index === 1 ? offset : 0));

    it("orders open embedded jobs by cosine distance, honoring rejections", async () => {
      const far = await job("far", { embedding: vectorAt(5) });
      const near = await job("near", { embedding: vectorAt(1) });
      const middle = await job("middle", { embedding: vectorAt(2) });
      const closed = await job("closed", { embedding: vectorAt(0), closedAt: new Date() });
      const rejected = await job("rejected", { embedding: vectorAt(0) });

      await job("unembedded");
      await db.insert(jobRejections).values({ profileId, jobId: rejected, reason: "other" });

      const ids = async (limit: number, embedding = vectorAt(0)) =>
        (await repository.nearestCandidates(profileId, embedding, limit)).map((item) => item.id);

      expect(await ids(10)).toEqual([near, middle, far]);
      expect(await ids(2)).toEqual([near, middle]);
      expect(await ids(10, vectorAt(5))).toEqual([far, middle, near]);
      expect(await ids(10)).not.toContain(closed);
      expect(
        (await repository.nearestCandidates(otherProfileId, vectorAt(0), 10)).map(
          (item) => item.id,
        ),
      ).toContain(rejected);
    });

    it("returns the same columns as text-search candidates", async () => {
      const id = await job("vaga", {
        embedding: vectorAt(0),
        city: "Recife",
        state: "PE",
        description: "Descrição",
      });

      const [nearest] = await repository.nearestCandidates(profileId, vectorAt(0), 1);
      const [text] = await repository.candidates(profileId, null, 1);

      expect(nearest).toEqual(text);
      expect(nearest.id).toBe(id);
    });

    it("keeps the résumé embedding only for the version it was made from", async () => {
      const version = new Date("2026-11-20T10:00:00.123Z");

      await base(profileId, { updatedAt: version });

      expect(await repository.resumeEmbedding(profileId, version)).toBeNull();

      await repository.saveResumeEmbedding(profileId, version, vectorAt(3));

      expect(await repository.resumeEmbedding(profileId, version)).toEqual(vectorAt(3));
      expect(
        await repository.resumeEmbedding(profileId, new Date(version.getTime() + 1)),
      ).toBeNull();
      expect(await repository.resumeEmbedding(otherProfileId, version)).toBeNull();
      expect(await repository.baseResume(profileId)).toEqual({ content, version });
    });

    it("lists open jobs without an embedding, newest first, and stores their embeddings", async () => {
      const older = await job("older", { postedAt: new Date("2026-11-01T00:00:00Z") });
      const newer = await job("newer", { postedAt: new Date("2026-11-02T00:00:00Z") });

      await job("closed", { closedAt: new Date() });
      await job("done", { embedding: vectorAt(0) });

      expect((await repository.jobsToEmbed(10)).map((item) => item.id)).toEqual([newer, older]);
      expect(await repository.jobsToEmbed(1)).toMatchObject([{ id: newer, title: "newer" }]);

      const now = new Date("2026-11-26T12:00:00.000Z");

      await repository.saveJobEmbeddings([{ id: newer, embedding: vectorAt(4) }], now);

      expect((await repository.jobsToEmbed(10)).map((item) => item.id)).toEqual([older]);

      const [stored] = await db
        .select({ embedding: jobs.embedding, embeddedAt: jobs.embeddedAt })
        .from(jobs)
        .where(eq(jobs.id, newer));

      expect(stored).toEqual({ embedding: vectorAt(4), embeddedAt: now });
    });
  });
});
