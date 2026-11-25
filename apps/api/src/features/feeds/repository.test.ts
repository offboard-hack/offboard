import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { jobFeeds, jobs } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFeedsRepository } from "./repository.js";
import type { FeedJob } from "./sources.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const day = 24 * 60 * 60_000;
const start = new Date("2026-11-01T12:00:00.000Z");
const at = (days: number) => new Date(start.getTime() + days * day);

const feedJob = (sourceKey: string, fields: Partial<FeedJob> = {}) =>
  ({
    sourceKey,
    title: `Vaga ${sourceKey}`,
    company: "Acme",
    workModel: "remote",
    city: "São Paulo",
    state: "SP",
    url: `https://boards.example.com/${sourceKey}`,
    description: `Descrição ${sourceKey}`,
    postedAt: new Date("2026-10-30T10:00:00.000Z"),
    ...fields,
  }) satisfies FeedJob;

describe.skipIf(!url)("feeds repository", () => {
  const db = createClient(url ?? "");
  const feeds = createFeedsRepository(db);

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

  async function created(provider: "greenhouse" | "lever", board: string) {
    const feed = await feeds.create({ provider, board, companyLabel: null });

    if (feed === "exists") throw new Error("feed exists");

    return feed;
  }

  function jobsOf(source: string) {
    return db
      .select({
        sourceKey: jobs.sourceKey,
        origin: jobs.origin,
        title: jobs.title,
        description: jobs.description,
        closedAt: jobs.closedAt,
        lastSeenAt: jobs.lastSeenAt,
      })
      .from(jobs)
      .where(eq(jobs.source, source))
      .orderBy(asc(jobs.sourceKey));
  }

  it("creates, lists, updates and removes feeds", async () => {
    const feed = await feeds.create({ provider: "lever", board: "acme", companyLabel: "Acme" });

    expect(feed).toEqual({
      id: expect.any(String),
      provider: "lever",
      board: "acme",
      companyLabel: "Acme",
      enabled: true,
      lastSyncedAt: null,
      lastError: null,
      openJobs: 0,
    });

    expect(await feeds.create({ provider: "lever", board: "acme", companyLabel: null })).toBe(
      "exists",
    );

    if (feed === "exists") throw new Error("feed exists");

    const other = await created("greenhouse", "acme");

    expect((await feeds.list()).map((row) => row.id)).toEqual([other.id, feed.id]);
    expect(await feeds.get(feed.id)).toEqual(feed);

    expect(await feeds.update(feed.id, { enabled: false, companyLabel: null })).toMatchObject({
      enabled: false,
      companyLabel: null,
    });
    expect(await feeds.update(feed.id, { companyLabel: "Acme Brasil" })).toMatchObject({
      enabled: false,
      companyLabel: "Acme Brasil",
    });

    const missing = crypto.randomUUID();

    expect(await feeds.update(missing, { enabled: true })).toBeUndefined();
    expect(await feeds.get(missing)).toBeUndefined();

    await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start);

    expect(await feeds.remove(feed.id)).toBe(true);
    expect(await feeds.remove(feed.id)).toBe(false);
    expect(await feeds.get(feed.id)).toBeUndefined();
    expect(await jobsOf("lever")).toMatchObject([{ sourceKey: "acme:1", closedAt: null }]);
  });

  it("rethrows unexpected errors when creating a feed", async () => {
    await expect(
      feeds.create({ provider: "lever", board: "Not Valid", companyLabel: null }),
    ).rejects.toThrow();
  });

  it("imports a feed and counts created, updated and skipped jobs", async () => {
    const feed = await created("greenhouse", "acme");

    expect(
      await feeds.sync(
        feed.id,
        { jobs: [feedJob("acme:1"), feedJob("acme:2"), feedJob("acme:2")], skipped: 3 },
        start,
      ),
    ).toEqual({ created: 2, updated: 0, closed: 0, skipped: 3 });

    expect(
      await feeds.sync(
        feed.id,
        {
          jobs: [
            feedJob("acme:1", { title: "Engenheira de Dados", description: "Nova descrição" }),
            feedJob("acme:2", { title: "Analista de Dados", description: "Outra descrição" }),
            feedJob("acme:3"),
          ],
          skipped: 0,
        },
        at(1),
      ),
    ).toEqual({ created: 1, updated: 2, closed: 0, skipped: 0 });

    expect(await jobsOf("greenhouse")).toEqual([
      {
        sourceKey: "acme:1",
        origin: "external",
        title: "Engenheira de Dados",
        description: "Nova descrição",
        closedAt: null,
        lastSeenAt: at(1),
      },
      {
        sourceKey: "acme:2",
        origin: "external",
        title: "Analista de Dados",
        description: "Outra descrição",
        closedAt: null,
        lastSeenAt: at(1),
      },
      {
        sourceKey: "acme:3",
        origin: "external",
        title: "Vaga acme:3",
        description: "Descrição acme:3",
        closedAt: null,
        lastSeenAt: at(1),
      },
    ]);

    expect(await feeds.get(feed.id)).toMatchObject({
      lastSyncedAt: at(1).toISOString(),
      lastError: null,
      openJobs: 3,
    });
  });

  it("imports large feeds in chunks", async () => {
    const feed = await created("lever", "big");
    const many = Array.from({ length: 1_201 }, (_, index) => feedJob(`big:${index}`));

    expect(await feeds.sync(feed.id, { jobs: many, skipped: 0 }, start)).toEqual({
      created: 1_201,
      updated: 0,
      closed: 0,
      skipped: 0,
    });
    expect((await feeds.get(feed.id))?.openJobs).toBe(1_201);
  });

  it("keeps jobs when a sync fails", async () => {
    const feed = await created("greenhouse", "acme");

    await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start);

    const before = await jobsOf("greenhouse");

    expect(await feeds.sync(feed.id, { error: "http_error", status: 404 }, at(5))).toBe("failed");
    expect(await feeds.get(feed.id)).toMatchObject({
      lastSyncedAt: at(5).toISOString(),
      lastError: "http_404",
    });

    for (const error of ["invalid_json", "timeout", "too_large", "network"] as const) {
      expect(await feeds.sync(feed.id, { error }, at(6))).toBe("failed");
      expect((await feeds.get(feed.id))?.lastError).toBe(error);
    }

    expect(await jobsOf("greenhouse")).toEqual(before);
    expect(before).toMatchObject([{ closedAt: null, lastSeenAt: start }]);

    await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, at(7));

    expect((await feeds.get(feed.id))?.lastError).toBeNull();
  });

  it("closes missing jobs after three days and reopens returning ones", async () => {
    const feed = await created("lever", "acme");

    await feeds.sync(feed.id, { jobs: [feedJob("acme:1"), feedJob("acme:2")], skipped: 0 }, start);

    expect(await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, at(2))).toEqual({
      created: 0,
      updated: 1,
      closed: 0,
      skipped: 0,
    });
    expect(await jobsOf("lever")).toMatchObject([
      { sourceKey: "acme:1", closedAt: null },
      { sourceKey: "acme:2", closedAt: null },
    ]);

    expect(await feeds.sync(feed.id, { jobs: [], skipped: 1 }, at(4))).toEqual({
      created: 0,
      updated: 0,
      closed: 1,
      skipped: 1,
    });
    expect(await jobsOf("lever")).toMatchObject([
      { sourceKey: "acme:1", closedAt: null },
      { sourceKey: "acme:2", closedAt: at(4) },
    ]);
    expect((await feeds.get(feed.id))?.openJobs).toBe(1);

    expect(await feeds.sync(feed.id, { jobs: [], skipped: 0 }, at(6))).toEqual({
      created: 0,
      updated: 0,
      closed: 1,
      skipped: 0,
    });
    expect(await jobsOf("lever")).toMatchObject([
      { sourceKey: "acme:1", closedAt: at(6) },
      { sourceKey: "acme:2", closedAt: at(4) },
    ]);

    expect(await feeds.sync(feed.id, { jobs: [feedJob("acme:2")], skipped: 0 }, at(7))).toEqual({
      created: 0,
      updated: 1,
      closed: 0,
      skipped: 0,
    });
    expect(await jobsOf("lever")).toMatchObject([
      { sourceKey: "acme:1", closedAt: at(6) },
      { sourceKey: "acme:2", closedAt: null, lastSeenAt: at(7) },
    ]);
  });

  it("scopes closing to the feed", async () => {
    const feed = await created("greenhouse", "ac_me");

    await created("greenhouse", "acxme");
    await created("greenhouse", "acme");
    await created("greenhouse", "acme-br");
    await created("lever", "ac_me");

    const stale = (
      source: string,
      sourceKey: string,
      origin: "external" | "hr" | "recruiter" = "external",
      title = "x",
    ) => ({
      origin,
      source,
      sourceKey,
      title,
      company: "Acme",
      url: "https://jobs.example.com/vaga",
      lastSeenAt: start,
    });

    await db
      .insert(jobs)
      .values([
        stale("greenhouse", "acxme:1"),
        stale("greenhouse", "ac_me-br:1"),
        stale("greenhouse", "ac_mex:1"),
        stale("lever", "ac_me:1"),
        stale("hr-link", "ac_me:1", "hr"),
        stale("recruiter", "ac_me:1", "recruiter"),
        stale("greenhouse", "ac_me:9", "hr", "HR"),
      ]);

    expect(
      await feeds.sync(
        feed.id,
        { jobs: [feedJob("ac_me:1", { title: "Nova" }), feedJob("ac_me:9")], skipped: 0 },
        at(10),
      ),
    ).toEqual({ created: 1, updated: 0, closed: 0, skipped: 0 });

    expect(await feeds.sync(feed.id, { jobs: [feedJob("ac_me:1")], skipped: 0 }, at(20))).toEqual({
      created: 0,
      updated: 1,
      closed: 0,
      skipped: 0,
    });

    const rows = await db
      .select({
        source: jobs.source,
        sourceKey: jobs.sourceKey,
        origin: jobs.origin,
        title: jobs.title,
        closedAt: jobs.closedAt,
      })
      .from(jobs)
      .orderBy(asc(jobs.source), asc(jobs.sourceKey));

    expect(rows).toEqual([
      {
        source: "greenhouse",
        sourceKey: "ac_me-br:1",
        origin: "external",
        title: "x",
        closedAt: null,
      },
      {
        source: "greenhouse",
        sourceKey: "ac_me:1",
        origin: "external",
        title: "Vaga ac_me:1",
        closedAt: null,
      },
      { source: "greenhouse", sourceKey: "ac_me:9", origin: "hr", title: "HR", closedAt: null },
      {
        source: "greenhouse",
        sourceKey: "ac_mex:1",
        origin: "external",
        title: "x",
        closedAt: null,
      },
      {
        source: "greenhouse",
        sourceKey: "acxme:1",
        origin: "external",
        title: "x",
        closedAt: null,
      },
      { source: "hr-link", sourceKey: "ac_me:1", origin: "hr", title: "x", closedAt: null },
      { source: "lever", sourceKey: "ac_me:1", origin: "external", title: "x", closedAt: null },
      {
        source: "recruiter",
        sourceKey: "ac_me:1",
        origin: "recruiter",
        title: "x",
        closedAt: null,
      },
    ]);
  });

  it("returns failed without writing when the feed is gone", async () => {
    const feed = await created("lever", "acme");

    await feeds.remove(feed.id);

    expect(await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start)).toBe(
      "failed",
    );
    expect(await feeds.sync(feed.id, { error: "timeout" }, start)).toBe("failed");
    expect(await jobsOf("lever")).toEqual([]);
  });

  it("lists only enabled feeds that are due", async () => {
    const never = await created("lever", "never");
    const old = await created("lever", "old");
    const fresh = await created("lever", "fresh");
    const disabled = await created("lever", "disabled");

    await db
      .update(jobFeeds)
      .set({ lastSyncedAt: new Date(start.getTime() - 6 * 60 * 60_000 - 1) })
      .where(eq(jobFeeds.id, old.id));
    await db
      .update(jobFeeds)
      .set({ lastSyncedAt: new Date(start.getTime() - 6 * 60 * 60_000 + 1) })
      .where(eq(jobFeeds.id, fresh.id));
    await feeds.update(disabled.id, { enabled: false });

    expect((await feeds.dueIds(start)).sort()).toEqual([never.id, old.id].sort());
  });
});
