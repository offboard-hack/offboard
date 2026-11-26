import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { defaultOrgId, offboardingCases, resumes } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";
import type { ResumeContent } from "./content.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const identified = z.object({ id: z.uuid() });

function content(headline: string) {
  return {
    headline: { id: "headline", text: headline },
    summary: { id: "summary", text: "Dez anos de backend." },
    experiences: [],
    education: [],
    skills: [{ id: "skill", name: "TypeScript" }],
    languages: [],
    contact: { email: "ana@example.com", phone: null, city: null, links: [] },
  } satisfies ResumeContent;
}

describe.skipIf(!url)("resumes repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.resumes;
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

  const breakdown = { results: { points: 12, max: 20, reason: "Alguns números." } };

  function score(id: string, value: number, scoreBreakdown: typeof breakdown | null = breakdown) {
    return db
      .update(resumes)
      .set({ score: value, scoreBreakdown, scoredAt: new Date() })
      .where(eq(resumes.id, id));
  }

  it("has no base résumé until one is stored", async () => {
    expect(await repository.getBase(profileId)).toBeUndefined();
  });

  it("creates then replaces the base keeping its id", async () => {
    const first = await repository.replaceBase(profileId, content("Primeira"), "resumes/a.pdf");

    expect(first.previousFileKey).toBeNull();
    expect(first.resume).toMatchObject({
      kind: "base",
      content: content("Primeira"),
      score: null,
      scoreBreakdown: null,
      scoredAt: null,
    });
    expect(new Date(first.resume.updatedAt).toISOString()).toBe(first.resume.updatedAt);

    const second = await repository.replaceBase(profileId, content("Segunda"), "resumes/b.pdf");

    expect(second.previousFileKey).toBe("resumes/a.pdf");
    expect(second.resume.id).toBe(first.resume.id);
    expect(second.resume.content).toEqual(content("Segunda"));
    expect(await repository.getBase(profileId)).toEqual(second.resume);
    expect(await db.select().from(resumes).where(eq(resumes.profileId, profileId))).toHaveLength(1);
  });

  it("clears the score on replace and keeps it as the previous one on update", async () => {
    const { resume } = await repository.replaceBase(profileId, content("A"), "resumes/a.pdf");

    await score(resume.id, 80);
    expect(await repository.getBase(profileId)).toMatchObject({
      score: 80,
      scoreBreakdown: breakdown,
      scoredAt: expect.any(String),
    });

    await repository.replaceBase(profileId, content("B"), "resumes/b.pdf");
    expect(await repository.getBase(profileId)).toMatchObject({
      score: null,
      scoreBreakdown: null,
      scoredAt: null,
    });

    await score(resume.id, 70);

    const updated = await repository.updateBaseContent(profileId, content("C"));

    expect(updated).toMatchObject({
      id: resume.id,
      content: content("C"),
      score: 70,
      scoreBreakdown: breakdown,
      scoredAt: null,
    });
    expect(await repository.getBase(profileId)).toEqual(updated);
  });

  it("expires only a score stored before the breakdown existed", async () => {
    expect(await repository.expireLegacyScore(profileId)).toBeUndefined();

    const { resume } = await repository.replaceBase(profileId, content("A"), "resumes/a.pdf");

    expect(await repository.expireLegacyScore(profileId)).toBeUndefined();

    await score(resume.id, 80);
    expect(await repository.expireLegacyScore(profileId)).toBeUndefined();

    await score(resume.id, 75, null);

    const before = await repository.getBase(profileId);

    expect(await repository.expireLegacyScore(otherProfileId)).toBeUndefined();
    expect(await repository.expireLegacyScore(profileId)).toBe(resume.id);
    expect(await repository.getBase(profileId)).toEqual({ ...before, scoredAt: null });
    expect(await repository.expireLegacyScore(profileId)).toBeUndefined();
  });

  it("keeps the stored file key when content is updated", async () => {
    await repository.replaceBase(profileId, content("A"), "resumes/a.pdf");
    await repository.updateBaseContent(profileId, content("B"));

    const next = await repository.replaceBase(profileId, content("C"), "resumes/c.pdf");

    expect(next.previousFileKey).toBe("resumes/a.pdf");
  });

  it("does not update a profile without a base", async () => {
    expect(await repository.updateBaseContent(profileId, content("A"))).toBeUndefined();
  });

  it("scopes every operation to the profile", async () => {
    await repository.replaceBase(profileId, content("Minha"), "resumes/mine.pdf");

    expect(await repository.getBase(otherProfileId)).toBeUndefined();
    expect(await repository.updateBaseContent(otherProfileId, content("X"))).toBeUndefined();

    const other = await repository.replaceBase(otherProfileId, content("Outra"), "resumes/o.pdf");

    expect(other.previousFileKey).toBeNull();
    expect(await repository.getBase(profileId)).toMatchObject({ content: content("Minha") });
  });

  it("reads a résumé for scoring with its full update time", async () => {
    const { resume } = await repository.replaceBase(profileId, content("A"), "resumes/a.pdf");

    await db
      .update(resumes)
      .set({ updatedAt: new Date("2026-11-24T12:00:00.987Z") })
      .where(eq(resumes.id, resume.id));

    expect(await repository.forScoring(resume.id)).toEqual({
      profileId,
      content: content("A"),
      scoreBreakdown: null,
      scoredAt: null,
      updatedAt: new Date("2026-11-24T12:00:00.987Z"),
    });

    await score(resume.id, 64);

    expect(await repository.forScoring(resume.id)).toMatchObject({
      scoreBreakdown: breakdown,
      scoredAt: expect.any(Date),
    });
    expect(await repository.forScoring(crypto.randomUUID())).toBeUndefined();
  });
});
