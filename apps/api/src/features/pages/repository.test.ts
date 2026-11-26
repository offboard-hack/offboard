import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  type ResumeContent,
  defaultOrgId,
  jobs,
  offboardingCases,
  publicPageDailyViews,
  publicPages,
  resumes,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-11-24T02:00:00Z");

const identified = z.object({ id: z.uuid() });

const applied = z.object({ publicToken: z.string() });

function content(headline: string) {
  return {
    headline: { id: "headline", text: headline },
    summary: { id: "summary", text: "Backend." },
    experiences: [],
    education: [],
    skills: [],
    languages: [],
    contact: { email: null, phone: null, city: null, links: [] },
  } satisfies ResumeContent;
}

describe.skipIf(!url)("pages repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.pages;
  let profileId: string;
  let otherProfileId: string;
  let baseId: string;

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

    profileId = await enable(first.id, "pessoa@exemplo.com", "Marina Lopes");
    otherProfileId = await enable(second.id, "outra@exemplo.com", "Marina Lópes");
    baseId = await base(profileId, "Base");
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function enable(caseId: string, personalEmail: string, name: string) {
    const profile = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId,
      personalEmail,
      sponsoredUntil: "2026-12-31",
    });

    const { id } = identified.parse(profile);

    await db.update(talentProfiles).set({ name }).where(eq(talentProfiles.id, id));

    return id;
  }

  async function base(owner: string, headline: string) {
    const { resume } = await repos.resumes.replaceBase(owner, content(headline), `r/${owner}.pdf`);

    return resume.id;
  }

  async function job(sourceKey: string) {
    const [row] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "seed",
        sourceKey,
        title: `Vaga ${sourceKey}`,
        company: "Acme",
        url: `https://jobs.example.com/${sourceKey}`,
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  async function tailored(owner: string, sourceKey: string, ready: boolean) {
    const versions = repos.resumeVersions;

    const draft = await versions.saveDraft(
      owner,
      await job(sourceKey),
      content(`Sob medida ${sourceKey}`),
      70,
      now,
    );

    const { id } = identified.parse(draft);

    if (ready) await versions.markReady(owner, id, now);

    return id;
  }

  async function token(owner: string, sourceKey: string) {
    const resumeId = owner === profileId ? baseId : await base(owner, "Outra");
    const result = await repos.applications.apply(owner, await job(sourceKey), resumeId);

    return applied.parse(result).publicToken;
  }

  function pages() {
    return db
      .select({
        profileId: publicPages.profileId,
        slug: publicPages.slug,
        enabled: publicPages.enabled,
        resumeId: publicPages.resumeId,
      })
      .from(publicPages)
      .orderBy(asc(publicPages.slug));
  }

  function views(owner: string) {
    return db
      .select({
        day: publicPageDailyViews.day,
        visits: publicPageDailyViews.visits,
        recruiterVisits: publicPageDailyViews.recruiterVisits,
      })
      .from(publicPageDailyViews)
      .where(eq(publicPageDailyViews.profileId, owner))
      .orderBy(asc(publicPageDailyViews.day));
  }

  it("suggests settings from the name without writing", async () => {
    expect(await repository.settings(profileId)).toEqual({
      slug: "marina-lopes",
      enabled: false,
      resumeId: null,
      exists: false,
    });

    await repository.save(otherProfileId, {}, now);

    expect(await repository.settings(otherProfileId)).toEqual({
      slug: "marina-lopes",
      enabled: false,
      resumeId: null,
      exists: true,
    });
    expect((await repository.settings(profileId)).slug).toBe("marina-lopes-2");
    expect(await pages()).toEqual([
      { profileId: otherProfileId, slug: "marina-lopes", enabled: false, resumeId: null },
    ]);
  });

  it("validates and reserves slugs", async () => {
    for (const slug of ["Marina", "admin", "ab", "marina--lopes", "a".repeat(41), "-ana"]) {
      expect(await repository.save(profileId, { slug, enabled: true }, now)).toBe("invalid_slug");
    }

    expect(await pages()).toEqual([]);
    expect(await repository.save(otherProfileId, { slug: "marina" }, now)).toMatchObject({
      slug: "marina",
    });
    expect(await repository.save(profileId, { slug: "marina", enabled: true }, now)).toBe(
      "slug_taken",
    );
    expect(await pages()).toEqual([
      { profileId: otherProfileId, slug: "marina", enabled: false, resumeId: null },
    ]);

    await repository.save(profileId, { slug: "marina-dev" }, now);

    expect(await repository.save(profileId, { slug: "marina" }, now)).toBe("slug_taken");
    expect(await repository.save(profileId, { slug: "marina-dev", enabled: true }, now)).toEqual({
      slug: "marina-dev",
      enabled: true,
      resumeId: null,
      exists: true,
    });
    expect(await repository.settings(profileId)).toMatchObject({ slug: "marina-dev" });
  });

  it("upserts only the fields given", async () => {
    const chosen = await tailored(profileId, "escolhida", true);

    expect(await repository.save(profileId, { enabled: true }, now)).toEqual({
      slug: "marina-lopes",
      enabled: true,
      resumeId: null,
      exists: true,
    });
    expect(await repository.save(profileId, { resumeId: chosen }, now)).toEqual({
      slug: "marina-lopes",
      enabled: true,
      resumeId: chosen,
      exists: true,
    });
    expect(await repository.save(profileId, { enabled: false }, now)).toMatchObject({
      enabled: false,
      resumeId: chosen,
    });
    expect(await repository.save(profileId, { resumeId: baseId }, now)).toMatchObject({
      resumeId: baseId,
    });
    expect(await repository.save(profileId, { resumeId: null, slug: "marina" }, now)).toEqual({
      slug: "marina",
      enabled: false,
      resumeId: null,
      exists: true,
    });

    const later = new Date("2026-11-25T12:00:00Z");

    await repository.save(profileId, {}, later);

    const [stored] = await db
      .select({ createdAt: publicPages.createdAt, updatedAt: publicPages.updatedAt })
      .from(publicPages)
      .where(eq(publicPages.profileId, profileId));

    expect(stored).toEqual({ createdAt: now, updatedAt: later });
  });

  it("accepts only the profile's ready résumés", async () => {
    const draft = await tailored(profileId, "rascunho", false);
    const foreign = await tailored(otherProfileId, "alheia", true);
    const foreignBase = await base(otherProfileId, "Outra");

    for (const resumeId of [draft, foreign, foreignBase, missingId]) {
      expect(await repository.save(profileId, { resumeId, enabled: true }, now)).toBe(
        "resume_not_ready",
      );
    }

    expect(await pages()).toEqual([]);
  });

  it("rethrows unexpected database errors", async () => {
    await expect(repository.save(missingId, { slug: "ninguem" }, now)).rejects.toThrow();
  });

  it("serves only a ready résumé", async () => {
    const chosen = await tailored(profileId, "escolhida", true);

    await repository.save(profileId, { enabled: true }, now);
    await repository.save(otherProfileId, { enabled: true }, now);

    expect(await repository.publicPage("marina-lopes")).toEqual({
      profileId,
      orgId: defaultOrgId,
      name: "Marina Lopes",
      sponsoredUntil: "2026-12-31",
      collaborator: false,
      content: content("Base"),
    });
    expect(await repository.publicPage("marina-lopes-2")).toBeUndefined();

    await repository.save(profileId, { resumeId: chosen }, now);

    expect(await repository.publicPage("marina-lopes")).toMatchObject({
      content: content("Sob medida escolhida"),
    });

    await repos.resumeVersions.update(profileId, chosen, content("Editada"), now);

    expect(await repository.publicPage("marina-lopes")).toBeUndefined();

    await db.delete(resumes).where(eq(resumes.id, chosen));

    expect(await repository.settings(profileId)).toMatchObject({ resumeId: null });
    expect(await repository.publicPage("marina-lopes")).toMatchObject({
      content: content("Base"),
    });
  });

  it("hides disabled and unknown pages", async () => {
    await repository.save(profileId, { slug: "marina" }, now);

    expect(await repository.publicPage("marina")).toBeUndefined();
    expect(await repository.publicPage("desconhecida")).toBeUndefined();

    await repository.save(profileId, { enabled: true }, now);

    expect(await repository.publicPage("marina")).toMatchObject({ profileId });
  });

  it("counts recruiter visits only for this profile's tokens", async () => {
    const own = await token(profileId, "propria");
    const foreign = await token(otherProfileId, "alheia");

    for (const visitor of [own, foreign, "desconhecido", null]) {
      await repository.recordVisit(profileId, visitor, now);
    }

    expect(await views(profileId)).toEqual([{ day: "2026-11-23", visits: 4, recruiterVisits: 1 }]);
    expect(await views(otherProfileId)).toEqual([]);

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repository.recordVisit(profileId, index % 2 === 0 ? own : null, now),
      ),
    );

    expect(await views(profileId)).toEqual([{ day: "2026-11-23", visits: 14, recruiterVisits: 6 }]);
  });

  it("reports the São Paulo week zero-filled, oldest first", async () => {
    await db.insert(publicPageDailyViews).values([
      { profileId, day: "2026-11-16", visits: 50, recruiterVisits: 5 },
      { profileId, day: "2026-11-17", visits: 3, recruiterVisits: 1 },
      { profileId, day: "2026-11-20", visits: 2, recruiterVisits: 0 },
      { profileId, day: "2026-11-24", visits: 40, recruiterVisits: 4 },
      { profileId: otherProfileId, day: "2026-11-20", visits: 9, recruiterVisits: 9 },
    ]);

    await repository.recordVisit(profileId, null, now);

    expect(await repository.week(profileId, now)).toEqual({
      days: [
        { day: "2026-11-17", visits: 3, recruiterVisits: 1 },
        { day: "2026-11-18", visits: 0, recruiterVisits: 0 },
        { day: "2026-11-19", visits: 0, recruiterVisits: 0 },
        { day: "2026-11-20", visits: 2, recruiterVisits: 0 },
        { day: "2026-11-21", visits: 0, recruiterVisits: 0 },
        { day: "2026-11-22", visits: 0, recruiterVisits: 0 },
        { day: "2026-11-23", visits: 1, recruiterVisits: 0 },
      ],
      visits: 6,
      recruiterVisits: 1,
    });
  });

  it("links only enabled pages", async () => {
    expect(await repository.urlFor(profileId)).toBeNull();

    await repository.save(profileId, { slug: "marina" }, now);

    expect(await repository.urlFor(profileId)).toBeNull();

    await repository.save(profileId, { enabled: true }, now);

    expect(await repository.urlFor(profileId)).toBe("marina");
    expect(await repository.urlFor(otherProfileId)).toBeNull();
  });
});
