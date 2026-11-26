import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  aiApplications,
  applicationEvents,
  applications,
  defaultOrgId,
  jobs,
  offboardingCases,
  resumes,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import type { SaveProfile } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";

const resumeContent = {
  headline: { id: "h", text: "Engenheira" },
  summary: { id: "s", text: "Backend" },
  experiences: [],
  education: [],
  skills: [],
  languages: [],
  contact: { email: null, phone: null, city: null, links: [] },
};

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

    const confirmation = { confirmed: [], rehearsal: false, entries: [], profile: {} };
    const save = { answer: async () => undefined, profile: async () => undefined };

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

  async function seedAttempt(
    state: "queued" | "running" | "submitting" | "needs_check" | "rehearsed",
    updatedAt = new Date(),
  ) {
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
        updatedAt,
      })
      .returning({ id: aiApplications.id });

    await repos.talent.setAiApplyConsent(created.id, true, new Date());

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

    await db
      .update(talentProfiles)
      .set({ aiApplyConsentAt: null })
      .where(eq(talentProfiles.id, queued.profileId));

    expect(await repos.aiApply.markSubmitting(queued.id, now)).toBe(false);

    await repos.talent.setAiApplyConsent(queued.profileId, true, new Date());

    expect(await repos.aiApply.markSubmitting(queued.id, now)).toBe(true);
    expect(await stateOf(queued.id)).toMatchObject({ state: "submitting", updatedAt: now });
    expect(await repos.aiApply.claimForRun(queued.id, now)).toBe(false);
  });

  it("lets only one markSubmitting win on the same attempt", async () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const { id } = await seedAttempt("running");

    expect(await repos.aiApply.markSubmitting(id, now)).toBe(true);
    expect(await repos.aiApply.markSubmitting(id, now)).toBe(false);
    expect((await stateOf(id)).state).toBe("submitting");
  });

  it("reclaims a running attempt only once its last update is five minutes old", async () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const { id } = await seedAttempt("running", new Date(now.getTime() - 5 * 60_000));

    expect(await repos.aiApply.claimForRun(id, now)).toBe(false);
    expect(await repos.aiApply.claimForRun(id, new Date(now.getTime() + 1))).toBe(true);
    expect(await repos.aiApply.claimForRun(id, new Date(now.getTime() + 2))).toBe(false);
  });

  it("sweeps attempts stuck in submitting or running for fifteen minutes", async () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const old = new Date(now.getTime() - 15 * 60_000 - 1);
    const fresh = new Date(now.getTime() - 15 * 60_000);
    const stuck = await seedAttempt("submitting", old);

    await db
      .update(aiApplications)
      .set({ updatedAt: fresh, state: "running" })
      .where(eq(aiApplications.id, stuck.id));

    expect(await repos.aiApply.sweepStale(now)).toBeUndefined();
    expect((await stateOf(stuck.id)).state).toBe("running");

    await db.update(aiApplications).set({ updatedAt: old }).where(eq(aiApplications.id, stuck.id));
    await repos.aiApply.sweepStale(now);

    expect(await stateOf(stuck.id)).toMatchObject({
      state: "assisted",
      reason: "error",
      finishedAt: now,
      updatedAt: now,
    });

    await db
      .update(aiApplications)
      .set({ state: "submitting", reason: null, finishedAt: null, updatedAt: fresh })
      .where(eq(aiApplications.id, stuck.id));
    await repos.aiApply.sweepStale(now);

    expect((await stateOf(stuck.id)).state).toBe("submitting");

    await db.update(aiApplications).set({ updatedAt: old }).where(eq(aiApplications.id, stuck.id));
    await repos.aiApply.sweepStale(now);

    expect(await stateOf(stuck.id)).toMatchObject({
      state: "needs_check",
      reason: null,
      finishedAt: null,
      updatedAt: now,
    });
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

  describe("resolving an unconfirmed submission", () => {
    const now = new Date("2026-11-25T12:00:00.000Z");

    it("records the application and the submission when the person says it was sent", async () => {
      const { id, profileId, jobId } = await seedAttempt("needs_check");

      await db
        .update(aiApplications)
        .set({ evidence, screenshotKey: "k.png" })
        .where(eq(aiApplications.id, id));

      const view = await repos.aiApply.check(profileId, id, true, now);

      expect(view).toMatchObject({ id, state: "submitted", reason: null, hasScreenshot: true });
      expect(await stateOf(id)).toMatchObject({
        state: "submitted",
        reason: null,
        finishedAt: now,
        updatedAt: now,
        evidence,
        screenshotKey: "k.png",
      });

      const [application] = await db.select().from(applications);

      expect(application).toMatchObject({
        profileId,
        jobId,
        channel: "ai_apply",
        status: "sent",
        appliedAt: now,
        statusChangedAt: now,
      });
      expect(await db.select().from(applicationEvents)).toEqual([
        expect.objectContaining({ applicationId: application.id, status: "sent", createdAt: now }),
      ]);
    });

    it("uses the résumé of the attempt for the application", async () => {
      const { id, profileId } = await seedAttempt("needs_check");

      const [resume] = await db
        .insert(resumes)
        .values({ profileId, kind: "base", content: resumeContent })
        .returning({ id: resumes.id });

      await db.update(aiApplications).set({ resumeId: resume.id }).where(eq(aiApplications.id, id));
      await repos.aiApply.check(profileId, id, true, now);

      expect((await db.select().from(applications))[0]).toMatchObject({ resumeId: resume.id });
    });

    it("only marks the attempt submitted when the person already has an application", async () => {
      const { id, profileId, jobId } = await seedAttempt("needs_check");

      await db.insert(applications).values({ profileId, jobId });

      expect(await repos.aiApply.check(profileId, id, true, now)).toMatchObject({
        state: "submitted",
      });
      expect(await db.select().from(applications)).toHaveLength(1);
      expect(await db.select().from(applicationEvents)).toEqual([]);
    });

    it("closes the attempt as assisted when the person says it was not sent", async () => {
      const { id, profileId } = await seedAttempt("needs_check");

      expect(await repos.aiApply.check(profileId, id, false, now)).toMatchObject({
        state: "assisted",
        reason: "not_sent",
      });
      expect(await stateOf(id)).toMatchObject({
        state: "assisted",
        reason: "not_sent",
        finishedAt: now,
        updatedAt: now,
      });
      expect(await db.select().from(applications)).toEqual([]);
    });

    it("refuses attempts that are not waiting for a check, foreign or malformed ids", async () => {
      const { id, profileId } = await seedAttempt("submitting");

      expect(await repos.aiApply.check(profileId, id, true, now)).toBe("nothing_to_check");
      expect(await repos.aiApply.check(profileId, id, false, now)).toBe("nothing_to_check");
      expect(await repos.aiApply.check(profileId, missingId, true, now)).toBe("not_found");
      expect(await repos.aiApply.check(missingId, id, true, now)).toBe("not_found");
      expect(await repos.aiApply.check(profileId, "not-a-uuid", true, now)).toBe("not_found");
      expect((await stateOf(id)).state).toBe("submitting");
      expect(await db.select().from(applications)).toEqual([]);
    });

    it("resolves a check only once", async () => {
      const { id, profileId } = await seedAttempt("needs_check");

      const results = await Promise.all([
        repos.aiApply.check(profileId, id, true, now),
        repos.aiApply.check(profileId, id, true, now),
      ]);

      expect(results.filter((result) => result === "nothing_to_check")).toHaveLength(1);
      expect(await db.select().from(applications)).toHaveLength(1);
      expect(await db.select().from(applicationEvents)).toHaveLength(1);
    });
  });

  describe("the live view", () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const old = new Date(now.getTime() - 16 * 60_000);
    const live = "https://www.browserbase.com/devtools-fullscreen/inspector.html?navbar=false";

    const liveOf = async (id: string) => (await stateOf(id)).liveUrl;

    it("stores the live view only while running and keeps it while submitting", async () => {
      const { id } = await seedAttempt("queued");

      await repos.aiApply.showLive(id, live);
      expect(await liveOf(id)).toBeNull();

      await repos.aiApply.claimForRun(id, now);
      await repos.aiApply.showLive(id, live);
      expect(await liveOf(id)).toBe(live);

      expect(await repos.aiApply.markSubmitting(id, now)).toBe(true);
      await repos.aiApply.showLive(id, "https://www.browserbase.com/other");
      expect(await liveOf(id)).toBe(live);
    });

    type Seeded = Awaited<ReturnType<typeof seedAttempt>>;

    const writes: [string, Parameters<typeof seedAttempt>[0], (seeded: Seeded) => Promise<void>][] =
      [
        [
          "finish",
          "running",
          async ({ id }) => {
            await repos.aiApply.finish(
              id,
              ["running"],
              { state: "assisted", reason: "error" },
              now,
            );
          },
        ],
        [
          "requeue",
          "running",
          async ({ id }) => {
            await repos.aiApply.requeue(id, now);
          },
        ],
        [
          "reclaim of a stale run",
          "running",
          async ({ id }) => {
            await repos.aiApply.claimForRun(id, now);
          },
        ],
        [
          "submission",
          "submitting",
          async ({ id }) => {
            await repos.aiApply.submittedWithApplication(
              id,
              { evidence, screenshotKey: null },
              now,
            );
          },
        ],
        [
          "submission that raced a manual application",
          "submitting",
          async (seeded) => {
            await db
              .insert(applications)
              .values({ profileId: seeded.profileId, jobId: seeded.jobId });
            await repos.aiApply.submittedWithApplication(
              seeded.id,
              { evidence, screenshotKey: null },
              now,
            );
          },
        ],
        [
          "sweep of a stuck run",
          "running",
          async () => {
            await repos.aiApply.sweepStale(now);
          },
        ],
        [
          "sweep of a stuck submission",
          "submitting",
          async () => {
            await repos.aiApply.sweepStale(now);
          },
        ],
        [
          "cancel",
          "queued",
          async ({ id, profileId }) => {
            await repos.aiApply.cancel(profileId, id, now);
          },
        ],
        [
          "check that it was sent",
          "needs_check",
          async ({ id, profileId }) => {
            await repos.aiApply.check(profileId, id, true, now);
          },
        ],
        [
          "check that it was not sent",
          "needs_check",
          async ({ id, profileId }) => {
            await repos.aiApply.check(profileId, id, false, now);
          },
        ],
        [
          "confirm of a rehearsal",
          "rehearsed",
          async ({ id, profileId }) => {
            await db
              .update(aiApplications)
              .set({ finishedAt: new Date(now.getTime() - 60_000) })
              .where(eq(aiApplications.id, id));
            await repos.aiApply.confirm(
              profileId,
              id,
              { confirmed: [], rehearsal: true, entries: [], profile: {} },
              now,
              { answer: async () => undefined, profile: async () => undefined },
            );
          },
        ],
      ];

    it.each(writes)("clears the live view on %s", async (_name, state, write) => {
      const seeded = await seedAttempt(state, old);

      await db
        .update(aiApplications)
        .set({ liveUrl: live })
        .where(eq(aiApplications.id, seeded.id));
      await write(seeded);

      const row = await stateOf(seeded.id);

      expect(row.updatedAt).toEqual(now);
      expect(row.liveUrl).toBeNull();
    });
  });

  describe("confirming a rehearsed attempt again", () => {
    const confirmation = { confirmed: [], rehearsal: false, entries: [], profile: {} };
    const save = { answer: async () => undefined, profile: async () => undefined };
    const day = 24 * 60 * 60 * 1000;
    const now = new Date("2026-11-25T12:00:00.000Z");

    async function rehearsed(finishedAt: Date) {
      const seeded = await seedAttempt("rehearsed");

      await db
        .update(aiApplications)
        .set({ evidence, screenshotKey: "k.png", finishedAt, reason: null })
        .where(eq(aiApplications.id, seeded.id));

      return seeded;
    }

    it("queues it with the new answers and clears the old rehearsal evidence", async () => {
      const { id, profileId } = await rehearsed(new Date(now.getTime() - 6 * day));

      const result = await repos.aiApply.confirm(
        profileId,
        id,
        {
          confirmed: [{ questionId: "q", value: "x" }],
          rehearsal: false,
          entries: [],
          profile: {},
        },
        now,
        save,
      );

      expect(result).toMatchObject({ id, state: "queued", rehearsal: false, hasScreenshot: false });
      expect(await stateOf(id)).toMatchObject({
        state: "queued",
        confirmed: [{ questionId: "q", value: "x" }],
        confirmedAt: now,
        finishedAt: null,
        evidence: null,
        screenshotKey: null,
      });
    });

    it("saves the typed profile values in the confirm transaction, only when it confirms", async () => {
      const { id, profileId } = await rehearsed(new Date(now.getTime() - day));
      const saved: unknown[] = [];

      const profile = { phone: "11 99999-8888" };

      const record: SaveProfile = async (_tx, owner, values, at) => {
        saved.push([owner, values, at]);
      };

      const recording = { answer: async () => undefined, profile: record };

      await repos.aiApply.confirm(profileId, id, { ...confirmation, profile }, now, recording);

      expect(saved).toEqual([[profileId, profile, now]]);

      await repos.aiApply.confirm(profileId, id, { ...confirmation, profile }, now, recording);

      expect(saved).toHaveLength(1);
    });

    it("rolls the confirm back when the profile cannot be saved", async () => {
      const { id, profileId } = await rehearsed(new Date(now.getTime() - day));

      const failing = {
        answer: async () => undefined,
        profile: async () => {
          throw new Error("profile write failed");
        },
      };

      await expect(
        repos.aiApply.confirm(
          profileId,
          id,
          { ...confirmation, profile: { city: "Santos" } },
          now,
          failing,
        ),
      ).rejects.toThrow("profile write failed");
      expect((await stateOf(id)).state).toBe("rehearsed");
    });

    it("counts the seven days from the end of the rehearsal", async () => {
      const { id, profileId } = await rehearsed(new Date(now.getTime() - 7 * day));

      expect(await repos.aiApply.confirm(profileId, id, confirmation, now, save)).toBe("expired");
      expect((await stateOf(id)).state).toBe("rehearsed");

      await db
        .update(aiApplications)
        .set({ preparedAt: new Date(now.getTime() - 30 * day), finishedAt: null })
        .where(eq(aiApplications.id, id));

      expect(await repos.aiApply.confirm(profileId, id, confirmation, now, save)).toBe("expired");
    });

    it("refuses a rehearsed attempt of someone who already applied", async () => {
      const { id, profileId, jobId } = await rehearsed(new Date(now.getTime() - day));

      await db.insert(applications).values({ profileId, jobId });

      expect(await repos.aiApply.confirm(profileId, id, confirmation, now, save)).toBe("applied");
    });

    it("reports an attempt that another one already holds for the job", async () => {
      const { id, profileId, jobId } = await rehearsed(new Date(now.getTime() - day));

      await db.insert(aiApplications).values({
        profileId,
        jobId,
        state: "draft",
        form: { questions: [] },
        draft: [],
        preparedAt: now,
      });

      expect(await repos.aiApply.confirm(profileId, id, confirmation, now, save)).toBe(
        "in_progress",
      );
      expect((await stateOf(id)).state).toBe("rehearsed");
    });

    it.each(["needs_check", "submitted", "assisted", "cancelled"] as const)(
      "never confirms a %s attempt",
      async (state) => {
        const { id, profileId } = await seedAttempt("needs_check");

        await db.update(aiApplications).set({ state }).where(eq(aiApplications.id, id));

        expect(await repos.aiApply.confirm(profileId, id, confirmation, now, save)).toBe(
          "in_progress",
        );
        expect((await stateOf(id)).state).toBe(state);
      },
    );
  });
});
