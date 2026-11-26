import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { backgroundJobs } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import { drain, type JobHandler } from "./drain.js";
import type { BackgroundJob, BackgroundRepository, ClaimFilter } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const start = new Date("2026-11-24T12:00:00.000Z");

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

describe.skipIf(!url)("background drain", () => {
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
        subject: backgroundJobs.subject,
        status: backgroundJobs.status,
        attempts: backgroundJobs.attempts,
        runAfter: backgroundJobs.runAfter,
        lockedUntil: backgroundJobs.lockedUntil,
        lastError: backgroundJobs.lastError,
      })
      .from(backgroundJobs)
      .orderBy(asc(backgroundJobs.subject));
  }

  function at(clock: { now: Date }) {
    return {
      ...repository,
      claim: (limit: number, _now?: Date, filter?: ClaimFilter) =>
        repository.claim(limit, clock.now, filter),
      retry: (job: Pick<BackgroundJob, "id" | "attempts">, error: string) =>
        repository.retry(job, error, clock.now),
    } satisfies BackgroundRepository;
  }

  it("claims each job once across concurrent drains", async () => {
    const subjects = Array.from({ length: 10 }, (_, index) => `resume-${index}`);

    for (const subject of subjects) await repository.enqueue("score_resume", subject);

    const warm = await Promise.all([db.$client.connect(), db.$client.connect()]);

    for (const client of warm) client.release();

    const seen: string[] = [];

    const record: JobHandler = async (job) => {
      seen.push(job.subject);
      await delay(5);
    };

    const results = await Promise.all([
      drain(repository, { score_resume: record }),
      drain(repository, { score_resume: record }),
    ]);

    expect(seen.sort()).toEqual([...subjects].sort());
    expect(results.reduce((total, result) => total + result.processed, 0)).toBe(10);
    expect(results.every((result) => result.failed === 0)).toBe(true);
    expect(results.every((result) => result.processed >= 1)).toBe(true);
    expect(await rows()).toEqual(
      subjects
        .sort()
        .map((subject) => expect.objectContaining({ subject, status: "done", attempts: 1 })),
    );
  });

  it("retries then fails a broken job", async () => {
    const clock = { now: start };
    const queue = at(clock);

    await repository.enqueue("broken", "a-broken", {}, start);

    const handlers = {
      broken: async () => {
        throw new Error("model unavailable");
      },
      fine: async () => undefined,
    } satisfies Record<string, JobHandler>;

    await repository.enqueue("fine", "b-fine", {}, start);

    expect(await drain(queue, handlers)).toEqual({ processed: 1, failed: 1 });
    expect(await rows()).toEqual([
      {
        subject: "a-broken",
        status: "pending",
        attempts: 1,
        runAfter: minutesAfter(start, 2),
        lockedUntil: null,
        lastError: "Error: model unavailable",
      },
      expect.objectContaining({ subject: "b-fine", status: "done", attempts: 1 }),
    ]);

    clock.now = minutesAfter(start, 1);

    expect(await drain(queue, handlers)).toEqual({ processed: 0, failed: 0 });

    clock.now = minutesAfter(start, 2);

    expect(await drain(queue, handlers)).toEqual({ processed: 0, failed: 1 });
    expect((await rows())[0]).toMatchObject({
      status: "pending",
      attempts: 2,
      runAfter: minutesAfter(start, 6),
    });

    clock.now = minutesAfter(start, 6);

    expect(await drain(queue, handlers)).toEqual({ processed: 0, failed: 1 });
    expect((await rows())[0]).toEqual({
      subject: "a-broken",
      status: "failed",
      attempts: 3,
      runAfter: minutesAfter(start, 6),
      lockedUntil: null,
      lastError: "Error: model unavailable",
    });

    clock.now = minutesAfter(start, 600);

    expect(await drain(queue, handlers)).toEqual({ processed: 0, failed: 0 });
  });

  it("records a thrown value that is not an error", async () => {
    await repository.enqueue("odd", "resume-1");

    const result = await drain(repository, { odd: () => Promise.reject(42) });

    expect(result).toEqual({ processed: 0, failed: 1 });
    expect((await rows())[0]).toMatchObject({ status: "pending", lastError: "42" });
  });

  it("retries a job of an unknown kind", async () => {
    await repository.enqueue("mystery", "resume-1");
    await repository.enqueue("constructor", "resume-2");

    const result = await drain(repository, { score_resume: async () => undefined });

    expect(result).toEqual({ processed: 0, failed: 2 });
    expect(await rows()).toEqual([
      expect.objectContaining({ status: "pending", attempts: 1, lastError: "Unknown job kind" }),
      expect.objectContaining({ status: "pending", attempts: 1, lastError: "Unknown job kind" }),
    ]);
  });

  it("postpones a job when the handler asks for it", async () => {
    const until = minutesAfter(new Date(), 60);

    await repository.enqueue("capped", "resume-1");

    const seen: BackgroundJob[] = [];

    const result = await drain(repository, {
      capped: async (job) => {
        seen.push(job);

        return { postponeUntil: until };
      },
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(seen).toEqual([expect.objectContaining({ subject: "resume-1", attempts: 1 })]);
    expect(await rows()).toEqual([
      expect.objectContaining({
        status: "pending",
        attempts: 0,
        runAfter: until,
        lockedUntil: null,
      }),
    ]);
  });

  it("drains only the target job when given one", async () => {
    await repository.enqueue("compute_matches", "a-older", {}, minutesAfter(start, -10));
    await repository.enqueue("score_resume", "b-mine");

    const seen: string[] = [];

    const record: JobHandler = async (job) => {
      seen.push(`${job.kind}:${job.subject}`);
    };

    const result = await drain(
      repository,
      { score_resume: record, compute_matches: record },
      { limit: 1, target: { kind: "score_resume", subject: "b-mine" } },
    );

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(seen).toEqual(["score_resume:b-mine"]);
    expect((await rows()).map((job) => [job.subject, job.status])).toEqual([
      ["a-older", "pending"],
      ["b-mine", "done"],
    ]);
  });

  it("drains only the included kinds, or every kind but the excluded ones", async () => {
    await repository.enqueue("ai_apply", "a-apply", {}, minutesAfter(start, -10));
    await repository.enqueue("score_resume", "b-resume");

    const seen: string[] = [];

    const record: JobHandler = async (job) => {
      seen.push(job.kind);
    };

    const handlers = { ai_apply: record, score_resume: record };

    expect(await drain(repository, handlers, { excludeKinds: ["ai_apply"] })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(seen).toEqual(["score_resume"]);
    expect(await drain(repository, handlers, { kinds: ["ai_apply"], limit: 1 })).toEqual({
      processed: 1,
      failed: 0,
    });
    expect(seen).toEqual(["score_resume", "ai_apply"]);
  });

  it("does not count skipped jobs against the limit", async () => {
    for (const [index, subject] of ["a", "b", "c", "d"].entries()) {
      await repository.enqueue("ai_apply", subject, {}, minutesAfter(start, index - 10));
    }

    const seen: string[] = [];

    const result = await drain(
      repository,
      {
        ai_apply: async (job) => {
          seen.push(job.subject);

          return job.subject === "c" ? undefined : { skipped: true };
        },
      },
      { kinds: ["ai_apply"], limit: 1 },
    );

    expect(result).toEqual({ processed: 3, failed: 0 });
    expect(seen).toEqual(["a", "b", "c"]);
    expect((await rows()).map((job) => [job.subject, job.status])).toEqual([
      ["a", "done"],
      ["b", "done"],
      ["c", "done"],
      ["d", "pending"],
    ]);
  });

  it("processes at most five jobs by default", async () => {
    for (let index = 0; index < 6; index += 1) {
      await repository.enqueue("score_resume", `resume-${index}`, {}, minutesAfter(start, index));
    }

    const result = await drain(repository, { score_resume: async () => undefined });

    expect(result).toEqual({ processed: 5, failed: 0 });
    expect((await rows()).map((job) => job.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "pending",
    ]);
  });

  it("stops starting jobs after the budget", async () => {
    for (const [index, subject] of ["a", "b", "c", "d"].entries()) {
      await repository.enqueue("score_resume", subject, {}, minutesAfter(start, index));
    }

    const clock = { elapsed: 0 };
    const seen: string[] = [];

    const result = await drain(
      repository,
      {
        score_resume: async (job) => {
          seen.push(job.subject);
          clock.elapsed += 15_000;
        },
      },
      { now: () => clock.elapsed },
    );

    expect(result).toEqual({ processed: 2, failed: 0 });
    expect(seen).toEqual(["a", "b"]);
    expect((await rows()).map((job) => [job.subject, job.status, job.attempts])).toEqual([
      ["a", "done", 1],
      ["b", "done", 1],
      ["c", "pending", 0],
      ["d", "pending", 0],
    ]);
  });

  it("honours a custom budget", async () => {
    await repository.enqueue("score_resume", "a");
    await repository.enqueue("score_resume", "b");

    const result = await drain(
      repository,
      { score_resume: async () => undefined },
      { budgetMs: 0 },
    );

    expect(result).toEqual({ processed: 0, failed: 0 });
    expect((await rows()).map((job) => [job.status, job.attempts])).toEqual([
      ["pending", 0],
      ["pending", 0],
    ]);
  });
});
