import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { llmUsage, talentProfiles } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createUsageRepository } from "./llm-usage.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!url)("llm usage", () => {
  const db = createClient(url ?? "");
  const usage = createUsageRepository(db);
  let profileId: string;
  let otherProfileId: string;

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);

    profileId = await enable("pessoa@exemplo.com");
    otherProfileId = await enable("outra@exemplo.com");
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function enable(personalEmail: string) {
    const [profile] = await db
      .insert(talentProfiles)
      .values({ personalEmail, name: "Pessoa", sponsoredUntil: "2026-12-31" })
      .returning({ id: talentProfiles.id });

    return profile.id;
  }

  function rows() {
    return db
      .select({ profileId: llmUsage.profileId, day: llmUsage.day, calls: llmUsage.calls })
      .from(llmUsage)
      .orderBy(asc(llmUsage.day));
  }

  it("allows 30 calls per São Paulo day, then waits for the next midnight", async () => {
    const now = new Date("2026-11-24T18:00:00.000Z");

    for (let call = 0; call < 30; call++) {
      expect(await usage.takeLlmCall(profileId, now)).toBe(true);
    }

    expect(await usage.takeLlmCall(profileId, now)).toEqual({
      retryAt: new Date("2026-11-25T03:00:00.000Z"),
    });
    expect(await usage.takeLlmCall(profileId, new Date("2026-11-25T02:59:59.999Z"))).toEqual({
      retryAt: new Date("2026-11-25T03:00:00.000Z"),
    });
    expect(await usage.takeLlmCall(profileId, new Date("2026-11-25T03:00:00.000Z"))).toBe(true);
    expect(await usage.takeLlmCall(otherProfileId, now)).toBe(true);
    expect(await rows()).toHaveLength(3);
    expect(await rows()).toEqual(
      expect.arrayContaining([
        { profileId, day: "2026-11-24", calls: 30 },
        { profileId: otherProfileId, day: "2026-11-24", calls: 1 },
        { profileId, day: "2026-11-25", calls: 1 },
      ]),
    );
  });

  it("counts the early hours of a UTC day toward the previous São Paulo day", async () => {
    expect(await usage.takeLlmCall(profileId, new Date("2026-12-31T02:30:00.000Z"))).toBe(true);
    expect(await rows()).toEqual([{ profileId, day: "2026-12-30", calls: 1 }]);
  });

  it("never grants more than 30 calls under concurrency", async () => {
    const now = new Date("2026-11-24T12:00:00.000Z");

    const results = await Promise.all(
      Array.from({ length: 35 }, () => usage.takeLlmCall(profileId, now)),
    );

    expect(results.filter((result) => result === true)).toHaveLength(30);
    expect(await rows()).toEqual([{ profileId, day: "2026-11-24", calls: 30 }]);
  });
});
