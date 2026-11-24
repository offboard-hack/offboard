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

    return job?.id ?? "";
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

  it("allows a new pending job while the same subject is running", async () => {
    const id = await running("resume-1");

    await repository.enqueue("score_resume", "resume-1", {}, start);
    await repository.enqueue("score_resume", "resume-1", {}, start);

    const stored = await rows();

    expect(stored.map((job) => job.status).sort()).toEqual(["pending", "running"]);
    expect(stored.find((job) => job.status === "running")?.id).toBe(id);
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

  it("claims with the current time by default", async () => {
    await repository.enqueue("score_resume", "now");

    const claimed = await repository.claim(1);

    expect(claimed.map((job) => job.subject)).toEqual(["now"]);
    expect(await repository.claim(1)).toEqual([]);
  });

  it("reclaims a running job whose lock expired", async () => {
    const id = await running("stuck");

    expect(await repository.claim(5, minutesAfter(start, 5))).toEqual([]);

    const reclaimed = await repository.claim(5, new Date(minutesAfter(start, 5).getTime() + 1));

    expect(reclaimed).toEqual([expect.objectContaining({ id, attempts: 2 })]);
    expect(await row(id)).toMatchObject({
      status: "running",
      lockedUntil: new Date(minutesAfter(start, 10).getTime() + 1),
    });
  });

  it("never claims finished jobs", async () => {
    const done = await running("done");
    const failed = await running("failed");

    await repository.complete(done);
    await repository.retry(failed, "boom", 3, start);

    expect(await repository.claim(5, minutesAfter(start, 60))).toEqual([]);
  });

  it("completes a running job", async () => {
    const id = await running("resume-1");

    await repository.complete(id);

    expect(await row(id)).toMatchObject({ status: "done", lockedUntil: null, attempts: 1 });
  });

  it("retries with exponential backoff and then fails", async () => {
    const id = await running("resume-1");

    await repository.retry(id, "first failure", 1, start);

    expect(await row(id)).toEqual({
      status: "pending",
      attempts: 1,
      runAfter: minutesAfter(start, 2),
      lockedUntil: null,
      lastError: "first failure",
    });

    await repository.claim(1, minutesAfter(start, 2));
    await repository.retry(id, "second failure", 2, minutesAfter(start, 2));

    expect(await row(id)).toMatchObject({
      status: "pending",
      attempts: 2,
      runAfter: minutesAfter(start, 6),
      lastError: "second failure",
    });

    await repository.claim(1, minutesAfter(start, 6));
    await repository.retry(id, "x".repeat(2_500), 3, minutesAfter(start, 6));

    const failed = await row(id);

    expect(failed).toMatchObject({ status: "failed", attempts: 3, lockedUntil: null });
    expect(failed.lastError).toBe("x".repeat(2_000));
  });

  it("fails a job whose attempts grew past the limit through stale reclaims", async () => {
    const id = await running("stuck");

    await repository.claim(5, minutesAfter(start, 6));
    await repository.claim(5, minutesAfter(start, 12));
    const [fourth] = await repository.claim(5, minutesAfter(start, 18));

    expect(fourth).toMatchObject({ id, attempts: 4 });

    await repository.retry(id, "crashed", fourth.attempts);

    expect(await row(id)).toMatchObject({ status: "failed", lastError: "crashed" });
  });

  it("schedules a retry from the current time by default", async () => {
    const id = await running("resume-1");
    const before = Date.now();

    await repository.retry(id, "boom", 1);

    const retried = await row(id);

    expect(retried.status).toBe("pending");
    expect(retried.runAfter.getTime()).toBeGreaterThanOrEqual(before + 2 * 60_000);
    expect(retried.runAfter.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 60_000);
  });

  it("fails a retried job that a newer pending job supersedes", async () => {
    const id = await running("resume-1");

    await repository.enqueue("score_resume", "resume-1", {}, start);
    await repository.retry(id, "boom", 1, start);

    expect(await row(id)).toMatchObject({ status: "failed", lastError: "boom", lockedUntil: null });
    expect((await rows()).filter((job) => job.status === "pending")).toHaveLength(1);
  });

  it("postpones a job without counting the attempt", async () => {
    const id = await running("resume-1");
    const until = minutesAfter(start, 90);

    await repository.postpone(id, until);

    expect(await row(id)).toEqual({
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
    const id = await running("resume-1");

    await repository.enqueue("score_resume", "resume-1", {}, start);
    await repository.postpone(id, minutesAfter(start, 90));

    expect(await row(id)).toMatchObject({ status: "done", lockedUntil: null });
    expect((await rows()).filter((job) => job.status === "pending")).toHaveLength(1);
  });

  it("leaves jobs that are no longer running untouched", async () => {
    const done = await running("done");
    const failed = await running("failed");

    await repository.complete(done);
    await repository.retry(failed, "boom", 3, start);

    await repository.retry(done, "late", 1, start);
    await repository.postpone(done, start);
    await repository.complete(failed);
    await repository.postpone(failed, start);

    expect(await row(done)).toMatchObject({ status: "done", lastError: null });
    expect(await row(failed)).toMatchObject({ status: "failed", lastError: "boom" });
  });
});
