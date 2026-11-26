import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  applicationEvents,
  applications,
  defaultOrgId,
  interviews,
  jobs,
  offboardingCases,
  resumes,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  saoPauloDayRange,
  summarize,
  type ApplicationStatus,
  type ClosedReason,
} from "./funnel.js";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";

const identified = z.object({ id: z.uuid() });

const created = z.object({
  applicationId: z.uuid(),
  jobUrl: z.string(),
  publicToken: z.string(),
});

const content = {
  headline: { id: "headline", text: "Engenheira" },
  summary: { id: "summary", text: "Backend." },
  experiences: [],
  education: [],
  skills: [],
  languages: [],
  contact: { email: null, phone: null, city: null, links: [] },
};

const changed = z.looseObject({ id: z.uuid(), status: z.string(), statusChangedAt: z.string() });

describe.skipIf(!url)("applications repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.applications;
  let profileId: string;
  let otherProfileId: string;
  let baseId: string;
  let otherBaseId: string;

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
    baseId = await base(profileId);
    otherBaseId = await base(otherProfileId);
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

  async function base(owner: string) {
    const { resume } = await repos.resumes.replaceBase(owner, content, `resumes/${owner}.pdf`);

    return resume.id;
  }

  function baseOf(owner: string) {
    return owner === profileId ? baseId : otherBaseId;
  }

  async function job(sourceKey: string, values: Partial<typeof jobs.$inferInsert> = {}) {
    const [row] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "seed",
        sourceKey,
        title: `Vaga ${sourceKey}`,
        company: "Acme",
        url: `https://jobs.example.com/${sourceKey}`,
        ...values,
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  async function applied(owner: string, sourceKey: string) {
    const result = await repository.apply(owner, await job(sourceKey), baseOf(owner));

    return created.parse(result).applicationId;
  }

  function row(applicationId: string) {
    return db
      .select({
        status: applications.status,
        closedReason: applications.closedReason,
        furthestStage: applications.furthestStage,
        statusChangedAt: applications.statusChangedAt,
      })
      .from(applications)
      .where(eq(applications.id, applicationId));
  }

  function events(applicationId: string) {
    return db
      .select({ status: applicationEvents.status, closedReason: applicationEvents.closedReason })
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, applicationId))
      .orderBy(asc(applicationEvents.createdAt));
  }

  async function change(
    applicationId: string,
    status: ApplicationStatus,
    closedReason?: ClosedReason,
  ) {
    const result = await repository.changeStatus(profileId, applicationId, {
      status,
      closedReason,
    });

    return changed.parse(result);
  }

  const interview = (startsAt: string) => ({
    startsAt: new Date(startsAt),
    mode: "video" as const,
    with: "Recrutadora",
  });

  it("applies to an open job and records a sent event", async () => {
    const jobId = await job("aberta");

    const result = await repository.apply(profileId, jobId, baseId);

    expect(result).toEqual({
      applicationId: expect.any(String),
      jobUrl: "https://jobs.example.com/aberta",
      publicToken: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
    });
    const { applicationId, publicToken } = created.parse(result);

    expect(
      await db
        .select({ publicToken: applications.publicToken })
        .from(applications)
        .where(eq(applications.id, applicationId)),
    ).toEqual([{ publicToken }]);

    expect(await row(applicationId)).toEqual([
      {
        status: "sent",
        closedReason: null,
        furthestStage: "sent",
        statusChangedAt: expect.any(Date),
      },
    ]);
    expect(await events(applicationId)).toEqual([{ status: "sent", closedReason: null }]);
  });

  it("gives each application its own public token", async () => {
    const tokens = [];

    for (const sourceKey of ["um", "dois", "tres"]) {
      const result = created.parse(await repository.apply(profileId, await job(sourceKey), baseId));

      tokens.push(result.publicToken);
    }

    tokens.push(
      created.parse(await repository.apply(otherProfileId, await job("quatro"), otherBaseId))
        .publicToken,
    );

    expect(new Set(tokens).size).toBe(4);
    expect(
      (await db.select({ publicToken: applications.publicToken }).from(applications))
        .map((row) => row.publicToken)
        .sort(),
    ).toEqual([...tokens].sort());
  });

  it("stores application and event times from the application clock", async () => {
    const before = Date.now();
    const applicationId = await applied(profileId, "relogio");

    await change(applicationId, "in_review");
    await change(applicationId, "interview");

    const [stored] = await db
      .select({
        appliedAt: applications.appliedAt,
        statusChangedAt: applications.statusChangedAt,
        updatedAt: applications.updatedAt,
      })
      .from(applications)
      .where(eq(applications.id, applicationId));

    const times = await db
      .select({ status: applicationEvents.status, createdAt: applicationEvents.createdAt })
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, applicationId))
      .orderBy(asc(applicationEvents.createdAt));

    for (const date of [
      stored.appliedAt,
      stored.statusChangedAt,
      ...times.map((t) => t.createdAt),
    ]) {
      expect(Math.abs((date?.getTime() ?? 0) - Date.now())).toBeLessThan(10_000);
      expect(date?.getTime()).toBeGreaterThanOrEqual(before);
    }

    expect(times.map((t) => t.status)).toEqual(["sent", "in_review", "interview"]);
    expect(stored.statusChangedAt.getTime()).toBeGreaterThanOrEqual(stored.appliedAt.getTime());
  });

  it("applies once per profile and job", async () => {
    const jobId = await job("unica");

    await repository.apply(profileId, jobId, baseId);

    expect(await repository.apply(profileId, jobId, baseId)).toBe("already_applied");
    expect(await db.select().from(applications)).toHaveLength(1);
    expect(await db.select().from(applicationEvents)).toHaveLength(1);
    expect(await repository.apply(otherProfileId, jobId, otherBaseId)).toMatchObject({
      applicationId: expect.any(String),
    });
  });

  it("refuses closed and unknown jobs", async () => {
    const closedId = await job("fechada", { closedAt: new Date("2026-11-01T00:00:00Z") });

    expect(await repository.apply(profileId, closedId, baseId)).toBe("job_not_found");
    expect(await repository.apply(profileId, missingId, baseId)).toBe("job_not_found");
    expect(await repository.apply(profileId, closedId, missingId)).toBe("job_not_found");
    expect(await db.select().from(applications)).toHaveLength(0);
    expect(await db.select().from(applicationEvents)).toHaveLength(0);
  });

  it("stores the résumé used to apply", async () => {
    const applicationId = await applied(profileId, "com-curriculo");

    const [stored] = await db
      .select({ resumeId: applications.resumeId })
      .from(applications)
      .where(eq(applications.id, applicationId));

    expect(stored).toEqual({ resumeId: baseId });
  });

  it("requires a ready résumé of the profile for this job", async () => {
    const jobId = await job("exige");
    const otherJobId = await job("outra");
    const now = new Date();
    const versions = repos.resumeVersions;

    const tailored = async (owner: string, target: string) =>
      identified.parse(await versions.saveDraft(owner, target, content, 60, now)).id;

    const forOtherJob = await tailored(profileId, otherJobId);
    const draft = await tailored(profileId, jobId);
    const foreign = await tailored(otherProfileId, jobId);

    await versions.markReady(profileId, forOtherJob, now);
    await versions.markReady(otherProfileId, foreign, now);

    for (const resumeId of [forOtherJob, draft, foreign, otherBaseId, missingId]) {
      expect(await repository.apply(profileId, jobId, resumeId)).toBe("resume_not_ready");
    }

    expect(await db.select().from(applications)).toHaveLength(0);
    expect(await db.select().from(applicationEvents)).toHaveLength(0);

    await versions.markReady(profileId, draft, now);

    const { applicationId } = created.parse(await repository.apply(profileId, jobId, draft));

    expect(await repository.apply(profileId, jobId, missingId)).toBe("resume_not_ready");
    expect(await repository.apply(profileId, jobId, baseId)).toBe("already_applied");
    expect(
      await db
        .select({ resumeId: applications.resumeId })
        .from(applications)
        .where(eq(applications.id, applicationId)),
    ).toEqual([{ resumeId: draft }]);
    expect(await db.select({ id: resumes.id }).from(resumes)).toHaveLength(5);
  });

  it("lists the profile's applications newest first with job fields", async () => {
    const older = await applied(profileId, "antiga");

    const newer = created.parse(
      await repository.apply(
        profileId,
        await job("nova", {
          workModel: "hybrid",
          city: "Curitiba",
          state: "PR",
          title: "Designer",
        }),
        baseId,
      ),
    );

    await applied(otherProfileId, "alheia");
    await db
      .update(applications)
      .set({ appliedAt: new Date("2026-11-01T12:00:00Z") })
      .where(eq(applications.id, older));
    await db
      .update(applications)
      .set({ appliedAt: new Date("2026-11-10T12:00:00Z") })
      .where(eq(applications.id, newer.applicationId));

    const list = await repository.list(profileId);

    expect(list.map((item) => item.id)).toEqual([newer.applicationId, older]);
    expect(list[0]).toEqual({
      id: newer.applicationId,
      status: "sent",
      closedReason: null,
      appliedAt: "2026-11-10T12:00:00.000Z",
      statusChangedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      job: {
        id: expect.any(String),
        title: "Designer",
        company: "Acme",
        workModel: "hybrid",
        city: "Curitiba",
        state: "PR",
      },
    });
    expect(list[1].job).toMatchObject({ title: "Vaga antiga", workModel: null, city: null });
  });

  it("summarizes the funnel of the profile's applications", async () => {
    const withdrawn = await applied(profileId, "desistencia");
    const rejectedAfterInterview = await applied(profileId, "rejeitada-entrevista");
    const rejected = await applied(profileId, "rejeitada");
    const offered = await applied(profileId, "oferta");
    const hired = await applied(profileId, "contratada");

    await applied(otherProfileId, "alheia");
    await change(withdrawn, "closed", "withdrawn");
    await change(rejectedAfterInterview, "interview");
    await change(rejectedAfterInterview, "closed", "rejected");
    await change(rejected, "closed", "rejected");
    await change(offered, "offer");
    await change(hired, "closed", "hired");

    const expected = summarize([
      { closedReason: "withdrawn", furthestStage: "sent" },
      { closedReason: "rejected", furthestStage: "interview" },
      { closedReason: "rejected", furthestStage: "sent" },
      { closedReason: null, furthestStage: "offer" },
      { closedReason: "hired", furthestStage: "offer" },
    ]);

    expect(await repository.summary(profileId)).toEqual(expected);
    expect(expected).toEqual({ sent: 5, responded: 4, interviews: 3, offers: 2 });
    expect(await repository.summary(otherProfileId)).toEqual({
      sent: 1,
      responded: 0,
      interviews: 0,
      offers: 0,
    });
  });

  it("changes status with one event per change", async () => {
    const applicationId = await applied(profileId, "processo");
    await db
      .update(applications)
      .set({ statusChangedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(applications.id, applicationId));

    const reviewed = await change(applicationId, "in_review");

    expect(reviewed).toMatchObject({ id: applicationId, status: "in_review", closedReason: null });
    expect(reviewed.statusChangedAt > "2026-01-02").toBe(true);

    const closed = await change(applicationId, "closed", "hired");

    expect(closed).toMatchObject({ status: "closed", closedReason: "hired" });
    expect(await row(applicationId)).toEqual([
      expect.objectContaining({ status: "closed", closedReason: "hired", furthestStage: "offer" }),
    ]);
    expect(await events(applicationId)).toEqual([
      { status: "sent", closedReason: null },
      { status: "in_review", closedReason: null },
      { status: "closed", closedReason: "hired" },
    ]);
  });

  it("leaves the application unchanged on an invalid transition", async () => {
    const applicationId = await applied(profileId, "invalida");

    await change(applicationId, "interview");
    const before = await row(applicationId);

    expect(await repository.changeStatus(profileId, applicationId, { status: "in_review" })).toBe(
      "invalid_transition",
    );
    expect(await repository.changeStatus(profileId, applicationId, { status: "closed" })).toBe(
      "invalid_transition",
    );
    expect(await row(applicationId)).toEqual(before);
    expect(await events(applicationId)).toHaveLength(2);
  });

  it("hides other profiles' applications from status changes", async () => {
    const applicationId = await applied(otherProfileId, "alheia");
    const before = await row(applicationId);

    expect(await repository.changeStatus(profileId, applicationId, { status: "offer" })).toBe(
      "not_found",
    );
    expect(await repository.changeStatus(profileId, missingId, { status: "offer" })).toBe(
      "not_found",
    );
    expect(await row(applicationId)).toEqual(before);
    expect(await events(applicationId)).toHaveLength(1);
    expect(await repository.list(profileId)).toEqual([]);
  });

  it("serializes concurrent status changes", async () => {
    const applicationId = await applied(profileId, "corrida");

    const warm = await Promise.all([db.$client.connect(), db.$client.connect()]);

    for (const client of warm) client.release();

    const results = await Promise.all([
      repository.changeStatus(profileId, applicationId, { status: "interview" }),
      repository.changeStatus(profileId, applicationId, { status: "offer" }),
    ]);

    const invalid = results.filter((result) => result === "invalid_transition").length;

    expect(invalid).toBeLessThanOrEqual(1);
    expect(await row(applicationId)).toEqual([
      expect.objectContaining({ status: "offer", furthestStage: "offer" }),
    ]);
    expect(await events(applicationId)).toHaveLength(3 - invalid);

    const sameTarget = await applied(profileId, "mesmo-alvo");

    const twins = await Promise.all([
      repository.changeStatus(profileId, sameTarget, { status: "interview" }),
      repository.changeStatus(profileId, sameTarget, { status: "interview" }),
    ]);

    expect(twins.filter((result) => result === "invalid_transition")).toHaveLength(1);
    expect(await events(sameTarget)).toHaveLength(2);
  });

  it("adds an interview and promotes an earlier application to interview", async () => {
    const applicationId = await applied(profileId, "entrevista");

    const result = await repository.addInterview(profileId, applicationId, {
      startsAt: new Date("2026-11-25T14:00:00-03:00"),
      mode: "in_person",
      with: "Gestora",
      notes: "Levar portfólio",
    });

    expect(result).toEqual({
      id: expect.any(String),
      applicationId,
      startsAt: "2026-11-25T17:00:00.000Z",
      mode: "in_person",
      with: "Gestora",
      notes: "Levar portfólio",
      job: { title: "Vaga entrevista", company: "Acme" },
    });
    expect(await row(applicationId)).toEqual([
      expect.objectContaining({ status: "interview", furthestStage: "interview" }),
    ]);
    expect(await events(applicationId)).toEqual([
      { status: "sent", closedReason: null },
      { status: "interview", closedReason: null },
    ]);
  });

  it("keeps a later status when adding an interview", async () => {
    const applicationId = await applied(profileId, "proposta");

    await change(applicationId, "offer");
    const before = await row(applicationId);

    const result = await repository.addInterview(
      profileId,
      applicationId,
      interview("2026-11-26T10:00:00-03:00"),
    );

    expect(result).toMatchObject({ applicationId, notes: "" });
    expect(await row(applicationId)).toEqual(before);
    expect(await events(applicationId)).toHaveLength(2);
  });

  it("rejects interviews on closed applications", async () => {
    const applicationId = await applied(profileId, "encerrada");

    await change(applicationId, "closed", "rejected");
    const before = await row(applicationId);

    expect(
      await repository.addInterview(
        profileId,
        applicationId,
        interview("2026-11-26T10:00:00-03:00"),
      ),
    ).toBe("application_closed");
    expect(await row(applicationId)).toEqual(before);
    expect(await events(applicationId)).toHaveLength(2);
    expect(await db.select().from(interviews)).toHaveLength(0);
  });

  it("hides other profiles' applications from interviews", async () => {
    const applicationId = await applied(otherProfileId, "alheia");
    const before = await row(applicationId);

    expect(
      await repository.addInterview(
        profileId,
        applicationId,
        interview("2026-11-26T10:00:00-03:00"),
      ),
    ).toBe("not_found");
    expect(await row(applicationId)).toEqual(before);
    expect(await events(applicationId)).toHaveLength(1);
    expect(await db.select().from(interviews)).toHaveLength(0);
  });

  it("removes only the profile's own interviews", async () => {
    const own = await repository.addInterview(
      profileId,
      await applied(profileId, "propria"),
      interview("2026-11-26T10:00:00-03:00"),
    );

    const foreign = await repository.addInterview(
      otherProfileId,
      await applied(otherProfileId, "alheia"),
      interview("2026-11-26T11:00:00-03:00"),
    );

    const ownId = identified.parse(own).id;
    const foreignId = identified.parse(foreign).id;

    expect(await repository.removeInterview(profileId, foreignId)).toBe(false);
    expect(await db.select().from(interviews)).toHaveLength(2);
    expect(await repository.removeInterview(profileId, ownId)).toBe(true);
    expect(await repository.removeInterview(profileId, ownId)).toBe(false);
    expect(await db.select({ id: interviews.id }).from(interviews)).toEqual([{ id: foreignId }]);
  });

  it("bounds the agenda by São Paulo days", async () => {
    const applicationId = await applied(profileId, "agenda");
    const foreignId = await applied(otherProfileId, "alheia");

    for (const startsAt of [
      "2026-11-30T00:30:00-03:00",
      "2026-11-29T23:30:00-03:00",
      "2026-11-22T23:30:00-03:00",
      "2026-11-23T00:00:00-03:00",
    ]) {
      await repository.addInterview(profileId, applicationId, interview(startsAt));
    }

    await repository.addInterview(
      otherProfileId,
      foreignId,
      interview("2026-11-25T10:00:00-03:00"),
    );

    const range = z
      .object({ start: z.date(), end: z.date() })
      .parse(saoPauloDayRange("2026-11-23", "2026-11-29"));

    const agenda = await repository.interviewsBetween(profileId, range.start, range.end);

    expect(agenda.map((item) => item.startsAt)).toEqual([
      "2026-11-23T03:00:00.000Z",
      "2026-11-30T02:30:00.000Z",
    ]);
    expect(agenda[0]).toEqual({
      id: expect.any(String),
      applicationId,
      startsAt: "2026-11-23T03:00:00.000Z",
      mode: "video",
      with: "Recrutadora",
      notes: "",
      job: { title: "Vaga agenda", company: "Acme" },
    });
  });
});
