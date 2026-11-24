import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { backgroundJobs } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const start = new Date("2026-11-24T12:00:00.000Z");

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

describe.skipIf(!url)("background repository", () => {
  const db = createClient(url ?? "");
  const repository = createRepositories(db).background;

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

  async function rows() {
    return db
      .select({
        id: backgroundJobs.id,
        kind: backgroundJobs.kind,
        subject: backgroundJobs.subject,
        payload: backgroundJobs.payload,
        status: backgroundJobs.status,
        attempts: backgroundJobs.attempts,
        runAfter: backgroundJobs.runAfter,
        lockedUntil: backgroundJobs.lockedUntil,
        lastError: backgroundJobs.lastError,
        updatedAt: backgroundJobs.updatedAt,
      })
      .from(backgroundJobs)
      .orderBy(asc(backgroundJobs.createdAt), asc(backgroundJobs.runAfter));
  }

  async function row(id: string) {
    const [found] = await db
      .select({
        status: backgroundJobs.status,
        attempts: backgroundJobs.attempts,
        runAfter: backgroundJobs.runAfter,
        lockedUntil: backgroundJobs.lockedUntil,
        lastError: backgroundJobs.lastError,
      })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.id, id));

    return found;
  }

  async function running(subject: string, attempts = 1) {
    await repository.enqueue("score_resume", subject, {}, start);

    const claimed = await repository.claim(10, start);
    const job = claimed.find((candidate) => candidate.subject === subject);

    expect(job).toMatchObject({ attempts });

    return { id: job?.id ?? "", attempts };
  }

  async function fail(id: string) {
    await db
      .update(backgroundJobs)
      .set({ status: "failed", lockedUntil: null, lastError: "boom" })
      .where(eq(backgroundJobs.id, id));
  }

  async function lockWait() {
    for (;;) {
      const { rows: waiting } = await db.$client.query<{ count: number }>(
        "select count(*)::int as count from pg_locks where not granted",
      );

      if (waiting[0].count > 0) return;

      await delay(5);
    }
  }

  async function withRacingTwin(subject: string, finish: () => Promise<void>) {
    const client = await db.$client.connect();

    try {
      await client.query("begin");
      await client.query(
        "insert into background_jobs (kind, subject, run_after) values ('score_resume', $1, now())",
        [subject],
      );

      const finishing = finish();

      await lockWait();
      await client.query("commit");
      await finishing;
    } finally {
      client.release();
    }
  }

  it("enqueues one pending job per kind and subject", async () => {
    const before = Date.now();

    await repository.enqueue("score_resume", "resume-1", { reason: "upload" });
    await repository.enqueue("score_resume", "resume-1", { reason: "edit" });
    await repository.enqueue("score_resume", "resume-2");
    await repository.enqueue("other_kind", "resume-1", {}, start);

    const stored = await rows();

    expect(stored).toHaveLength(3);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "score_resume",
          subject: "resume-1",
          payload: { reason: "upload" },
          status: "pending",
          attempts: 0,
          lockedUntil: null,
          lastError: null,
        }),
        expect.objectContaining({ kind: "score_resume", subject: "resume-2", payload: {} }),
        expect.objectContaining({ kind: "other_kind", subject: "resume-1", runAfter: start }),
      ]),
    );

    const upload = stored.find((job) => job.payload.reason === "upload");

    expect(upload?.runAfter.getTime()).toBeGreaterThanOrEqual(before);
    expect(upload?.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("enqueues many subjects at once, keeping existing pending jobs", async () => {
    await repository.enqueue("compute_matches", "profile-0", { reason: "edit" }, start);

    const subjects = Array.from({ length: 2_001 }, (_, index) => `profile-${index}`);

    await repository.enqueueMany("compute_matches", [...subjects, "profile-1"]);
    await repository.enqueueMany("compute_matches", []);

    const stored = await rows();

    expect(stored).toHaveLength(2_001);
    expect(new Set(stored.map((job) => job.subject))).toEqual(new Set(subjects));
    expect(stored.every((job) => job.kind === "compute_matches" && job.status === "pending")).toBe(
      true,
    );
    expect(stored.find((job) => job.subject === "profile-0")).toMatchObject({
      payload: { reason: "edit" },
      runAfter: start,
    });
  });

  it("allows a new pending job while the same subject is running", async () => {
    const job = await running("resume-1");

    await repository.enqueue("score_resume", "resume-1", {}, start);
    await repository.enqueue("score_resume", "resume-1", {}, start);

    const stored = await rows();

    expect(stored.map((stored) => stored.status).sort()).toEqual(["pending", "running"]);
    expect(stored.find((stored) => stored.status === "running")?.id).toBe(job.id);
  });

  it("claims due jobs in run order and locks them for five minutes", async () => {
    await repository.enqueue("score_resume", "later", { n: 2 }, minutesAfter(start, -1));
    await repository.enqueue("score_resume", "first", { n: 1 }, minutesAfter(start, -10));
    await repository.enqueue("score_resume", "future", {}, minutesAfter(start, 1));
    await repository.enqueue("score_resume", "third", {}, start);

    const claimed = await repository.claim(2, start);

    expect(claimed).toEqual([
      {
        id: expect.any(String),
        kind: "score_resume",
        subject: "first",
        payload: { n: 1 },
        attempts: 1,
      },
      {
        id: expect.any(String),
        kind: "score_resume",
        subject: "later",
        payload: { n: 2 },
        attempts: 1,
      },
    ]);

    for (const job of claimed) {
      expect(await row(job.id)).toMatchObject({
        status: "running",
        attempts: 1,
        lockedUntil: minutesAfter(start, 5),
      });
    }

    const stored = await rows();

    expect(stored.find((job) => job.subject === "first")?.updatedAt).toEqual(start);

    const rest = await repository.claim(5, start);

    expect(rest.map((job) => job.subject)).toEqual(["third"]);
    expect(await repository.claim(5, start)).toEqual([]);
  });

  it("breaks run order ties by id", async () => {
    for (const subject of ["a", "b", "c", "d"]) {
      await repository.enqueue("score_resume", subject, {}, start);
    }

    const ids = (await rows()).map((job) => job.id).sort();

    expect((await repository.claim(2, start)).map((job) => job.id)).toEqual(ids.slice(0, 2));
    expect((await repository.claim(2, start)).map((job) => job.id)).toEqual(ids.slice(2));
  });

  it("claims with the current time by default", async () => {
    await repository.enqueue("score_resume", "now");

    const claimed = await repository.claim(1);

    expect(claimed.map((job) => job.subject)).toEqual(["now"]);
    expect(await repository.claim(1)).toEqual([]);
  });

  it("reclaims a running job whose lock expired", async () => {
    const job = await running("stuck");

    expect(await repository.claim(5, minutesAfter(start, 5))).toEqual([]);

    const reclaimed = await repository.claim(5, new Date(minutesAfter(start, 5).getTime() + 1));

    expect(reclaimed).toEqual([expect.objectContaining({ id: job.id, attempts: 2 })]);
    expect(await row(job.id)).toMatchObject({
      status: "running",
      lockedUntil: new Date(minutesAfter(start, 10).getTime() + 1),
    });
  });

  it("fails a job that stopped while running three times and claims the next one", async () => {
    await repository.enqueue("score_resume", "poison", {}, minutesAfter(start, -10));
    await repository.enqueue("score_resume", "next", {}, start);

    const [first] = await repository.claim(1, start);
    const [second] = await repository.claim(1, minutesAfter(start, 6));
    const [third] = await repository.claim(1, minutesAfter(start, 12));

    expect([first, second, third]).toEqual([
      expect.objectContaining({ subject: "poison", attempts: 1 }),
      expect.objectContaining({ subject: "poison", attempts: 2 }),
      expect.objectContaining({ subject: "poison", attempts: 3 }),
    ]);

    expect(await repository.claim(1, minutesAfter(start, 18))).toEqual([
      expect.objectContaining({ subject: "next", attempts: 1 }),
    ]);
    expect(await row(first.id)).toEqual({
      status: "failed",
      attempts: 3,
      runAfter: minutesAfter(start, -10),
      lockedUntil: null,
      lastError: "Stopped while running",
    });
  });

  it("claims only the target kind and subject when given one", async () => {
    const target = { kind: "score_resume", subject: "mine" };

    await repository.enqueue("compute_matches", "older", {}, minutesAfter(start, -10));
    await repository.enqueue("compute_matches", "mine", {}, minutesAfter(start, -5));
    await repository.enqueue("score_resume", "other", {}, minutesAfter(start, -4));

    expect(await repository.claim(5, start, target)).toEqual([]);

    await repository.enqueue("score_resume", "mine", { n: 1 }, start);

    expect(await repository.claim(5, start, target)).toEqual([
      {
        id: expect.any(String),
        kind: "score_resume",
        subject: "mine",
        payload: { n: 1 },
        attempts: 1,
      },
    ]);
    expect(await repository.claim(5, start, target)).toEqual([]);
    expect((await rows()).map((job) => [job.kind, job.subject, job.status])).toEqual([
      ["compute_matches", "older", "pending"],
      ["compute_matches", "mine", "pending"],
      ["score_resume", "other", "pending"],
      ["score_resume", "mine", "running"],
    ]);
  });

  it("reclaims or fails a stale target and leaves other stale jobs alone", async () => {
    const target = { kind: "score_resume", subject: "stuck" };
    const job = await running("stuck");
    const other = await running("other");

    const [reclaimed] = await repository.claim(1, minutesAfter(start, 6), target);

    expect(reclaimed).toMatchObject({ id: job.id, attempts: 2 });
    expect(await repository.claim(1, minutesAfter(start, 12), target)).toEqual([
      expect.objectContaining({ id: job.id, attempts: 3 }),
    ]);
    expect(await repository.claim(1, minutesAfter(start, 18), target)).toEqual([]);
    expect(await row(job.id)).toMatchObject({
      status: "failed",
      lastError: "Stopped while running",
    });
    expect(await row(other.id)).toMatchObject({ status: "running", attempts: 1 });
  });

  it("never claims finished jobs", async () => {
    const done = await running("done");
    const failed = await running("failed");

    await repository.complete(done);
    await fail(failed.id);

    expect(await repository.claim(5, minutesAfter(start, 60))).toEqual([]);
  });

  it("completes a running job", async () => {
    const job = await running("resume-1");

    await repository.complete(job);

    expect(await row(job.id)).toMatchObject({ status: "done", lockedUntil: null, attempts: 1 });
  });

  it("retries with exponential backoff and then fails", async () => {
    const job = await running("resume-1");

    await repository.retry(job, "first failure", start);

    expect(await row(job.id)).toEqual({
      status: "pending",
      attempts: 1,
      runAfter: minutesAfter(start, 2),
      lockedUntil: null,
      lastError: "first failure",
    });

    const [second] = await repository.claim(1, minutesAfter(start, 2));

    await repository.retry(second, "second failure", minutesAfter(start, 2));

    expect(await row(job.id)).toMatchObject({
      status: "pending",
      attempts: 2,
      runAfter: minutesAfter(start, 6),
      lastError: "second failure",
    });

    const [third] = await repository.claim(1, minutesAfter(start, 6));

    await repository.retry(third, "x".repeat(2_500), minutesAfter(start, 6));

    const failed = await row(job.id);

    expect(failed).toMatchObject({ status: "failed", attempts: 3, lockedUntil: null });
    expect(failed.lastError).toBe("x".repeat(2_000));
  });

  it("schedules a retry from the current time by default", async () => {
    const job = await running("resume-1");
    const before = Date.now();

    await repository.retry(job, "boom");

    const retried = await row(job.id);

    expect(retried.status).toBe("pending");
    expect(retried.runAfter.getTime()).toBeGreaterThanOrEqual(before + 2 * 60_000);
    expect(retried.runAfter.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 60_000);
  });

  it("fails a retried job that a newer pending job supersedes", async () => {
    const job = await running("resume-1");

    await repository.enqueue("score_resume", "resume-1", {}, start);
    await repository.retry(job, "boom", start);

    expect(await row(job.id)).toMatchObject({
      status: "failed",
      lastError: "boom",
      lockedUntil: null,
    });
    expect((await rows()).filter((stored) => stored.status === "pending")).toHaveLength(1);
  });

  it("postpones a job without counting the attempt", async () => {
    const job = await running("resume-1");
    const until = minutesAfter(start, 90);

    await repository.postpone(job, until);

    expect(await row(job.id)).toEqual({
      status: "pending",
      attempts: 0,
      runAfter: until,
      lockedUntil: null,
      lastError: null,
    });
    expect(await repository.claim(5, minutesAfter(start, 89))).toEqual([]);
    expect(await repository.claim(5, until)).toEqual([expect.objectContaining({ attempts: 1 })]);
  });

  it("completes a postponed job that a newer pending job supersedes", async () => {
    const job = await running("resume-1");

    await repository.enqueue("score_resume", "resume-1", {}, start);
    await repository.postpone(job, minutesAfter(start, 90));

    expect(await row(job.id)).toMatchObject({ status: "done", lockedUntil: null });
    expect((await rows()).filter((stored) => stored.status === "pending")).toHaveLength(1);
  });

  it("treats a pending twin that races the requeue as superseding the job", async () => {
    const retried = await running("retried");
    const postponed = await running("postponed");

    await withRacingTwin("retried", () => repository.retry(retried, "boom", start));
    await withRacingTwin("postponed", () =>
      repository.postpone(postponed, minutesAfter(start, 90)),
    );

    expect(await row(retried.id)).toMatchObject({ status: "failed", lastError: "boom" });
    expect(await row(postponed.id)).toMatchObject({ status: "done", attempts: 1 });
    expect((await rows()).filter((stored) => stored.status === "pending")).toHaveLength(2);
  });

  it("propagates database errors other than a pending twin", async () => {
    await expect(repository.retry({ id: "not-a-uuid", attempts: 1 }, "boom")).rejects.toThrow();
    await expect(repository.postpone({ id: "not-a-uuid", attempts: 1 }, start)).rejects.toThrow();
  });

  it("ignores a finisher whose claim was taken over", async () => {
    const stale = await running("resume-1");
    const [current] = await repository.claim(1, minutesAfter(start, 6));

    expect(current).toMatchObject({ id: stale.id, attempts: 2 });

    await repository.complete(stale);
    await repository.retry(stale, "late", minutesAfter(start, 7));
    await repository.postpone(stale, minutesAfter(start, 90));

    expect(await row(stale.id)).toEqual({
      status: "running",
      attempts: 2,
      runAfter: start,
      lockedUntil: minutesAfter(start, 11),
      lastError: null,
    });

    await repository.complete(current);

    expect(await row(stale.id)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("leaves jobs that are no longer running untouched", async () => {
    const done = await running("done");
    const failed = await running("failed");

    await repository.complete(done);
    await fail(failed.id);

    await repository.retry(done, "late", start);
    await repository.postpone(done, start);
    await repository.complete(failed);
    await repository.postpone(failed, start);

    expect(await row(done.id)).toMatchObject({ status: "done", lastError: null });
    expect(await row(failed.id)).toMatchObject({ status: "failed", lastError: "boom" });
  });
});
