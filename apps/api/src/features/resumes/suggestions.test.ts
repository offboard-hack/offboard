import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { defaultOrgId, offboardingCases, resumeSuggestions, resumes } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";
import type { ResumeContent } from "./content.js";
import type { Criterion } from "./criteria.js";
import type { ScoredSuggestion } from "./score.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const identified = z.object({ id: z.uuid() });

const now = new Date("2026-11-24T15:30:00.250Z");

function content(bullet = "Liderou a migração") {
  return {
    headline: { id: "headline", text: "Engenheira de Software" },
    summary: { id: "summary", text: "Dez anos de backend." },
    experiences: [
      {
        id: "acme",
        company: "Acme",
        role: "Engenheira",
        start: "2019-03",
        end: null,
        bullets: [
          { id: "b1", text: bullet },
          { id: "b2", text: "Cuidou do faturamento" },
        ],
      },
    ],
    education: [],
    skills: [{ id: "skill", name: "TypeScript" }],
    languages: [],
    contact: { email: "ana@example.com", phone: null, city: null, links: [] },
  } satisfies ResumeContent;
}

function scored(
  targetNodeId: string,
  originalText: string,
  suggestedText: string,
  estimatedGain = 4,
  extraGainWithFacts = 0,
  criterion: Criterion = "results",
) {
  return {
    targetNodeId,
    originalText,
    suggestedText,
    rationale: "Mostra impacto.",
    criterion,
    estimatedGain,
    extraGainWithFacts,
  } satisfies ScoredSuggestion;
}

const migration = scored("b1", "Liderou a migração", "Liderou a migração de 12 serviços", 6, 5);

const headline = scored(
  "headline",
  "Engenheira de Software",
  "Engenheira Backend Sênior",
  3,
  0,
  "keywords",
);

function breakdownFor(score: number) {
  const points = Math.min(score, 10);

  return {
    results: { points, max: 20, reason: "Resultados." },
    keywords: { points: score - points, max: 90, reason: "Palavras-chave." },
  };
}

function result(score: number, suggestions: ScoredSuggestion[]) {
  return { score, breakdown: breakdownFor(score), suggestions };
}

