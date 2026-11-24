import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { jobs } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJobsRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const draft = {
  title: "Engenheira de Software",
  company: "Acme",
  workModel: "remote" as const,
  city: "São Paulo",
  state: "SP",
  salaryMinCents: 800000,
  salaryMaxCents: 1200000,
  description: "Descrição",
};

describe.skipIf(!url)("jobs repository", () => {
  const db = createClient(url ?? "");
  const repository = createJobsRepository(db);

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

  function insert(sourceKey: string, values: Partial<typeof jobs.$inferInsert> = {}) {
    return db.insert(jobs).values({
      origin: "external",
      source: "seed",
      sourceKey,
      title: sourceKey,
      company: "Acme",
      url: `https://jobs.example.com/${sourceKey}`,
      ...values,
    });
  }

  it("creates a shared job from HR", async () => {
    const result = await repository.createShared({
      ...draft,
      url: "https://jobs.example.com/vaga",
      sourceKey: "https://jobs.example.com/vaga",
    });

    expect(result.created).toBe(true);
    expect(result.job).toMatchObject({
      origin: "hr",
      title: "Engenheira de Software",
      company: "Acme",
      workModel: "remote",
      city: "São Paulo",
      state: "SP",
      salaryMinCents: 800000,
      salaryMaxCents: 1200000,
      url: "https://jobs.example.com/vaga",
    });
    expect(result.job.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await repository.findBySource("hr-link", "https://jobs.example.com/vaga")).toEqual(
      result.job,
    );
  });

  it("deduplicates by normalized url", async () => {
    const input = {
      ...draft,
      url: "https://jobs.example.com/vaga",
      sourceKey: "https://jobs.example.com/vaga",
    };

    const first = await repository.createShared(input);
    const second = await repository.createShared({ ...input, title: "Outro título" });

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.title).toBe("Engenheira de Software");
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it("fails clearly when a conflicting row cannot be read back", async () => {
    const stub = Object.assign(Object.create(db), {
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => ({ returning: async () => [] }) }),
      }),
      select: () => ({ from: () => ({ where: async () => [] }) }),
    });

    await expect(
      createJobsRepository(stub).createShared({
        ...draft,
        url: "https://x.example.com",
        sourceKey: "k",
      }),
    ).rejects.toThrow("vanished");
  });

  it("returns nothing for an unknown source key", async () => {
    expect(await repository.findBySource("hr-link", "missing")).toBeUndefined();
  });

  it("lists open jobs, filtered, ordered and paginated", async () => {
    await insert("old", { postedAt: new Date("2026-01-01T00:00:00Z"), workModel: "remote" });
    await insert("new", { postedAt: new Date("2026-03-01T00:00:00Z"), workModel: "hybrid" });
    await insert("undated", { workModel: "remote" });
    await insert("closed", {
      postedAt: new Date("2026-04-01T00:00:00Z"),
      closedAt: new Date("2026-04-02T00:00:00Z"),
    });

    const all = await repository.listOpen({ page: 1, pageSize: 10 });

    expect(all.total).toBe(3);
    expect(all.items.map((job) => job.title)).toEqual(["new", "old", "undated"]);
    expect(all.items[2].postedAt).toBeNull();

    const remote = await repository.listOpen({ workModel: "remote", page: 1, pageSize: 10 });

    expect(remote.total).toBe(2);
    expect(remote.items.map((job) => job.title)).toEqual(["old", "undated"]);

    const second = await repository.listOpen({ page: 2, pageSize: 1 });

    expect(second.total).toBe(3);
    expect(second.items.map((job) => job.title)).toEqual(["old"]);
  });
});
