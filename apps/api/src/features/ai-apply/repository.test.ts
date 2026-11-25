import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  aiApplications,
  applicationEvents,
  applications,
  defaultOrgId,
  jobs,
  offboardingCases,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("ai apply repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

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

  it("rethrows failures other than a duplicate attempt", async () => {
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId: first.id,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    await repos.talent.setAiApplyConsent(created.id, true, new Date());

    await expect(
      repos.aiApply.createAttempt(
        created.id,
        "00000000-0000-4000-8000-000000000001",
        {
          form: { questions: [] },
          draft: [],
          state: "draft",
          reason: null,
          resumeId: "00000000-0000-4000-8000-000000000002",
        },
        new Date(),
      ),
    ).rejects.toThrow();
  });

  it("diagnoses a confirm that lost the race to expiry or a manual application", async () => {
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId: first.id,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    const [job] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "greenhouse",
        sourceKey: "acme:1",
        title: "Backend",
        company: "Acme",
        url: "https://example.com/1",
      })
      .returning({ id: jobs.id });

    const day = 24 * 60 * 60 * 1000;

    const [stale] = await db
      .insert(aiApplications)
      .values({
        profileId: created.id,
        jobId: job.id,
        state: "draft",
        form: { questions: [] },
        draft: [],
        preparedAt: new Date(Date.now() - 8 * day),
      })
      .returning({ id: aiApplications.id });

    const confirmation = { confirmed: [], rehearsal: false, entries: [] };
    const save = async () => undefined;

    expect(await repos.aiApply.confirm(created.id, stale.id, confirmation, new Date(), save)).toBe(
      "expired",
    );

    await db
      .update(aiApplications)
      .set({ preparedAt: new Date() })
      .where(eq(aiApplications.id, stale.id));

    await db.insert(applications).values({ profileId: created.id, jobId: job.id });

    expect(await repos.aiApply.confirm(created.id, stale.id, confirmation, new Date(), save)).toBe(
      "applied",
    );
  });

  async function seedAttempt(state: "queued" | "running" | "submitting") {
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId: first.id,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    const [job] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "greenhouse",
        sourceKey: "acme:7",
        title: "Backend",
        company: "Acme",
        url: "https://example.com/7",
      })
      .returning({ id: jobs.id });

    const [attempt] = await db
      .insert(aiApplications)
      .values({
        profileId: created.id,
        jobId: job.id,
        state,
        form: { questions: [] },
        draft: [],
        confirmed: [],
        preparedAt: new Date(),
      })
      .returning({ id: aiApplications.id });

    return { profileId: created.id, jobId: job.id, id: attempt.id };
  }

  const stateOf = async (id: string) =>
    (await db.select().from(aiApplications).where(eq(aiApplications.id, id)))[0];

  const evidence = { fields: [], files: ["curriculo.pdf"], finalUrl: "https://example.com/7/ok" };

  it("moves to submitting only from running and while no application exists", async () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const queued = await seedAttempt("queued");

    expect(await repos.aiApply.markSubmitting(queued.id, now)).toBe(false);
    expect(await repos.aiApply.claimForRun(queued.id, now)).toBe(true);

    await db.insert(applications).values({ profileId: queued.profileId, jobId: queued.jobId });

    expect(await repos.aiApply.markSubmitting(queued.id, now)).toBe(false);
    expect((await stateOf(queued.id)).state).toBe("running");

    await db.delete(applications);

    expect(await repos.aiApply.markSubmitting(queued.id, now)).toBe(true);
    expect(await stateOf(queued.id)).toMatchObject({ state: "submitting", updatedAt: now });
    expect(await repos.aiApply.claimForRun(queued.id, now)).toBe(false);
  });

  it("records the submission and its application in one step", async () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const { id, profileId, jobId } = await seedAttempt("submitting");

    expect(
      await repos.aiApply.submittedWithApplication(id, { evidence, screenshotKey: "k.png" }, now),
    ).toBe("submitted");
    expect(await stateOf(id)).toMatchObject({
      state: "submitted",
      reason: null,
      evidence,
      screenshotKey: "k.png",
      finishedAt: now,
    });

    const [application] = await db.select().from(applications);

    expect(application).toMatchObject({
      profileId,
      jobId,
      channel: "ai_apply",
      status: "sent",
      publicToken: null,
      appliedAt: now,
      statusChangedAt: now,
      createdAt: now,
    });
    expect(await db.select().from(applicationEvents)).toEqual([
      expect.objectContaining({ applicationId: application.id, status: "sent", createdAt: now }),
    ]);
    expect(
      await repos.aiApply.submittedWithApplication(id, { evidence, screenshotKey: null }, now),
    ).toBe("lost");
    expect(await db.select().from(applications)).toHaveLength(1);
  });

  it("leaves a submission that raced a manual application to be checked", async () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const { id, profileId, jobId } = await seedAttempt("submitting");

    await db.insert(applications).values({ profileId, jobId });

    expect(
      await repos.aiApply.submittedWithApplication(id, { evidence, screenshotKey: "k.png" }, now),
    ).toBe("needs_check");
    expect(await stateOf(id)).toMatchObject({
      state: "needs_check",
      evidence,
      screenshotKey: "k.png",
      finishedAt: null,
    });
    expect(await db.select().from(applications)).toHaveLength(1);
    expect(await db.select().from(applicationEvents)).toEqual([]);
  });

  it("finishes only from the given states", async () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const { id } = await seedAttempt("running");

    expect(
      await repos.aiApply.finish(id, ["queued"], { state: "assisted", reason: "error" }, now),
    ).toBe(false);
    expect(
      await repos.aiApply.finish(
        id,
        ["running"],
        { state: "rehearsed", reason: null, evidence, screenshotKey: "k.png" },
        now,
      ),
    ).toBe(true);
    expect(await stateOf(id)).toMatchObject({
      state: "rehearsed",
      evidence,
      screenshotKey: "k.png",
      finishedAt: now,
    });
  });

  it("lists queued attempts and skips unknown ids", async () => {
    const { id } = await seedAttempt("queued");

    expect(await repos.aiApply.queuedIds()).toEqual([id]);
    expect(await repos.aiApply.runnable("not-a-uuid")).toBeUndefined();
    expect(await repos.aiApply.runnable("00000000-0000-4000-8000-000000000009")).toBeUndefined();
  });
});