describe.skipIf(!url)("resume suggestions repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.resumeSuggestions;
  let profileId: string;
  let otherProfileId: string;
  let resumeId: string;
  let otherResumeId: string;

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
    resumeId = (await repos.resumes.replaceBase(profileId, content(), "resumes/a.pdf")).resume.id;
    otherResumeId = (await repos.resumes.replaceBase(otherProfileId, content(), "resumes/b.pdf"))
      .resume.id;
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

  async function snapshot(id: string) {
    const [resume] = await db
      .select({
        content: resumes.content,
        score: resumes.score,
        scoreBreakdown: resumes.scoreBreakdown,
        scoredAt: resumes.scoredAt,
        updatedAt: resumes.updatedAt,
      })
      .from(resumes)
      .where(eq(resumes.id, id));

    const suggestions = await db
      .select({
        id: resumeSuggestions.id,
        targetNodeId: resumeSuggestions.targetNodeId,
        suggestedText: resumeSuggestions.suggestedText,
        criterion: resumeSuggestions.criterion,
        status: resumeSuggestions.status,
        createdAt: resumeSuggestions.createdAt,
        updatedAt: resumeSuggestions.updatedAt,
      })
      .from(resumeSuggestions)
      .where(eq(resumeSuggestions.resumeId, id))
      .orderBy(asc(resumeSuggestions.estimatedGain), asc(resumeSuggestions.targetNodeId));

    return { resume, suggestions };
  }

  async function scoreNow(id: string, suggestions: ScoredSuggestion[], score = 70) {
    const read = await repos.resumes.forScoring(id);

    if (!read) throw new Error("expected a résumé");

    expect(await repository.saveScore(id, read.updatedAt, result(score, suggestions), now)).toBe(
      true,
    );
  }

  async function openIds(id: string) {
    const rows = await db
      .select({ id: resumeSuggestions.id, targetNodeId: resumeSuggestions.targetNodeId })
      .from(resumeSuggestions)
      .where(eq(resumeSuggestions.resumeId, id));

    return Object.fromEntries(rows.map((row) => [row.targetNodeId, row.id]));
  }

  async function markStatus(id: string, status: "applied" | "dismissed") {
    await db.update(resumeSuggestions).set({ status }).where(eq(resumeSuggestions.id, id));
  }

  describe("saveScore", () => {
    it("discards a score computed for stale content", async () => {
      await db.execute(
        sql`update resumes set updated_at = '2026-01-01 00:00:00' where id = ${resumeId}`,
      );

      const read = await repos.resumes.forScoring(resumeId);

      if (!read) throw new Error("expected a résumé");

      await repos.resumes.updateBaseContent(profileId, content("Editado pela pessoa"));

      const before = await snapshot(resumeId);

      expect(
        await repository.saveScore(resumeId, read.updatedAt, result(90, [migration]), now),
      ).toBe(false);
      expect(await snapshot(resumeId)).toEqual(before);
      expect(before.resume).toMatchObject({ score: null, scoreBreakdown: null, scoredAt: null });
      expect(before.suggestions).toEqual([]);
    });

    it("matches a stored timestamp to the millisecond", async () => {
      await db.execute(
        sql`update resumes set updated_at = '2026-11-24 12:00:00.123456' where id = ${resumeId}`,
      );

      const read = await repos.resumes.forScoring(resumeId);

      expect(read?.updatedAt.toISOString()).toBe("2026-11-24T12:00:00.123Z");

      const scoredResult = result(64, [migration]);

      expect(
        await repository.saveScore(
          resumeId,
          new Date("2026-11-24T12:00:00.124Z"),
          scoredResult,
          now,
        ),
      ).toBe(false);
      expect(
        await repository.saveScore(
          resumeId,
          new Date("2026-11-24T12:00:00.122Z"),
          scoredResult,
          now,
        ),
      ).toBe(false);
      expect((await snapshot(resumeId)).resume.score).toBeNull();
      expect(
        await repository.saveScore(
          resumeId,
          new Date("2026-11-24T12:00:00.123Z"),
          scoredResult,
          now,
        ),
      ).toBe(true);
      expect((await snapshot(resumeId)).resume).toMatchObject({
        score: 64,
        scoreBreakdown: breakdownFor(64),
        scoredAt: now,
      });
    });

    it("compares against the creation time when the résumé was never updated", async () => {
      await db.execute(
        sql`update resumes set created_at = '2026-11-20 08:00:00.5', updated_at = null where id = ${resumeId}`,
      );

      const read = await repos.resumes.forScoring(resumeId);

      expect(read?.updatedAt.toISOString()).toBe("2026-11-20T08:00:00.500Z");
      expect(
        await repository.saveScore(
          resumeId,
          new Date("2026-11-20T08:00:00.500Z"),
          result(55, []),
          now,
        ),
      ).toBe(true);
    });

    it("replaces open suggestions and keeps applied and dismissed ones", async () => {
      await scoreNow(resumeId, [
        scored("b1", "Liderou a migração", "Velha 1", 1),
        scored("b2", "Cuidou do faturamento", "Velha 2", 2),
        scored("summary", "Dez anos de backend.", "Velha 3", 5),
      ]);

      const old = await openIds(resumeId);

      await markStatus(old.b1 ?? "", "applied");
      await markStatus(old.b2 ?? "", "dismissed");

      const before = await snapshot(resumeId);
      const later = new Date(now.getTime() + 60_000);
      const read = await repos.resumes.forScoring(resumeId);

      if (!read) throw new Error("expected a résumé");

      expect(
        await repository.saveScore(
          resumeId,
          read.updatedAt,
          result(83, [migration, headline]),
          later,
        ),
      ).toBe(true);

      const after = await snapshot(resumeId);

      expect(after.resume).toEqual({
        ...before.resume,
        score: 83,
        scoreBreakdown: breakdownFor(83),
        scoredAt: later,
      });
      expect(after.suggestions).toEqual([
        expect.objectContaining({
          targetNodeId: "b1",
          suggestedText: "Velha 1",
          status: "applied",
        }),
        expect.objectContaining({
          targetNodeId: "b2",
          suggestedText: "Velha 2",
          status: "dismissed",
        }),
        {
          id: expect.any(String),
          targetNodeId: "headline",
          suggestedText: "Engenheira Backend Sênior",
          criterion: "keywords",
          status: "open",
          createdAt: later,
          updatedAt: later,
        },
        expect.objectContaining({ targetNodeId: "b1", suggestedText: migration.suggestedText }),
      ]);
      expect(after.suggestions.map((item) => item.id)).not.toContain(old.summary);
    });

    it("does not resurface a dismissed suggestion for the same text", async () => {
      await scoreNow(resumeId, [migration, scored("b2", "Texto antigo", "Velha 2", 1)]);

      const old = await openIds(resumeId);

      await markStatus(old.b1 ?? "", "dismissed");
      await markStatus(old.b2 ?? "", "dismissed");
      await scoreNow(resumeId, [
        scored("b1", "Liderou a migração", "Outra versão da migração", 8),
        scored("b2", "Cuidou do faturamento", "Faturamento mensal", 2),
        headline,
      ]);

      expect((await snapshot(resumeId)).suggestions).toEqual([
        expect.objectContaining({ targetNodeId: "b2", status: "dismissed" }),
        expect.objectContaining({
          targetNodeId: "b2",
          suggestedText: "Faturamento mensal",
          status: "open",
        }),
        expect.objectContaining({ targetNodeId: "headline", status: "open" }),
        expect.objectContaining({ targetNodeId: "b1", status: "dismissed" }),
      ]);

      await scoreNow(resumeId, [scored("b1", "Liderou a migração", "De novo", 5)], 88);

      expect((await snapshot(resumeId)).suggestions).toEqual([
        expect.objectContaining({ targetNodeId: "b2", status: "dismissed" }),
        expect.objectContaining({ targetNodeId: "b1", status: "dismissed" }),
      ]);
      expect((await snapshot(resumeId)).resume.score).toBe(88);
    });

    it("clears open suggestions when the new score has none", async () => {
      await scoreNow(resumeId, [migration]);
      await scoreNow(resumeId, [], 91);

      expect(await snapshot(resumeId)).toMatchObject({ resume: { score: 91 }, suggestions: [] });
    });

    it("writes nothing for an unknown résumé", async () => {
      expect(
        await repository.saveScore(crypto.randomUUID(), now, result(50, [migration]), now),
      ).toBe(false);
      expect(await db.select().from(resumeSuggestions)).toEqual([]);
    });
  });

  describe("listOpen", () => {
    it("lists open suggestions of the base résumé, highest gain first", async () => {
      await scoreNow(resumeId, [
        scored("b2", "Cuidou do faturamento", "Faturamento", 2),
        migration,
        headline,
        scored("summary", "Dez anos de backend.", "Resumo", 9),
      ]);
      await scoreNow(otherResumeId, [scored("b2", "Cuidou do faturamento", "Outra", 20)]);

      const ids = await openIds(resumeId);

      await markStatus(ids.summary ?? "", "dismissed");

      expect(await repository.listOpen(profileId)).toEqual([
        {
          id: ids.b1,
          targetNodeId: "b1",
          originalText: "Liderou a migração",
          suggestedText: "Liderou a migração de 12 serviços",
          rationale: "Mostra impacto.",
          criterion: "results",
          estimatedGain: 6,
          extraGainWithFacts: 5,
        },
        expect.objectContaining({
          id: ids.headline,
          criterion: "keywords",
          extraGainWithFacts: 0,
          estimatedGain: 3,
        }),
        expect.objectContaining({ id: ids.b2, estimatedGain: 2 }),
      ]);
    });

    it("breaks gain ties by creation time, then by id", async () => {
      const [low, high] = [crypto.randomUUID(), crypto.randomUUID()].sort();
      const earlier = new Date(now.getTime() - 1_000);

      await db.insert(resumeSuggestions).values([
        { ...migration, id: high, resumeId, estimatedGain: 5, createdAt: now },
        { ...headline, id: crypto.randomUUID(), resumeId, estimatedGain: 5, createdAt: earlier },
        { ...migration, id: low, resumeId, estimatedGain: 5, createdAt: now },
      ]);

      expect((await repository.listOpen(profileId)).map((item) => item.id)).toEqual([
        expect.any(String),
        low,
        high,
      ]);
      expect((await repository.listOpen(profileId))[0]?.targetNodeId).toBe("headline");
    });

    it("hides suggestions whose target text no longer matches, keeping the rows", async () => {
      await scoreNow(resumeId, [migration, headline]);

      await repos.resumes.updateBaseContent(profileId, content("Editado pela pessoa"));

      const ids = await openIds(resumeId);

      expect((await repository.listOpen(profileId)).map((item) => item.id)).toEqual([ids.headline]);

      await repos.resumes.replaceBase(
        profileId,
        {
          ...content(),
          headline: { id: "new-headline", text: "Engenheira de Software" },
          summary: { id: "new-summary", text: "Dez anos de backend." },
          experiences: [],
        },
        "resumes/c.pdf",
      );

      expect(await repository.listOpen(profileId)).toEqual([]);
      expect((await snapshot(resumeId)).suggestions).toEqual([
        expect.objectContaining({ targetNodeId: "headline", status: "open" }),
        expect.objectContaining({ targetNodeId: "b1", status: "open" }),
      ]);
    });

    it("is empty for a profile without a base résumé", async () => {
      await db.delete(resumes).where(eq(resumes.id, otherResumeId));

      expect(await repository.listOpen(otherProfileId)).toEqual([]);
    });
  });

  describe("apply", () => {
    it("writes the suggested text, adds its gain to the score and asks for a rescore", async () => {
      await scoreNow(resumeId, [migration, headline]);

      const ids = await openIds(resumeId);
      const later = new Date(now.getTime() + 5_000);

      const view = await repository.apply(profileId, ids.b1 ?? "", later);

      const expected = content("Liderou a migração de 12 serviços");

      expect(view).toEqual({
        id: resumeId,
        kind: "base",
        content: expected,
        score: 76,
        scoreBreakdown: {
          results: { points: 16, max: 20, reason: "Resultados." },
          keywords: { points: 60, max: 90, reason: "Palavras-chave." },
        },
        scoredAt: now.toISOString(),
        rescoring: false,
        updatedAt: later.toISOString(),
      });
      expect(await repos.resumes.getBase(profileId)).toEqual(view);

      const { suggestions } = await snapshot(resumeId);

      expect(suggestions).toEqual([
        expect.objectContaining({ targetNodeId: "headline", status: "open", updatedAt: now }),
        expect.objectContaining({ targetNodeId: "b1", status: "applied", updatedAt: later }),
      ]);
      expect(await repository.apply(profileId, ids.b1 ?? "", later)).toBe("not_found");
    });

    it("caps the provisional gain at its criterion maximum", async () => {
      await scoreNow(resumeId, [migration, headline], 50);
      await db
        .update(resumes)
        .set({
          score: 47,
          scoreBreakdown: {
            results: { points: 17, max: 20, reason: "Quase todos." },
            keywords: { points: 30, max: 80, reason: "Algumas." },
          },
        })
        .where(eq(resumes.id, resumeId));

      const ids = await openIds(resumeId);

      expect(await repository.apply(profileId, ids.b1 ?? "", now)).toMatchObject({
        score: 50,
        scoreBreakdown: { results: { points: 20, max: 20, reason: "Quase todos." } },
        scoredAt: now.toISOString(),
      });
      expect(await repository.apply(profileId, ids.headline ?? "", now)).toMatchObject({
        score: 53,
        scoreBreakdown: { results: { points: 20 }, keywords: { points: 33, max: 80 } },
      });
    });

    it("adds the gain to the total for a score or suggestion without criteria", async () => {
      await scoreNow(resumeId, [migration, headline], 70);
      await db
        .update(resumes)
        .set({ scoreBreakdown: null, score: 97 })
        .where(eq(resumes.id, resumeId));

      const ids = await openIds(resumeId);

      expect(await repository.apply(profileId, ids.headline ?? "", now)).toMatchObject({
        score: 100,
        scoreBreakdown: null,
        scoredAt: now.toISOString(),
      });

      await db.update(resumes).set({ score: null }).where(eq(resumes.id, resumeId));

      expect(await repository.apply(profileId, ids.b1 ?? "", now)).toMatchObject({
        score: null,
        scoreBreakdown: null,
      });
    });

    it("applies headline and summary rewrites", async () => {
      await scoreNow(resumeId, [headline, scored("summary", "Dez anos de backend.", "Resumo")]);

      const ids = await openIds(resumeId);

      await repository.apply(profileId, ids.headline ?? "", now);

      const view = await repository.apply(profileId, ids.summary ?? "", now);

      expect(view).toMatchObject({
        content: {
          headline: { id: "headline", text: "Engenheira Backend Sênior" },
          summary: { id: "summary", text: "Resumo" },
        },
      });
    });

    it("rejects applying a stale suggestion", async () => {
      await scoreNow(resumeId, [migration]);
      await repos.resumes.updateBaseContent(profileId, content("Editado pela pessoa"));

      const ids = await openIds(resumeId);
      const before = await snapshot(resumeId);

      expect(await repository.apply(profileId, ids.b1 ?? "", now)).toBe("stale");
      expect(await snapshot(resumeId)).toEqual(before);
      expect(before.suggestions).toEqual([expect.objectContaining({ status: "open" })]);
    });

    it("rejects a suggestion whose node was removed", async () => {
      await scoreNow(resumeId, [migration]);

      const edited = content();

      await repos.resumes.updateBaseContent(profileId, {
        ...edited,
        experiences: [{ ...edited.experiences[0], bullets: [edited.experiences[0].bullets[1]] }],
      });

      const ids = await openIds(resumeId);
      const before = await snapshot(resumeId);

      expect(await repository.apply(profileId, ids.b1 ?? "", now)).toBe("stale");
      expect(await snapshot(resumeId)).toEqual(before);
    });

    it("does not apply another profile's suggestion", async () => {
      await scoreNow(otherResumeId, [migration]);

      const ids = await openIds(otherResumeId);
      const mine = await snapshot(resumeId);
      const theirs = await snapshot(otherResumeId);

      expect(await repository.apply(profileId, ids.b1 ?? "", now)).toBe("not_found");
      expect(await repository.dismiss(profileId, ids.b1 ?? "")).toBe(false);
      expect(await snapshot(resumeId)).toEqual(mine);
      expect(await snapshot(otherResumeId)).toEqual(theirs);
    });

    it("does not apply a dismissed suggestion", async () => {
      await scoreNow(resumeId, [migration]);

      const ids = await openIds(resumeId);

      await markStatus(ids.b1 ?? "", "dismissed");

      expect(await repository.apply(profileId, ids.b1 ?? "", now)).toBe("not_found");
      expect((await snapshot(resumeId)).resume.content).toEqual(content());
    });

    it("finds nothing for a profile without a base résumé", async () => {
      await scoreNow(resumeId, [migration]);
      await db.delete(resumes).where(eq(resumes.id, otherResumeId));

      const ids = await openIds(resumeId);

      expect(await repository.apply(otherProfileId, ids.b1 ?? "", now)).toBe("not_found");
    });
  });

  describe("history", () => {
    it("lists applied and dismissed suggestions of the résumé, latest first", async () => {
      await scoreNow(resumeId, [
        migration,
        headline,
        scored("b2", "Cuidou do faturamento", "Faturamento mensal", 2, 0, "clarity"),
        scored("summary", "Dez anos de backend.", "Resumo", 2, 0, "summary"),
      ]);
      await scoreNow(otherResumeId, [migration]);

      const ids = await openIds(resumeId);
      const theirs = await openIds(otherResumeId);

      await db
        .update(resumeSuggestions)
        .set({ status: "dismissed", updatedAt: new Date(now.getTime() + 1_000) })
        .where(eq(resumeSuggestions.id, ids.b2 ?? ""));
      await repository.apply(profileId, ids.b1 ?? "", new Date(now.getTime() + 2_000));
      await markStatus(theirs.b1 ?? "", "applied");
      await db
        .update(resumeSuggestions)
        .set({ criterion: null })
        .where(eq(resumeSuggestions.id, ids.b1 ?? ""));

      expect(await repository.history(resumeId)).toEqual([
        {
          targetNodeId: "b1",
          originalText: "Liderou a migração",
          suggestedText: "Liderou a migração de 12 serviços",
          criterion: null,
          status: "applied",
        },
        {
          targetNodeId: "b2",
          originalText: "Cuidou do faturamento",
          suggestedText: "Faturamento mensal",
          criterion: "clarity",
          status: "dismissed",
        },
      ]);
    });

    it("keeps only the twenty latest", async () => {
      await db.insert(resumeSuggestions).values(
        Array.from({ length: 25 }, (_, index) => ({
          ...scored("b1", "Liderou a migração", `Versão ${index}`),
          resumeId,
          status: "dismissed" as const,
          updatedAt: new Date(now.getTime() + index * 1_000),
        })),
      );

      const history = await repository.history(resumeId);

      expect(history).toHaveLength(20);
      expect(history[0]?.suggestedText).toBe("Versão 24");
      expect(history[19]?.suggestedText).toBe("Versão 5");
    });
  });

  describe("dismiss", () => {
    it("dismisses an open suggestion once", async () => {
      await scoreNow(resumeId, [migration, headline]);

      const ids = await openIds(resumeId);

      expect(await repository.dismiss(profileId, ids.b1 ?? "")).toBe(true);
      expect(await repository.dismiss(profileId, ids.b1 ?? "")).toBe(false);
      expect((await snapshot(resumeId)).suggestions).toEqual([
        expect.objectContaining({ targetNodeId: "headline", status: "open" }),
        expect.objectContaining({ targetNodeId: "b1", status: "dismissed" }),
      ]);
      expect((await repository.listOpen(profileId)).map((item) => item.id)).toEqual([ids.headline]);
    });
  });
});
