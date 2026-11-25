import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { applications, jobSources, jobs, talentProfiles } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { and, asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CatalogSource } from "./catalog.js";
import { createSourcesRepository } from "./repository.js";
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

describe.skipIf(!url)("sources repository", () => {
  const db = createClient(url ?? "");
  const feeds = createSourcesRepository(db);

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

  async function created(kind: "greenhouse" | "lever", target: string, enabled = true) {
    const [source] = await db
      .insert(jobSources)
      .values({ kind, target, enabled })
      .returning({ id: jobSources.id });

    return source;
  }

  async function stored(id: string) {
    const [source] = await db
      .select({
        enabled: jobSources.enabled,
        label: jobSources.label,
        lastSyncedAt: jobSources.lastSyncedAt,
        lastError: jobSources.lastError,
        updatedAt: jobSources.updatedAt,
      })
      .from(jobSources)
      .where(eq(jobSources.id, id));

    return source;
  }

  function registry() {
    return db
      .select({
        kind: jobSources.kind,
        target: jobSources.target,
        label: jobSources.label,
        enabled: jobSources.enabled,
        updatedAt: jobSources.updatedAt,
      })
      .from(jobSources)
      .orderBy(asc(jobSources.target), asc(jobSources.kind));
  }

  async function openCount(source: string) {
    return (await jobsOf(source)).filter((job) => job.closedAt === null).length;
  }

  async function talentProfileId() {
    const [profile] = await db
      .insert(talentProfiles)
      .values({ personalEmail: "fontes@example.com", name: "Fontes", sponsoredUntil: "2099-12-31" })
      .returning({ id: talentProfiles.id });

    return profile.id;
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

  it("gets a source by id", async () => {
    const source = await created("lever", "acme");

    expect(await feeds.get(source.id)).toEqual({
      id: source.id,
      kind: "lever",
      target: "acme",
      label: null,
      enabled: true,
    });
    expect(await feeds.get(crypto.randomUUID())).toBeUndefined();
  });

  it("inserts new catalog entries enabled and due", async () => {
    const catalog: CatalogSource[] = [
      { kind: "greenhouse", target: "acme", label: "Acme" },
      { kind: "lever", target: "acme", label: null },
    ];

    expect(await feeds.syncCatalog(catalog, start)).toEqual({
      added: 2,
      enabled: 0,
      disabled: 0,
      closed: 0,
    });
    expect(await registry()).toEqual([
      { kind: "greenhouse", target: "acme", label: "Acme", enabled: true, updatedAt: start },
      { kind: "lever", target: "acme", label: null, enabled: true, updatedAt: start },
    ]);
    expect((await feeds.dueIds(start)).length).toBe(2);
  });

  it("updates the label of a listed source", async () => {
    await feeds.syncCatalog([{ kind: "greenhouse", target: "acme", label: "Acme" }], start);

    expect(
      await feeds.syncCatalog(
        [{ kind: "greenhouse", target: "acme", label: "Acme Brasil" }],
        at(1),
      ),
    ).toEqual({ added: 0, enabled: 0, disabled: 0, closed: 0 });
    expect(await registry()).toMatchObject([
      { target: "acme", label: "Acme Brasil", enabled: true, updatedAt: at(1) },
    ]);

    await feeds.syncCatalog([{ kind: "greenhouse", target: "acme", label: null }], at(2));

    expect(await registry()).toMatchObject([{ label: null, updatedAt: at(2) }]);
  });

  it("re-enables a listed source that was disabled", async () => {
    const source = await created("greenhouse", "acme", false);

    expect(
      await feeds.syncCatalog([{ kind: "greenhouse", target: "acme", label: "Acme" }], start),
    ).toEqual({ added: 0, enabled: 1, disabled: 0, closed: 0 });
    expect(await stored(source.id)).toMatchObject({
      enabled: true,
      label: "Acme",
      updatedAt: start,
    });
  });

  it("changes nothing when the catalog is unchanged or empty", async () => {
    expect(await feeds.syncCatalog([], start)).toEqual({
      added: 0,
      enabled: 0,
      disabled: 0,
      closed: 0,
    });
    expect(await registry()).toEqual([]);

    const catalog: CatalogSource[] = [{ kind: "greenhouse", target: "acme", label: "Acme" }];

    await feeds.syncCatalog(catalog, start);

    const before = await registry();

    expect(await feeds.syncCatalog(catalog, at(1))).toEqual({
      added: 0,
      enabled: 0,
      disabled: 0,
      closed: 0,
    });
    expect(await registry()).toEqual(before);
  });

  it("closes only the jobs of sources removed from the catalog", async () => {
    const profileId = await talentProfileId();
    const acme = { kind: "greenhouse", target: "acme", label: null } satisfies CatalogSource;
    const sibling = { kind: "greenhouse", target: "acme-br", label: null } satisfies CatalogSource;
    const leverAcme = { kind: "lever", target: "acme", label: null } satisfies CatalogSource;
    const gone = await created("lever", "gone", false);

    await feeds.syncCatalog([acme, sibling, leverAcme], start);

    const ids = Object.fromEntries(
      (await db.select().from(jobSources)).map((row) => [`${row.kind}:${row.target}`, row.id]),
    );

    await feeds.sync(
      ids["greenhouse:acme"],
      { jobs: [feedJob("acme:1"), feedJob("acme:2")], skipped: 0 },
      start,
    );
    await feeds.sync(
      ids["greenhouse:acme-br"],
      { jobs: [feedJob("acme-br:1")], skipped: 0 },
      start,
    );
    await feeds.sync(ids["lever:acme"], { jobs: [feedJob("acme:1")], skipped: 0 }, start);
    await db.update(jobs).set({ closedAt: start }).where(eq(jobs.sourceKey, "acme:2"));
    await db.insert(jobs).values({
      origin: "hr",
      source: "hr-link",
      sourceKey: "acme:3",
      title: "HR",
      company: "Acme",
      url: "https://jobs.example.com/hr",
    });

    const [applied] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.source, "greenhouse"), eq(jobs.sourceKey, "acme:1")));

    await db.insert(applications).values({ profileId, jobId: applied.id });

    expect(await feeds.syncCatalog([sibling], at(1))).toEqual({
      added: 0,
      enabled: 0,
      disabled: 2,
      closed: 2,
    });
    expect(await jobsOf("greenhouse")).toMatchObject([
      { sourceKey: "acme-br:1", closedAt: null },
      { sourceKey: "acme:1", closedAt: at(1) },
      { sourceKey: "acme:2", closedAt: start },
    ]);
    expect(await jobsOf("lever")).toMatchObject([{ sourceKey: "acme:1", closedAt: at(1) }]);
    expect(await jobsOf("hr-link")).toMatchObject([{ sourceKey: "acme:3", closedAt: null }]);
    expect(await registry()).toMatchObject([
      { kind: "greenhouse", target: "acme", enabled: false, updatedAt: at(1) },
      { kind: "lever", target: "acme", enabled: false, updatedAt: at(1) },
      { kind: "greenhouse", target: "acme-br", enabled: true, updatedAt: start },
      { kind: "lever", target: "gone", enabled: false },
    ]);
    expect((await stored(gone.id)).updatedAt).not.toEqual(at(1));
    expect(
      await db
        .select({ jobId: applications.jobId })
        .from(applications)
        .where(eq(applications.profileId, profileId)),
    ).toEqual([{ jobId: applied.id }]);
    expect(await feeds.dueIds(at(1))).toEqual([ids["greenhouse:acme-br"]]);
  });

  it("does not reopen jobs of a source disabled during a sync", async () => {
    const source = await created("lever", "acme");

    await feeds.sync(source.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start);
    await feeds.syncCatalog([], at(1));

    expect(
      await feeds.sync(
        source.id,
        { jobs: [feedJob("acme:1"), feedJob("acme:2")], skipped: 0 },
        at(2),
      ),
    ).toBe("failed");
    expect(await jobsOf("lever")).toMatchObject([{ sourceKey: "acme:1", closedAt: at(1) }]);
    expect(await stored(source.id)).toMatchObject({ lastSyncedAt: start, lastError: null });
  });

  it("imports a source and counts created, updated and skipped jobs", async () => {
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

    expect(await stored(feed.id)).toMatchObject({ lastSyncedAt: at(1), lastError: null });
  });

  it("imports large sources in chunks", async () => {
    const feed = await created("lever", "big");
    const many = Array.from({ length: 1_201 }, (_, index) => feedJob(`big:${index}`));

    expect(await feeds.sync(feed.id, { jobs: many, skipped: 0 }, start)).toEqual({
      created: 1_201,
      updated: 0,
      closed: 0,
      skipped: 0,
    });
    expect(await openCount("lever")).toBe(1_201);
  });

  it("keeps jobs when a sync fails", async () => {
    const feed = await created("greenhouse", "acme");

    await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start);

    const before = await jobsOf("greenhouse");

    expect(await feeds.sync(feed.id, { error: "http_error", status: 404 }, at(2))).toBe("failed");
    expect(await stored(feed.id)).toMatchObject({ lastSyncedAt: at(2), lastError: "http_404" });

    for (const error of ["invalid_json", "timeout", "too_large", "network"] as const) {
      expect(await feeds.sync(feed.id, { error }, at(3))).toBe("failed");
      expect((await stored(feed.id)).lastError).toBe(error);
    }

    expect(await jobsOf("greenhouse")).toEqual(before);
    expect(before).toMatchObject([{ closedAt: null, lastSeenAt: start }]);

    await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, at(7));

    expect((await stored(feed.id)).lastError).toBeNull();
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
    expect(await openCount("lever")).toBe(1);

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

  it("closes a source's jobs that went unseen for three days when it keeps failing", async () => {
    const stale = await created("greenhouse", "acme");
    const fresh = await created("lever", "acme");
    const other = await created("greenhouse", "other");

    await feeds.sync(stale.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start);
    await feeds.sync(fresh.id, { jobs: [feedJob("acme:1")], skipped: 0 }, at(2));
    await feeds.sync(other.id, { jobs: [feedJob("other:1")], skipped: 0 }, at(4));
    await db.insert(jobs).values({
      origin: "hr",
      source: "greenhouse",
      sourceKey: "acme:hr",
      title: "HR",
      company: "Acme",
      url: "https://jobs.example.com/vaga",
      lastSeenAt: start,
    });

    expect(await feeds.sync(stale.id, { error: "timeout" }, at(4))).toBe("failed");
    expect(await feeds.sync(fresh.id, { error: "timeout" }, at(4))).toBe("failed");

    expect(await stored(stale.id)).toMatchObject({ lastSyncedAt: at(4), lastError: "timeout" });
    expect(await jobsOf("greenhouse")).toMatchObject([
      { sourceKey: "acme:1", closedAt: at(4) },
      { sourceKey: "acme:hr", closedAt: null },
      { sourceKey: "other:1", closedAt: null },
    ]);
    expect(await jobsOf("lever")).toMatchObject([{ sourceKey: "acme:1", closedAt: null }]);
  });

  it("does not close jobs when a disabled source reports a failure", async () => {
    const feed = await created("greenhouse", "acme");

    await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start);
    await db.update(jobSources).set({ enabled: false }).where(eq(jobSources.id, feed.id));

    expect(await feeds.sync(feed.id, { error: "timeout" }, at(10))).toBe("failed");
    expect(await jobsOf("greenhouse")).toMatchObject([{ closedAt: null }]);
  });

  it("scopes closing to the source", async () => {
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

  it("returns failed without writing when the source is gone", async () => {
    const feed = await created("lever", "acme");

    await db.delete(jobSources).where(eq(jobSources.id, feed.id));

    expect(await feeds.sync(feed.id, { jobs: [feedJob("acme:1")], skipped: 0 }, start)).toBe(
      "failed",
    );
    expect(await feeds.sync(feed.id, { error: "timeout" }, start)).toBe("failed");
    expect(await jobsOf("lever")).toEqual([]);
  });

  it("lists only enabled sources that are due", async () => {
    const never = await created("lever", "never");
    const old = await created("lever", "old");
    const fresh = await created("lever", "fresh");
    await created("lever", "disabled", false);

    await db
      .update(jobSources)
      .set({ lastSyncedAt: new Date(start.getTime() - 6 * 60 * 60_000 - 1) })
      .where(eq(jobSources.id, old.id));
    await db
      .update(jobSources)
      .set({ lastSyncedAt: new Date(start.getTime() - 6 * 60 * 60_000 + 1) })
      .where(eq(jobSources.id, fresh.id));

    expect((await feeds.dueIds(start)).sort()).toEqual([never.id, old.id].sort());
  });
});
