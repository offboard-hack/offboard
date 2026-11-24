import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { offboardingCases } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTalentRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";

describe.skipIf(!url)("talent repository", () => {
  const db = createClient(url ?? "");
  const talent = createTalentRepository(db);
  let first: { id: string; name: string };
  let second: { id: string; name: string };

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);

    const cases = await db
      .select({ id: offboardingCases.id, name: offboardingCases.name })
      .from(offboardingCases);

    [first, second] = cases;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  function enable(caseId: string, personalEmail = "pessoa@exemplo.com") {
    return talent.enable({ caseId, personalEmail, sponsoredUntil: "2026-12-31" });
  }

  it("enables a profile with a normalized email and the case name", async () => {
    const profile = await enable(first.id, "  Pessoa@Exemplo.COM ");

    expect(profile).toMatchObject({
      caseId: first.id,
      name: first.name,
      email: "pessoa@exemplo.com",
      sponsoredUntil: "2026-12-31",
      termsAcceptedAt: null,
      firstSignedInAt: null,
    });
    expect(await talent.findByCase(first.id)).toEqual(profile);
    expect(await talent.findByCase(second.id)).toBeUndefined();
  });

  it("rejects duplicate cases, duplicate emails and unknown cases", async () => {
    await enable(first.id);

    expect(await enable(first.id, "outra@exemplo.com")).toBe("already_enabled");
    expect(await enable(second.id, "PESSOA@exemplo.com")).toBe("email_taken");
    expect(await enable(missingId)).toBe("case_not_found");
  });

  it("rethrows unexpected database errors", async () => {
    await expect(enable(first.id, `${"a".repeat(300)}@exemplo.com`)).rejects.toThrow();
  });

  it("updates access and locks the email after the first sign-in", async () => {
    await enable(first.id);
    await enable(second.id, "segunda@exemplo.com");

    expect(
      await talent.updateAccess(first.id, { personalEmail: " Nova@Exemplo.com " }),
    ).toMatchObject({
      email: "nova@exemplo.com",
    });
    expect(await talent.updateAccess(first.id, { personalEmail: "segunda@exemplo.com" })).toBe(
      "email_taken",
    );
    expect(await talent.updateAccess(first.id, {})).toMatchObject({ email: "nova@exemplo.com" });

    const found = await talent.findForSignIn("nova@exemplo.com");
    await talent.markSignedIn(found!.id);

    expect(await talent.updateAccess(first.id, { personalEmail: "outra@exemplo.com" })).toBe(
      "email_locked",
    );
    expect(
      await talent.updateAccess(first.id, { personalEmail: "NOVA@exemplo.com" }),
    ).toMatchObject({
      email: "nova@exemplo.com",
    });
    expect(await talent.updateAccess(first.id, { sponsoredUntil: "2027-06-30" })).toMatchObject({
      sponsoredUntil: "2027-06-30",
    });
    expect(await talent.updateAccess(missingId, { sponsoredUntil: "2027-06-30" })).toBe(
      "not_found",
    );
  });

  it("rethrows unexpected errors while updating", async () => {
    await enable(first.id);

    await expect(
      talent.updateAccess(first.id, { personalEmail: `${"a".repeat(300)}@exemplo.com` }),
    ).rejects.toThrow();
  });

  it("keeps the first sign-in and terms timestamps", async () => {
    await enable(first.id);

    const profile = (await talent.findByCase(first.id))!;

    await talent.markSignedIn(profile.id);
    const signedIn = await talent.findById(profile.id);
    await talent.markSignedIn(profile.id);

    expect(signedIn?.firstSignedInAt).not.toBeNull();
    expect((await talent.findById(profile.id))?.firstSignedInAt).toBe(signedIn?.firstSignedInAt);

    const accepted = await talent.acceptTerms(profile.id);
    const again = await talent.acceptTerms(profile.id);

    expect(accepted.termsAcceptedAt).not.toBeNull();
    expect(again.termsAcceptedAt).toBe(accepted.termsAcceptedAt);
    expect(await talent.findById(missingId)).toBeUndefined();
  });

  it("finds sign-in candidates case-insensitively", async () => {
    await enable(first.id);

    const profile = (await talent.findByCase(first.id))!;

    expect(await talent.findForSignIn(" PESSOA@exemplo.com ")).toEqual({
      id: profile.id,
      name: first.name,
    });
    expect(await talent.findForSignIn("pessoa@exemplo.com", profile.id)).toEqual({
      id: profile.id,
      name: first.name,
    });
    expect(await talent.findForSignIn("pessoa@exemplo.com", missingId)).toBeUndefined();
    expect(await talent.findForSignIn("ninguem@exemplo.com")).toBeUndefined();
  });
});
