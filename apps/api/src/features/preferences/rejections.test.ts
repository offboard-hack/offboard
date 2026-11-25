import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { jobRejections, jobs, offboardingCases } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const identified = z.object({ id: z.uuid() });
const first = new Date("2026-11-24T10:00:00Z");
const second = new Date("2026-11-25T10:00:00Z");

describe.skipIf(!url)("rejections repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.rejections;
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
    await seedDatabase(db, testSeedFixtures);

    const [one, two] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    profileId = await enable(one.id, "pessoa@exemplo.com");
    otherProfileId = await enable(two.id, "outra@exemplo.com");
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function enable(caseId: string, personalEmail: string) {
    const profile = await repos.talent.enable({
      caseId,
      personalEmail,
      sponsoredUntil: "2026-12-31",
    });

    return identified.parse(profile).id;
  }

  async function job(sourceKey: string, values: Partial<typeof jobs.$inferInsert> = {}) {
    const [row] = await db
      .insert(jobs)
      .values({
        origin: "external",
        source: "seed",
        sourceKey,
        title: sourceKey,
        company: "Acme",
        url: `https://jobs.example.com/${sourceKey}`,
        ...values,
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  it("rejects an open job and overwrites reason, note and time", async () => {
    const id = await job("vaga");

    expect(await repository.reject(profileId, id, { reason: "salary", note: "Baixo" }, first)).toBe(
      true,
    );
    expect(await db.select().from(jobRejections)).toEqual([
      { profileId, jobId: id, reason: "salary", note: "Baixo", createdAt: first },
    ]);

    expect(await repository.reject(profileId, id, { reason: "other", note: null }, second)).toBe(
      true,
    );
    expect(await db.select().from(jobRejections)).toEqual([
      { profileId, jobId: id, reason: "other", note: null, createdAt: second },
    ]);
  });

  it("does not reject unknown, malformed or closed jobs", async () => {
    const closed = await job("fechada", { closedAt: first });

    for (const id of [crypto.randomUUID(), "not-a-uuid", closed]) {
      expect(await repository.reject(profileId, id, { reason: "other", note: null }, first)).toBe(
        false,
      );
    }

    expect(await db.select().from(jobRejections)).toEqual([]);
  });

  it("removes only this profile's rejection and tolerates missing ones", async () => {
    const id = await job("vaga");

    await repository.reject(profileId, id, { reason: "salary", note: null }, first);
    await repository.reject(otherProfileId, id, { reason: "salary", note: null }, first);

    await repository.unreject(profileId, "not-a-uuid");
    await repository.unreject(profileId, crypto.randomUUID());

    expect(await db.select().from(jobRejections)).toHaveLength(2);

    await repository.unreject(profileId, id);
    await repository.unreject(profileId, id);

    expect(await db.select().from(jobRejections)).toEqual([
      expect.objectContaining({ profileId: otherProfileId }),
    ]);
  });

  it("lists rejections newest first, including closed jobs, with reason counts", async () => {
    expect(await repository.list(profileId)).toEqual({ items: [], reasons: [] });

    const a = await job("a");
    const b = await job("b", { closedAt: first });
    const c = await job("c");
    const d = await job("d");

    await db.insert(jobRejections).values([
      { profileId, jobId: a, reason: "salary", note: "n", createdAt: first },
      { profileId, jobId: b, reason: "location", createdAt: second },
      { profileId, jobId: c, reason: "salary", createdAt: second },
      { profileId, jobId: d, reason: "company", createdAt: first },
      { profileId: otherProfileId, jobId: a, reason: "other", createdAt: second },
    ]);

    const listed = await repository.list(profileId);

    const titles = new Map([
      [a, "a"],
      [b, "b"],
      [c, "c"],
      [d, "d"],
    ]);

    expect(listed.items.map((item) => item.job.id)).toEqual([...[b, c].sort(), ...[a, d].sort()]);
    expect(listed.items.map((item) => item.job.title)).toEqual(
      listed.items.map((item) => titles.get(item.job.id)),
    );
    expect(listed.items.find((item) => item.job.title === "a")).toEqual({
      job: { id: a, title: "a", company: "Acme" },
      reason: "salary",
      note: "n",
      createdAt: first.toISOString(),
    });
    expect(listed.reasons).toEqual([
      { reason: "salary", count: 2 },
      { reason: "company", count: 1 },
      { reason: "location", count: 1 },
    ]);
    expect((await repository.list(otherProfileId)).reasons).toEqual([
      { reason: "other", count: 1 },
    ]);
  });

  it("lists a rejection without a stored time", async () => {
    const id = await job("vaga");

    await db
      .insert(jobRejections)
      .values({ profileId, jobId: id, reason: "other", createdAt: null });

    expect((await repository.list(profileId)).items).toMatchObject([{ createdAt: null }]);
  });

  it("keeps rejections out of other profiles and cascades with the job", async () => {
    const id = await job("vaga");

    await repository.reject(profileId, id, { reason: "other", note: null }, first);
    await db.delete(jobs).where(eq(jobs.id, id));

    expect(await repository.list(profileId)).toEqual({ items: [], reasons: [] });
  });
});
