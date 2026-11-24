import type { Database } from "@offboard/db/client";
import { offboardingCases, talentProfiles } from "@offboard/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const namedUniqueViolation = z.object({
  cause: z.object({ code: z.literal("23505"), constraint: z.string() }),
});

const caseConstraint = "talent_profiles_case_id_unique";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export type TalentProfile = {
  id: string;
  caseId: string | null;
  name: string;
  email: string;
  sponsoredUntil: string;
  termsAcceptedAt: string | null;
  firstSignedInAt: string | null;
};

type Row = typeof talentProfiles.$inferSelect;

function toProfile(row: Row) {
  return {
    id: row.id,
    caseId: row.caseId,
    name: row.name,
    email: row.personalEmail,
    sponsoredUntil: row.sponsoredUntil,
    termsAcceptedAt: row.termsAcceptedAt?.toISOString() ?? null,
    firstSignedInAt: row.firstSignedInAt?.toISOString() ?? null,
  } satisfies TalentProfile;
}

export function createTalentRepository(db: Database) {
  async function findByCase(caseId: string) {
    const [row] = await db.select().from(talentProfiles).where(eq(talentProfiles.caseId, caseId));

    return row ? toProfile(row) : undefined;
  }

  async function findById(id: string) {
    const [row] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, id));

    return row ? toProfile(row) : undefined;
  }

  async function enable(input: { caseId: string; personalEmail: string; sponsoredUntil: string }) {
    const [offboardingCase] = await db
      .select({ name: offboardingCases.name })
      .from(offboardingCases)
      .where(eq(offboardingCases.id, input.caseId));

    if (!offboardingCase) return "case_not_found" as const;

    try {
      const [row] = await db
        .insert(talentProfiles)
        .values({
          caseId: input.caseId,
          name: offboardingCase.name,
          personalEmail: normalizeEmail(input.personalEmail),
          sponsoredUntil: input.sponsoredUntil,
        })
        .returning();

      return toProfile(row);
    } catch (error) {
      const violation = namedUniqueViolation.safeParse(error);

      if (!violation.success) throw error;

      return violation.data.cause.constraint === caseConstraint
        ? ("already_enabled" as const)
        : ("email_taken" as const);
    }
  }

  async function updateAccess(
    caseId: string,
    patch: { personalEmail?: string; sponsoredUntil?: string },
  ) {
    const current = await findByCase(caseId);

    if (!current) return "not_found" as const;

    const personalEmail =
      patch.personalEmail === undefined ? undefined : normalizeEmail(patch.personalEmail);

    if (
      personalEmail !== undefined &&
      personalEmail !== current.email.toLowerCase() &&
      current.firstSignedInAt !== null
    ) {
      return "email_locked" as const;
    }

    try {
      const [row] = await db
        .update(talentProfiles)
        .set({ personalEmail, sponsoredUntil: patch.sponsoredUntil, updatedAt: new Date() })
        .where(eq(talentProfiles.caseId, caseId))
        .returning();

      return toProfile(row);
    } catch (error) {
      if (!namedUniqueViolation.safeParse(error).success) throw error;

      return "email_taken" as const;
    }
  }

  async function findForSignIn(email: string, id?: string) {
    const [row] = await db
      .select({ id: talentProfiles.id, name: talentProfiles.name })
      .from(talentProfiles)
      .where(
        and(
          sql`lower(${talentProfiles.personalEmail}) = ${normalizeEmail(email)}`,
          id === undefined ? undefined : eq(talentProfiles.id, id),
        ),
      );

    return row;
  }

  async function markSignedIn(id: string) {
    await db
      .update(talentProfiles)
      .set({ firstSignedInAt: new Date() })
      .where(and(eq(talentProfiles.id, id), isNull(talentProfiles.firstSignedInAt)));
  }

  async function acceptTerms(id: string) {
    const [row] = await db
      .update(talentProfiles)
      .set({ termsAcceptedAt: sql`coalesce(${talentProfiles.termsAcceptedAt}, now())` })
      .where(eq(talentProfiles.id, id))
      .returning();

    return toProfile(row);
  }

  return { enable, findByCase, updateAccess, findForSignIn, markSignedIn, findById, acceptTerms };
}

export type TalentRepository = ReturnType<typeof createTalentRepository>;
