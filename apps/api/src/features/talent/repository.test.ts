import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  defaultOrgId,
  employeeAccess,
  offboardingCases,
  organizations,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { emptyEmployeePlan } from "@offboard/employee";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTalentRepository } from "./repository.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const missingId = "00000000-0000-4000-8000-000000000001";
const otherOrgId = "00000000-0000-0000-0000-0000000000b2";

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
    return talent.enable({
      orgId: defaultOrgId,
      caseId,
      personalEmail,
      sponsoredUntil: "2026-12-31",
    });
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
    expect(await talent.findByCase(defaultOrgId, first.id)).toEqual(profile);
    expect(await talent.findByCase(defaultOrgId, second.id)).toBeUndefined();
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
      await talent.updateAccess(defaultOrgId, first.id, { personalEmail: " Nova@Exemplo.com " }),
    ).toMatchObject({
      email: "nova@exemplo.com",
    });
    expect(
      await talent.updateAccess(defaultOrgId, first.id, { personalEmail: "segunda@exemplo.com" }),
    ).toBe("email_taken");
    expect(await talent.updateAccess(defaultOrgId, first.id, {})).toMatchObject({
      email: "nova@exemplo.com",
    });

    const found = await talent.findForSignIn("nova@exemplo.com");
    await talent.markSignedIn(found!.id);

    expect(
      await talent.updateAccess(defaultOrgId, first.id, { personalEmail: "outra@exemplo.com" }),
    ).toBe("email_locked");
    expect(
      await talent.updateAccess(defaultOrgId, first.id, { personalEmail: "NOVA@exemplo.com" }),
    ).toMatchObject({
      email: "nova@exemplo.com",
    });
    expect(
      await talent.updateAccess(defaultOrgId, first.id, { sponsoredUntil: "2027-06-30" }),
    ).toMatchObject({
      sponsoredUntil: "2027-06-30",
    });
    expect(
      await talent.updateAccess(defaultOrgId, missingId, { sponsoredUntil: "2027-06-30" }),
    ).toBe("not_found");
  });

  it("enforces the email lock in the update itself and changes nothing when locked", async () => {
    await enable(first.id);
    await db.update(talentProfiles).set({ firstSignedInAt: new Date() });

    expect(
      await talent.updateAccess(defaultOrgId, first.id, {
        personalEmail: "outra@exemplo.com",
        sponsoredUntil: "2030-01-01",
      }),
    ).toBe("email_locked");
    expect(await talent.findByCase(defaultOrgId, first.id)).toMatchObject({
      email: "pessoa@exemplo.com",
      sponsoredUntil: "2026-12-31",
    });
  });

  it("rethrows unexpected errors while updating", async () => {
    await enable(first.id);

    await expect(
      talent.updateAccess(defaultOrgId, first.id, {
        personalEmail: `${"a".repeat(300)}@exemplo.com`,
      }),
    ).rejects.toThrow();
  });

  it("keeps the first sign-in and terms timestamps", async () => {
    await enable(first.id);

    const profile = (await talent.findByCase(defaultOrgId, first.id))!;

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

  it("stores consent for one profile only", async () => {
    await enable(first.id);
    await enable(second.id, "outra@exemplo.com");

    const mine = (await talent.findByCase(defaultOrgId, first.id))!;
    const theirs = (await talent.findByCase(defaultOrgId, second.id))!;
    const at = new Date("2026-06-15T12:00:00Z");

    expect(mine.shareOutcomeWithHr).toBe(false);
    expect((await talent.setConsent(mine.id, true, at)).shareOutcomeWithHr).toBe(true);
    expect((await talent.findById(theirs.id))?.shareOutcomeWithHr).toBe(false);
    expect((await talent.setConsent(mine.id, false, at)).shareOutcomeWithHr).toBe(false);

    const [row] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, mine.id));

    expect(row.updatedAt).toEqual(at);
  });

  it("finds sign-in candidates case-insensitively", async () => {
    await enable(first.id);

    const profile = (await talent.findByCase(defaultOrgId, first.id))!;

    expect(await talent.findForSignIn(" PESSOA@exemplo.com ")).toEqual({
      id: profile.id,
      name: first.name,
      email: "pessoa@exemplo.com",
    });
    expect(await talent.findForSignIn("pessoa@exemplo.com", profile.id)).toEqual({
      id: profile.id,
      name: first.name,
      email: "pessoa@exemplo.com",
    });
    expect(await talent.findForSignIn("pessoa@exemplo.com", missingId)).toBeUndefined();
    expect(await talent.findForSignIn("ninguem@exemplo.com")).toBeUndefined();

    await db.insert(employeeAccess).values({
      caseId: first.id,
      orgId: defaultOrgId,
      email: "colaboradora@exemplo.com",
      plan: emptyEmployeePlan,
    });

    expect(await talent.findForSignIn("pessoa@exemplo.com")).toBeUndefined();

    await db.update(employeeAccess).set({ email: null });

    expect(await talent.findForSignIn("pessoa@exemplo.com")).toEqual({
      id: profile.id,
      name: first.name,
      email: "pessoa@exemplo.com",
    });
  });

  it("ensures one collaborator profile per case and follows the grant email", async () => {
    const created = new Date("2026-06-15T02:00:00.000Z");
    const later = new Date("2026-06-20T12:00:00.000Z");
    const principal = { caseId: first.id, name: "Colaboradora", email: " Bia@Exemplo.com " };

    const profile = await talent.ensureForCollaborator(principal, created);

    if (profile === "email_taken") throw new Error(profile);

    expect(profile).toMatchObject({
      orgId: defaultOrgId,
      caseId: first.id,
      name: "Colaboradora",
      email: "bia@exemplo.com",
      sponsoredUntil: "2026-06-14",
      termsAcceptedAt: created.toISOString(),
      firstSignedInAt: created.toISOString(),
    });

    async function stored() {
      const [row] = await db
        .select()
        .from(talentProfiles)
        .where(eq(talentProfiles.caseId, first.id));

      return row;
    }

    expect(await talent.ensureForCollaborator(principal, later)).toEqual(profile);
    expect((await stored()).updatedAt).toEqual(created);

    await db.update(talentProfiles).set({ firstSignedInAt: null });

    expect(await talent.ensureForCollaborator(principal, later)).toEqual({
      ...profile,
      firstSignedInAt: later.toISOString(),
    });

    await db.update(talentProfiles).set({ termsAcceptedAt: null });

    expect(
      await talent.ensureForCollaborator({ ...principal, email: "Nova@Exemplo.com" }, later),
    ).toEqual({
      ...profile,
      email: "nova@exemplo.com",
      termsAcceptedAt: later.toISOString(),
      firstSignedInAt: later.toISOString(),
    });
    expect((await stored()).updatedAt).toEqual(later);

    await enable(second.id, "outra@exemplo.com");

    expect(
      await talent.ensureForCollaborator({ ...principal, email: "OUTRA@exemplo.com" }, later),
    ).toBe("email_taken");
    expect(
      await talent.ensureForCollaborator(
        { caseId: missingId, name: "Ninguém", email: "ninguem@exemplo.com" },
        later,
      ),
    ).toBe("email_taken");
    await expect(
      talent.ensureForCollaborator(
        { ...principal, email: `${"a".repeat(300)}@exemplo.com` },
        later,
      ),
    ).rejects.toThrow();
  });

  it("isolates talent across organizations", async () => {
    await db
      .insert(organizations)
      .values({ id: otherOrgId, name: "Org B", slug: "org-b" })
      .onConflictDoNothing();

    const [otherCase] = await db
      .insert(offboardingCases)
      .values({
        orgId: otherOrgId,
        name: "Pessoa da Org B",
        role: "Dev",
        department: "Eng",
        deadline: "2026-12-01",
      })
      .returning({ id: offboardingCases.id });

    const foreign = {
      caseId: first.id,
      personalEmail: "b@exemplo.com",
      sponsoredUntil: "2026-12-31",
    };

    expect(await talent.enable({ orgId: otherOrgId, ...foreign })).toBe("case_not_found");

    const own = await enable(first.id);

    expect(own).toMatchObject({ orgId: defaultOrgId, caseId: first.id });
    expect(await talent.findByCase(otherOrgId, first.id)).toBeUndefined();
    expect(await talent.updateAccess(otherOrgId, first.id, { sponsoredUntil: "2030-01-01" })).toBe(
      "not_found",
    );
    expect(
      await talent.updateAccess(otherOrgId, first.id, { personalEmail: "b@exemplo.com" }),
    ).toBe("not_found");
    expect(await talent.findByCase(defaultOrgId, first.id)).toEqual(own);

    const other = await talent.enable({
      orgId: otherOrgId,
      caseId: otherCase.id,
      personalEmail: "b@exemplo.com",
      sponsoredUntil: "2026-12-31",
    });

    expect(other).toMatchObject({
      orgId: otherOrgId,
      caseId: otherCase.id,
      name: "Pessoa da Org B",
    });
    expect(await talent.findByCase(defaultOrgId, otherCase.id)).toBeUndefined();
    expect(await talent.findByCase(otherOrgId, otherCase.id)).toEqual(other);
  });
});
