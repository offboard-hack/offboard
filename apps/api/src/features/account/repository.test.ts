import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  applicationEvents,
  applications,
  authAccount,
  authSession,
  authUser,
  interviews,
  jobs,
  offboardingCases,
  resumes,
  resumeSuggestions,
  talentProfiles,
  teamMembers,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";

const identified = z.object({ id: z.uuid() });

const created = z.object({ applicationId: z.uuid() });

const content = {
  headline: { id: "headline", text: "Engenheira" },
  summary: { id: "summary", text: "Backend." },
  experiences: [],
  education: [],
  skills: [],
  languages: [],
  contact: { email: null, phone: null, city: null, links: [] },
};

describe.skipIf(!url)("account repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.account;
  let caseId: string;
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
    await db.delete(authUser).where(like(authUser.id, "account-%"));
    await seedDatabase(db, testSeedFixtures);

    const [first, second] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    caseId = first.id;
    profileId = await enable(first.id, "pessoa@exemplo.com");
    otherProfileId = await enable(second.id, "outra@exemplo.com");
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function enable(id: string, personalEmail: string) {
    const profile = await repos.talent.enable({
      caseId: id,
      personalEmail,
      sponsoredUntil: "2026-12-31",
    });

    return identified.parse(profile).id;
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

  async function applied(owner: string, sourceKey: string) {
    const result = await repos.applications.apply(owner, await job(sourceKey));

    return created.parse(result).applicationId;
  }

  async function session(owner: string, id: string) {
    await db
      .insert(authUser)
      .values({ id: `account-user-${id}`, name: "Pessoa", email: `${id}@exemplo.com` });
    await db.insert(authSession).values({
      id,
      token: `token-${id}`,
      userId: `account-user-${id}`,
      talentProfileId: owner,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  async function populate(owner: string, sourceKey: string) {
    await repos.resumes.replaceBase(owner, content, `resumes/${sourceKey}.pdf`);

    const applicationId = await applied(owner, sourceKey);

    await repos.applications.addInterview(owner, applicationId, {
      startsAt: new Date("2026-12-10T15:00:00Z"),
      mode: "video",
      with: "Marina",
      notes: "Fase técnica",
    });
    await repos.applications.addInterview(owner, applicationId, {
      startsAt: new Date("2026-12-05T15:00:00Z"),
      mode: "phone",
      with: "Paulo",
    });
    await repos.applications.changeStatus(owner, applicationId, {
      status: "closed",
      closedReason: "rejected",
    });
    await session(owner, sourceKey);

    return applicationId;
  }

  it("exports the profile data ordered and without internal keys", async () => {
    await populate(profileId, "mine");
    await populate(otherProfileId, "other");

    const older = await applied(profileId, "older");
    const newer = await applied(profileId, "newer");

    await db
      .update(applications)
      .set({ appliedAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(applications.id, older));
    await db
      .update(applications)
      .set({ appliedAt: new Date("2030-01-01T00:00:00Z") })
      .where(eq(applications.id, newer));

    const [profile] = await db
      .select({ name: talentProfiles.name })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, profileId));

    const exported = await repository.exportData(profileId);

    expect(exported?.profile).toEqual({
      name: profile.name,
      email: "pessoa@exemplo.com",
      sponsoredUntil: "2026-12-31",
      termsAcceptedAt: null,
      shareOutcomeWithHr: false,
      firstSignedInAt: null,
      createdAt: expect.any(String),
    });
    expect(exported?.resumes).toEqual([
      {
        kind: "base",
        status: "ready",
        content,
        score: null,
        scoredAt: null,
        updatedAt: expect.any(String),
        suggestions: [],
      },
    ]);
    expect(exported?.applications.map((application) => application.job.title)).toEqual([
      "Vaga newer",
      "Vaga mine",
      "Vaga older",
    ]);
    expect(exported?.applications[1]).toEqual({
      job: { title: "Vaga mine", company: "Acme", url: "https://jobs.example.com/mine" },
      status: "closed",
      closedReason: "rejected",
      appliedAt: expect.any(String),
      events: [
        { status: "sent", closedReason: null, createdAt: expect.any(String) },
        { status: "interview", closedReason: null, createdAt: expect.any(String) },
        { status: "closed", closedReason: "rejected", createdAt: expect.any(String) },
      ],
      interviews: [
        { startsAt: "2026-12-05T15:00:00.000Z", mode: "phone", with: "Paulo", notes: "" },
        {
          startsAt: "2026-12-10T15:00:00.000Z",
          mode: "video",
          with: "Marina",
          notes: "Fase técnica",
        },
      ],
    });

    const serialized = JSON.stringify(exported);

    expect(serialized).not.toContain("resumes/");
    expect(serialized).not.toContain("outra@exemplo.com");
    expect(serialized).not.toContain("Vaga other");
    expect(serialized).not.toContain(profileId);
    expect(serialized).not.toContain(caseId);
    expect(serialized).not.toContain("token-");
  });

  it("exports each résumé's score and suggestions without ids", async () => {
    const { resume } = await repos.resumes.replaceBase(profileId, content, "resumes/mine.pdf");
    const other = await repos.resumes.replaceBase(otherProfileId, content, "resumes/other.pdf");

    await db
      .update(resumes)
      .set({ score: 77, scoredAt: new Date("2026-11-20T10:00:00Z") })
      .where(eq(resumes.id, resume.id));

    const suggestion = {
      targetNodeId: "headline",
      originalText: "Engenheira",
      rationale: "Mostra senioridade.",
      estimatedGain: 5,
    };

    await db.insert(resumeSuggestions).values([
      {
        ...suggestion,
        resumeId: resume.id,
        suggestedText: "Depois",
        status: "dismissed",
        createdAt: new Date("2026-11-21T10:00:00Z"),
      },
      {
        ...suggestion,
        resumeId: resume.id,
        suggestedText: "Antes",
        status: "applied",
        createdAt: new Date("2026-11-20T10:00:00Z"),
      },
      { ...suggestion, resumeId: resume.id, suggestedText: "Sem data", createdAt: null },
      { ...suggestion, resumeId: other.resume.id, suggestedText: "Alheia" },
    ]);

    const exported = await repository.exportData(profileId);

    const exportedSuggestion = {
      originalText: "Engenheira",
      rationale: "Mostra senioridade.",
      estimatedGain: 5,
    };

    expect(exported?.resumes).toEqual([
      {
        kind: "base",
        status: "ready",
        content,
        score: 77,
        scoredAt: "2026-11-20T10:00:00.000Z",
        updatedAt: expect.any(String),
        suggestions: [
          {
            ...exportedSuggestion,
            suggestedText: "Antes",
            status: "applied",
            createdAt: "2026-11-20T10:00:00.000Z",
          },
          {
            ...exportedSuggestion,
            suggestedText: "Depois",
            status: "dismissed",
            createdAt: "2026-11-21T10:00:00.000Z",
          },
          { ...exportedSuggestion, suggestedText: "Sem data", status: "open", createdAt: null },
        ],
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain(resume.id);
  });

  it("exports the consent, sign-in and creation timestamps", async () => {
    await db
      .update(talentProfiles)
      .set({
        termsAcceptedAt: new Date("2026-11-01T12:00:00Z"),
        firstSignedInAt: new Date("2026-11-02T08:30:00Z"),
        shareOutcomeWithHr: true,
        createdAt: new Date("2026-10-31T09:00:00Z"),
      })
      .where(eq(talentProfiles.id, profileId));

    const exported = await repository.exportData(profileId);

    expect(exported?.profile).toMatchObject({
      termsAcceptedAt: "2026-11-01T12:00:00.000Z",
      firstSignedInAt: "2026-11-02T08:30:00.000Z",
      shareOutcomeWithHr: true,
      createdAt: "2026-10-31T09:00:00.000Z",
    });
  });

  it("exports a missing creation timestamp as null", async () => {
    await db
      .update(talentProfiles)
      .set({ createdAt: null })
      .where(eq(talentProfiles.id, profileId));

    expect((await repository.exportData(profileId))?.profile.createdAt).toBeNull();
  });

  it("exports an empty profile", async () => {
    const exported = await repository.exportData(otherProfileId);

    expect(exported?.resumes).toEqual([]);
    expect(exported?.applications).toEqual([]);
  });

  it("exports nothing for an unknown profile", async () => {
    expect(await repository.exportData(missingId)).toBeUndefined();
  });

  it("lists only the stored file keys of the profile", async () => {
    await repos.resumes.replaceBase(profileId, content, "resumes/mine.pdf");
    await repos.resumes.replaceBase(otherProfileId, content, "resumes/other.pdf");
    await db.insert(resumes).values({
      profileId,
      kind: "tailored",
      jobId: await job("tailored"),
      content,
    });

    expect(await repository.fileKeys(profileId)).toEqual(["resumes/mine.pdf"]);
    expect(await repository.fileKeys(missingId)).toEqual([]);
  });

  it("deletes the profile and everything it owns", async () => {
    const applicationId = await populate(profileId, "mine");
    const otherApplicationId = await populate(otherProfileId, "other");

    expect(await repository.deleteProfile(profileId)).toBe(true);

    expect(await db.select().from(talentProfiles).where(eq(talentProfiles.id, profileId))).toEqual(
      [],
    );
    expect(await db.select().from(resumes).where(eq(resumes.profileId, profileId))).toEqual([]);
    expect(
      await db.select().from(applications).where(eq(applications.profileId, profileId)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(applicationEvents)
        .where(eq(applicationEvents.applicationId, applicationId)),
    ).toEqual([]);
    expect(
      await db.select().from(interviews).where(eq(interviews.applicationId, applicationId)),
    ).toEqual([]);
    expect(
      await db.select().from(authSession).where(eq(authSession.talentProfileId, profileId)),
    ).toEqual([]);

    expect(
      await db.select().from(resumes).where(eq(resumes.profileId, otherProfileId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(interviews).where(eq(interviews.applicationId, otherApplicationId)),
    ).toHaveLength(2);
    expect(
      await db.select().from(authSession).where(eq(authSession.talentProfileId, otherProfileId)),
    ).toHaveLength(1);

    const again = await repos.talent.enable({
      caseId,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil: "2026-12-31",
    });

    expect(identified.parse(again).id).not.toBe(profileId);
  });

  async function identity(id: string, email: string) {
    await db.insert(authUser).values({ id, name: "Pessoa", email });
    await db.insert(authAccount).values({
      id: `${id}-account`,
      accountId: id,
      providerId: "magic-link",
      userId: id,
    });
  }

  function identities(id: string) {
    return db.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, id));
  }

  it("deletes the sign-in identity of a talent-only email", async () => {
    await identity("account-mine", "PESSOA@exemplo.com");
    await identity("account-other", "outra@exemplo.com");

    expect(await repository.deleteProfile(profileId)).toBe(true);

    expect(await identities("account-mine")).toEqual([]);
    expect(
      await db.select().from(authAccount).where(eq(authAccount.userId, "account-mine")),
    ).toEqual([]);
    expect(await identities("account-other")).toHaveLength(1);
  });

  it("keeps the sign-in identity shared with a team member", async () => {
    await identity("account-mine", "pessoa@exemplo.com");
    await db
      .insert(teamMembers)
      .values({ name: "Pessoa", email: "Pessoa@Exemplo.com", role: "rh" });

    expect(await repository.deleteProfile(profileId)).toBe(true);

    expect(await identities("account-mine")).toHaveLength(1);
    expect(
      await db.select().from(authAccount).where(eq(authAccount.userId, "account-mine")),
    ).toHaveLength(1);
  });

  it("reports when there was no profile to delete", async () => {
    expect(await repository.deleteProfile(missingId)).toBe(false);
  });
});
