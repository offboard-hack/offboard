import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { offboardingCases, talentPreferences } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepositories } from "../../repositories.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";
const identified = z.object({ id: z.uuid() });
const first = new Date("2026-11-24T10:00:00Z");
const second = new Date("2026-11-25T10:00:00Z");

describe.skipIf(!url)("preferences repository", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const repository = repos.preferences;
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

  it("returns full defaults without a stored row", async () => {
    const preferences = await repository.get(profileId);

    expect(preferences.mode).toBe("review");
    expect(preferences.hybridThreshold).toBe(75);
    expect(preferences.targetTitles).toEqual([]);
    expect(preferences.jobPreferences.excludedCompanies).toEqual([]);
    expect(preferences.profileFields.phone).toEqual({ value: null, share: false });
    expect(await db.select().from(talentPreferences)).toEqual([]);
  });

  it("creates the row on the first partial save and keeps the rest default", async () => {
    const saved = await repository.save(profileId, { mode: "hybrid" }, first);

    expect(saved.titlesChanged).toBe(false);
    expect(saved.preferences.mode).toBe("hybrid");
    expect(saved.preferences.hybridThreshold).toBe(75);

    const [row] = await db.select().from(talentPreferences);

    expect(row).toMatchObject({ profileId, createdAt: first, updatedAt: first });
    expect(row.jobPreferences).toEqual({});
  });

  it("updates only the given keys and merges the nested objects per key", async () => {
    await repository.save(
      profileId,
      {
        mode: "automatic",
        hybridThreshold: 90,
        targetTitles: ["Backend"],
        jobPreferences: {
          relocate: true,
          workModels: ["remote"],
          locations: [{ city: "Campinas", state: "SP" }],
        },
        profileFields: {
          phone: { value: "1", share: true },
          linkedin: { value: "in/eu", share: true },
        },
      },
      first,
    );

    const saved = await repository.save(
      profileId,
      {
        jobPreferences: { excludedCompanies: ["Acme"], workModels: ["onsite", "hybrid"] },
        profileFields: { phone: { value: "2", share: false }, city: { value: "SP", share: false } },
      },
      second,
    );

    expect(saved.preferences.mode).toBe("automatic");
    expect(saved.preferences.hybridThreshold).toBe(90);
    expect(saved.preferences.targetTitles).toEqual(["Backend"]);
    expect(saved.preferences.jobPreferences).toEqual({
      workModels: ["onsite", "hybrid"],
      locations: [{ city: "Campinas", state: "SP" }],
      relocate: true,
      salaryFloorCents: null,
      seniorities: [],
      excludedCompanies: ["Acme"],
    });
    expect(saved.preferences.profileFields.phone).toEqual({ value: "2", share: false });
    expect(saved.preferences.profileFields.linkedin).toEqual({ value: "in/eu", share: true });
    expect(saved.preferences.profileFields.city).toEqual({ value: "SP", share: false });

    const [row] = await db.select().from(talentPreferences);

    expect(row).toMatchObject({ createdAt: first, updatedAt: second });
  });

  it("keeps the other profile fields when only one is sent", async () => {
    await repository.save(
      profileId,
      {
        profileFields: {
          phone: { value: "1", share: true },
          linkedin: { value: "in/eu", share: true },
        },
      },
      first,
    );

    const saved = await repository.save(
      profileId,
      { profileFields: { phone: { value: "2", share: true } } },
      second,
    );

    expect(saved.preferences.profileFields.linkedin).toEqual({ value: "in/eu", share: true });
    expect(saved.preferences.profileFields.phone).toEqual({ value: "2", share: true });
  });

  it("clears a nested key when an empty value is sent", async () => {
    await repository.save(
      profileId,
      {
        jobPreferences: { locations: [{ city: null, state: "SP" }], relocate: true },
        profileFields: { phone: { value: "1", share: true }, city: { value: "SP", share: true } },
      },
      first,
    );

    const saved = await repository.save(
      profileId,
      {
        jobPreferences: { locations: [] },
        profileFields: { phone: { value: null, share: false } },
      },
      second,
    );

    expect(saved.preferences.jobPreferences.locations).toEqual([]);
    expect(saved.preferences.jobPreferences.relocate).toBe(true);
    expect(saved.preferences.profileFields.phone).toEqual({ value: null, share: false });
    expect(saved.preferences.profileFields.city).toEqual({ value: "SP", share: true });
  });

  it("flags title changes case-insensitively as sets", async () => {
    expect(
      (await repository.save(profileId, { targetTitles: ["Backend", "SRE"] }, first)).titlesChanged,
    ).toBe(true);
    expect(
      (await repository.save(profileId, { targetTitles: ["sre", "backend"] }, first)).titlesChanged,
    ).toBe(false);
    expect((await repository.save(profileId, { mode: "review" }, first)).titlesChanged).toBe(false);
    expect(
      (await repository.save(profileId, { targetTitles: ["backend"] }, first)).titlesChanged,
    ).toBe(true);
    expect(
      (await repository.save(profileId, { targetTitles: ["Backend", "Data"] }, first))
        .titlesChanged,
    ).toBe(true);
    expect((await repository.save(profileId, { targetTitles: [] }, first)).titlesChanged).toBe(
      true,
    );
    expect((await repository.save(profileId, { targetTitles: [] }, first)).titlesChanged).toBe(
      false,
    );
    expect((await repository.save(otherProfileId, { targetTitles: [] }, first)).titlesChanged).toBe(
      false,
    );
  });

  it("keeps each profile isolated", async () => {
    await repository.save(profileId, { mode: "automatic", targetTitles: ["Backend"] }, first);

    const other = await repository.get(otherProfileId);

    expect(other.mode).toBe("review");
    expect(other.targetTitles).toEqual([]);
    expect((await repository.get(profileId)).mode).toBe("automatic");
  });

  it("deletes the row with the profile", async () => {
    await repository.save(profileId, { mode: "hybrid" }, first);
    await repos.account.deleteProfile(profileId);

    expect(
      await db.select().from(talentPreferences).where(eq(talentPreferences.profileId, profileId)),
    ).toEqual([]);
    expect((await repository.get(missingId)).mode).toBe("review");
  });
});
