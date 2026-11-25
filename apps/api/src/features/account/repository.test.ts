import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  aiApplications,
  answerQuestions,
  applicationEvents,
  applicationPackages,
  applications,
  authAccount,
  authSession,
  authUser,
  defaultOrgId,
  interviews,
  jobMatches,
  jobRejections,
  jobs,
  offboardingCases,
  publicPageDailyViews,
  publicPages,
  resumeSuggestions,
  resumes,
  talentAnswers,
  talentPreferences,
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
      orgId: defaultOrgId,
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
    const base = identified.parse(await repos.resumes.getBase(owner));
    const result = await repos.applications.apply(owner, await job(sourceKey), base.id);

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
      aiApplyConsentAt: null,
      aiApplyConsentVersion: null,
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
        job: null,
        matchScore: null,
      },
    ]);
    expect(exported?.applications.map((application) => application.job.title)).toEqual([
      "Vaga newer",
      "Vaga mine",
      "Vaga older",
    ]);
    expect(exported?.applications[1]).toEqual({
      job: { title: "Vaga mine", company: "Acme", url: "https://jobs.example.com/mine" },
      resume: { kind: "base", job: null },
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
        job: null,
        matchScore: null,
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

  it("exports tailored versions with their job and the résumé each application used", async () => {
    const { resume } = await repos.resumes.replaceBase(profileId, content, "resumes/mine.pdf");

    await db
      .update(resumes)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(resumes.id, resume.id));

    const tailoredJob = await job("tailored");
    const bareJob = await job("bare");

    const tailoredContent = {
      ...content,
      headline: { id: "headline", text: "Engenheira Backend" },
    };

    const version = identified.parse(
      await repos.resumeVersions.saveDraft(profileId, tailoredJob, tailoredContent, 91, new Date()),
    );

    await repos.resumeVersions.markReady(profileId, version.id, new Date());

    const withVersion = created.parse(
      await repos.applications.apply(profileId, tailoredJob, version.id),
    ).applicationId;

    const withBase = await applied(profileId, "base");

    const [withoutResume] = await db
      .insert(applications)
      .values({ profileId, jobId: bareJob })
      .returning({ id: applications.id });

    for (const [id, appliedAt] of [
      [withVersion, "2026-11-03T00:00:00Z"],
      [withBase, "2026-11-02T00:00:00Z"],
      [withoutResume.id, "2026-11-01T00:00:00Z"],
    ]) {
      await db
        .update(applications)
        .set({ appliedAt: new Date(appliedAt) })
        .where(eq(applications.id, id));
    }

    const exported = await repository.exportData(profileId);

    expect(exported?.resumes).toEqual([
      expect.objectContaining({ kind: "base", job: null, matchScore: null }),
      {
        kind: "tailored",
        status: "ready",
        content: tailoredContent,
        score: null,
        scoredAt: null,
        updatedAt: expect.any(String),
        job: { title: "Vaga tailored", company: "Acme", url: "https://jobs.example.com/tailored" },
        matchScore: 91,
        suggestions: [],
      },
    ]);
    expect(
      exported?.applications.map((application) => [application.job.title, application.resume]),
    ).toEqual([
      ["Vaga tailored", { kind: "tailored", job: { title: "Vaga tailored", company: "Acme" } }],
      ["Vaga base", { kind: "base", job: null }],
      ["Vaga bare", null],
    ]);

    const serialized = JSON.stringify(exported);

    for (const id of [version.id, tailoredJob, bareJob, withVersion, withBase, withoutResume.id]) {
      expect(serialized).not.toContain(id);
    }
  });

  it("exports only the profile's job matches, best score first and without ids", async () => {
    const [low, high, tie, tieOlder, foreign] = await Promise.all(
      ["low", "high", "tie", "tie-older", "foreign"].map(job),
    );

    const row = (owner: string, jobId: string, score: number, computedAt: string) => ({
      profileId: owner,
      jobId,
      score,
      reasons: [`motivo ${score}`],
      resumeUpdatedAt: new Date("2026-01-01T00:00:00Z"),
      computedAt: new Date(computedAt),
    });

    await db
      .insert(jobMatches)
      .values([
        row(profileId, low, 40, "2026-03-01T00:00:00Z"),
        row(profileId, high, 90, "2026-01-01T00:00:00Z"),
        row(profileId, tieOlder, 70, "2026-01-01T00:00:00Z"),
        row(profileId, tie, 70, "2026-02-01T00:00:00Z"),
        row(otherProfileId, foreign, 99, "2026-04-01T00:00:00Z"),
      ]);

    const exported = await repository.exportData(profileId);

    expect(exported?.matches).toEqual([
      {
        job: { title: "Vaga high", company: "Acme", url: "https://jobs.example.com/high" },
        score: 90,
        reasons: ["motivo 90"],
        computedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        job: { title: "Vaga tie", company: "Acme", url: "https://jobs.example.com/tie" },
        score: 70,
        reasons: ["motivo 70"],
        computedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        job: {
          title: "Vaga tie-older",
          company: "Acme",
          url: "https://jobs.example.com/tie-older",
        },
        score: 70,
        reasons: ["motivo 70"],
        computedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        job: { title: "Vaga low", company: "Acme", url: "https://jobs.example.com/low" },
        score: 40,
        reasons: ["motivo 40"],
        computedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain("Vaga foreign");
    expect(JSON.stringify(exported)).not.toContain(high);
    expect((await repository.exportData(otherProfileId))?.matches).toHaveLength(1);
  });

  it("exports the consent, sign-in and creation timestamps", async () => {
    await db
      .update(talentProfiles)
      .set({
        termsAcceptedAt: new Date("2026-11-01T12:00:00Z"),
        firstSignedInAt: new Date("2026-11-02T08:30:00Z"),
        shareOutcomeWithHr: true,
        aiApplyConsentAt: new Date("2026-11-03T10:00:00Z"),
        aiApplyConsentVersion: "2026-11-25",
        createdAt: new Date("2026-10-31T09:00:00Z"),
      })
      .where(eq(talentProfiles.id, profileId));

    const exported = await repository.exportData(profileId);

    expect(exported?.profile).toMatchObject({
      termsAcceptedAt: "2026-11-01T12:00:00.000Z",
      firstSignedInAt: "2026-11-02T08:30:00.000Z",
      shareOutcomeWithHr: true,
      aiApplyConsentAt: "2026-11-03T10:00:00.000Z",
      aiApplyConsentVersion: "2026-11-25",
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

  it("exports no page and no views when none exist", async () => {
    const exported = await repository.exportData(profileId);

    expect(exported?.page).toBeNull();
    expect(exported?.pageViews).toEqual([]);
  });

  it("exports the page with its tailored résumé and the daily views oldest first", async () => {
    const tailoredJob = await job("page-tailored");

    const version = identified.parse(
      await repos.resumeVersions.saveDraft(profileId, tailoredJob, content, 80, new Date()),
    );

    await db.insert(publicPages).values({
      profileId,
      slug: "marina-lopes",
      enabled: true,
      resumeId: version.id,
      createdAt: new Date("2026-11-10T10:00:00Z"),
      updatedAt: new Date("2026-11-11T10:00:00Z"),
    });
    await db.insert(publicPageDailyViews).values([
      { profileId, day: "2026-11-12", visits: 5, recruiterVisits: 2 },
      { profileId, day: "2026-11-10", visits: 3, recruiterVisits: 0 },
      { profileId: otherProfileId, day: "2026-11-11", visits: 9, recruiterVisits: 9 },
    ]);

    const exported = await repository.exportData(profileId);

    expect(exported?.page).toEqual({
      slug: "marina-lopes",
      enabled: true,
      resume: { kind: "tailored", job: { title: "Vaga page-tailored", company: "Acme" } },
      createdAt: "2026-11-10T10:00:00.000Z",
      updatedAt: "2026-11-11T10:00:00.000Z",
    });
    expect(exported?.pageViews).toEqual([
      { day: "2026-11-10", visits: 3, recruiterVisits: 0 },
      { day: "2026-11-12", visits: 5, recruiterVisits: 2 },
    ]);
  });

  it("exports a page that follows the base résumé without a résumé reference", async () => {
    await db
      .insert(publicPages)
      .values({ profileId, slug: "base-page", createdAt: null, updatedAt: null });

    expect((await repository.exportData(profileId))?.page).toEqual({
      slug: "base-page",
      enabled: false,
      resume: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("exports the answers with their questions ordered by text", async () => {
    expect((await repository.exportData(profileId))?.answers).toEqual([]);

    const late = await repos.answers.ensureQuestion("Zzz última?", new Date());
    const early = await repos.answers.ensureQuestion("Aaa primeira?", new Date());

    await repos.answers.answer(profileId, late, "Z", new Date("2026-03-01T00:00:00Z"));
    await repos.answers.answer(profileId, early, "A", new Date("2026-03-02T00:00:00Z"));
    await repos.answers.answer(otherProfileId, early, "Alheia", new Date());

    const undated = await repos.answers.ensureQuestion("Mmm sem data?", new Date());

    await db
      .insert(talentAnswers)
      .values({ profileId, questionId: undated, answer: "M", updatedAt: null });

    expect((await repository.exportData(profileId))?.answers).toEqual([
      { question: "Aaa primeira?", answer: "A", updatedAt: "2026-03-02T00:00:00.000Z" },
      { question: "Mmm sem data?", answer: "M", updatedAt: null },
      { question: "Zzz última?", answer: "Z", updatedAt: "2026-03-01T00:00:00.000Z" },
    ]);
  });

  it("deletes the answers with the profile and keeps the questions", async () => {
    const question = await repos.answers.ensureQuestion("Aaa primeira?", new Date());

    await repos.answers.answer(profileId, question, "A", new Date());
    await repos.answers.answer(otherProfileId, question, "B", new Date());

    expect(await repository.deleteProfile(profileId)).toBe(true);

    expect(await db.select().from(talentAnswers)).toEqual([
      expect.objectContaining({ profileId: otherProfileId, answer: "B" }),
    ]);
    expect(
      await db.select().from(answerQuestions).where(eq(answerQuestions.id, question)),
    ).toHaveLength(1);
  });

  it("exports default preferences without a row and the stored ones with it", async () => {
    expect((await repository.exportData(profileId))?.preferences).toEqual({
      mode: "review",
      hybridThreshold: 75,
      targetTitles: [],
      jobPreferences: {
        workModels: [],
        locations: [],
        relocate: false,
        salaryFloorCents: null,
        seniorities: [],
        excludedCompanies: [],
      },
      profileFields: {
        phone: { value: null, share: false },
        city: { value: null, share: false },
        linkedin: { value: null, share: false },
        portfolio: { value: null, share: false },
        workAuthorization: { value: null, share: false },
        availability: { value: null, share: false },
        noticePeriod: { value: null, share: false },
        salaryExpectation: { value: null, share: false },
        cpf: { value: null, share: false },
        birthDate: { value: null, share: false },
        address: { value: null, share: false },
      },
    });

    await db.insert(talentPreferences).values([
      {
        profileId,
        mode: "automatic",
        hybridThreshold: 80,
        targetTitles: ["Backend"],
        jobPreferences: { relocate: true },
        profileFields: { phone: { value: "11 90000-0000", share: true } },
      },
      { profileId: otherProfileId, mode: "hybrid", targetTitles: ["Foreign"] },
    ]);

    const exported = await repository.exportData(profileId);

    expect(exported?.preferences).toMatchObject({
      mode: "automatic",
      hybridThreshold: 80,
      targetTitles: ["Backend"],
      jobPreferences: { relocate: true, workModels: [] },
      profileFields: { phone: { value: "11 90000-0000", share: true } },
    });
    expect(JSON.stringify(exported)).not.toContain("Foreign");
  });

  it("exports the rejections newest first and deletes them with the profile", async () => {
    expect((await repository.exportData(profileId))?.rejections).toEqual([]);

    const closed = await job("closed-one");
    const open = await job("open-one");
    const foreign = await job("foreign-one");

    await db.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.id, closed));
    await db.insert(jobRejections).values([
      {
        profileId,
        jobId: open,
        reason: "salary",
        note: "baixo",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
      { profileId, jobId: closed, reason: "other", createdAt: new Date("2026-03-02T00:00:00Z") },
      { profileId: otherProfileId, jobId: foreign, reason: "company" },
    ]);

    const undated = await job("undated-one");

    await db
      .insert(jobRejections)
      .values({ profileId, jobId: undated, reason: "other", createdAt: null });

    const exported = await repository.exportData(profileId);

    expect(exported?.rejections).toEqual([
      expect.objectContaining({ createdAt: null }),
      {
        job: { id: closed, title: "Vaga closed-one", company: expect.any(String) },
        reason: "other",
        note: null,
        createdAt: "2026-03-02T00:00:00.000Z",
      },
      {
        job: { id: open, title: "Vaga open-one", company: expect.any(String) },
        reason: "salary",
        note: "baixo",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain("foreign-one");

    expect(await repository.deleteProfile(profileId)).toBe(true);
    expect(await db.select().from(jobRejections)).toEqual([
      expect.objectContaining({ profileId: otherProfileId }),
    ]);
  });

  it("exports the cover letters newest first and deletes them with the profile", async () => {
    expect((await repository.exportData(profileId))?.packages).toEqual([]);

    const older = await job("older-letter");
    const newer = await job("newer-letter");
    const undated = await job("undated-letter");
    const foreign = await job("foreign-letter");

    await db.insert(applicationPackages).values([
      {
        profileId,
        jobId: older,
        coverLetter: "Antiga",
        updatedAt: new Date("2026-03-01T00:00:00Z"),
      },
      { profileId, jobId: newer, coverLetter: "Nova", updatedAt: new Date("2026-03-02T00:00:00Z") },
      { profileId, jobId: undated, coverLetter: "Sem data", updatedAt: null },
      { profileId: otherProfileId, jobId: foreign, coverLetter: "Alheia" },
    ]);

    const exported = await repository.exportData(profileId);

    expect(exported?.packages).toEqual([
      {
        job: { id: newer, title: "Vaga newer-letter", company: expect.any(String) },
        coverLetter: "Nova",
        updatedAt: "2026-03-02T00:00:00.000Z",
      },
      {
        job: { id: older, title: "Vaga older-letter", company: expect.any(String) },
        coverLetter: "Antiga",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        job: { id: undated, title: "Vaga undated-letter", company: expect.any(String) },
        coverLetter: "Sem data",
        updatedAt: null,
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain("Alheia");

    expect(await repository.deleteProfile(profileId)).toBe(true);
    expect(await db.select().from(applicationPackages)).toEqual([
      expect.objectContaining({ profileId: otherProfileId, coverLetter: "Alheia" }),
    ]);
  });

  it("exports the AI applications newest first with the confirmed answers and deletes them with the profile", async () => {
    expect((await repository.exportData(profileId))?.aiApplications).toEqual([]);

    const confirmedJob = await job("ai-confirmed");
    const draftJob = await job("ai-draft");
    const foreignJob = await job("ai-foreign");

    const question = (id: string, label: string) => ({
      id,
      label,
      required: false,
      section: "questions" as const,
      fields: [],
      kind: "custom" as const,
      sensitive: false,
    });

    const form = {
      questions: [
        question("a", "Pergunta A"),
        {
          ...question("b", "Pergunta B"),
          fields: [
            {
              name: "b",
              type: "multi_select" as const,
              options: [
                { label: "Um", value: "1" },
                { label: "Dois", value: "2" },
              ],
            },
          ],
        },
        { ...question("cv", "Currículo"), kind: "resume" as const },
        { ...question("doc", "Laudo"), kind: "document" as const },
      ],
    };

    const preparedAt = new Date("2026-03-01T10:00:00Z");

    await db
      .insert(aiApplications)
      .values([
        {
          profileId,
          jobId: draftJob,
          state: "draft",
          form,
          draft: [
            { questionId: "a", value: "rascunho", source: null, inferred: false, status: "filled" },
            { questionId: "gone", value: "x", source: null, inferred: false, status: "filled" },
            { questionId: "b", value: null, source: null, inferred: false, status: "blank" },
          ],
          preparedAt,
          createdAt: new Date("2026-03-01T10:00:00Z"),
        },
        {
          profileId,
          jobId: confirmedJob,
          state: "queued",
          reason: null,
          form,
          draft: [
            { questionId: "a", value: "rascunho", source: null, inferred: false, status: "filled" },
          ],
          confirmed: [
            { questionId: "a", value: "final" },
            { questionId: "b", value: ["1", "9"] },
            { questionId: "cv", value: "arquivo.pdf" },
            { questionId: "doc", value: "laudo.pdf" },
          ],
          preparedAt,
          confirmedAt: new Date("2026-03-02T10:00:00Z"),
          finishedAt: new Date("2026-03-03T10:00:00Z"),
          createdAt: new Date("2026-03-02T10:00:00Z"),
        },
        {
          profileId: otherProfileId,
          jobId: foreignJob,
          state: "draft",
          form,
          draft: [],
          preparedAt,
        },
      ])
      .returning({ id: aiApplications.id });

    const exported = await repository.exportData(profileId);

    expect(exported?.aiApplications).toEqual([
      {
        job: { id: confirmedJob, title: "Vaga ai-confirmed", company: "Acme" },
        state: "queued",
        reason: null,
        answers: [
          { question: "Pergunta A", value: "final" },
          { question: "Pergunta B", value: ["Um", "9"] },
        ],
        preparedAt: "2026-03-01T10:00:00.000Z",
        confirmedAt: "2026-03-02T10:00:00.000Z",
        finishedAt: "2026-03-03T10:00:00.000Z",
      },
      {
        job: { id: draftJob, title: "Vaga ai-draft", company: "Acme" },
        state: "draft",
        reason: null,
        answers: [
          { question: "Pergunta A", value: "rascunho" },
          { question: "Pergunta B", value: null },
        ],
        preparedAt: "2026-03-01T10:00:00.000Z",
        confirmedAt: null,
        finishedAt: null,
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain(foreignJob);

    expect(await repository.deleteProfile(profileId)).toBe(true);
    expect(await db.select({ id: aiApplications.id }).from(aiApplications)).toEqual([
      { id: expect.any(String) },
    ]);
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
      orgId: defaultOrgId,
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
