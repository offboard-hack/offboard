import type { Database } from "@offboard/db/client";
import { offboardingCases, talentProfiles } from "@offboard/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

const caseViolation = z.object({
  cause: z.object({
    code: z.literal("23505"),
    constraint: z.literal("talent_profiles_case_id_unique"),
  }),
});

const emailViolation = z.object({
  cause: z.object({
    code: z.literal("23505"),
    constraint: z.literal("talent_profiles_email_lower_idx"),
  }),
});

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
    try {
      const [row] = await db
        .insert(talentProfiles)
        .select(
          db
            .select({
              id: sql<string>`gen_random_uuid()`.as("id"),
              caseId: sql<string>`${offboardingCases.id}`.as("case_id"),
              personalEmail: sql<string>`${normalizeEmail(input.personalEmail)}`.as(
                "personal_email",
              ),
              name: sql<string>`${offboardingCases.name}`.as("name"),
              sponsoredUntil: sql<string>`${input.sponsoredUntil}::date`.as("sponsored_until"),
              termsAcceptedAt: sql<null>`null::timestamp`.as("terms_accepted_at"),
              firstSignedInAt: sql<null>`null::timestamp`.as("first_signed_in_at"),
              shareOutcomeWithHr: sql<boolean>`false`.as("share_outcome_with_hr"),
              createdAt: sql<Date>`now()`.as("created_at"),
              updatedAt: sql<Date>`now()`.as("updated_at"),
            })
            .from(offboardingCases)
            .where(eq(offboardingCases.id, input.caseId)),
        )
        .returning();

      return row ? toProfile(row) : ("case_not_found" as const);
    } catch (error) {
      if (caseViolation.safeParse(error).success) return "already_enabled" as const;

      if (emailViolation.safeParse(error).success) return "email_taken" as const;

      throw error;
    }
  }

  async function updateAccess(
    caseId: string,
    patch: { personalEmail?: string; sponsoredUntil?: string },
  ) {
    const personalEmail =
      patch.personalEmail === undefined ? undefined : normalizeEmail(patch.personalEmail);

    try {
      const [row] = await db
        .update(talentProfiles)
        .set({ personalEmail, sponsoredUntil: patch.sponsoredUntil, updatedAt: new Date() })
        .where(
          and(
            eq(talentProfiles.caseId, caseId),
            personalEmail === undefined
              ? undefined
              : or(
                  isNull(talentProfiles.firstSignedInAt),
                  sql`lower(${talentProfiles.personalEmail}) = ${personalEmail}`,
                ),
          ),
        )
        .returning();

      if (row) return toProfile(row);

      return (await findByCase(caseId)) ? ("email_locked" as const) : ("not_found" as const);
    } catch (error) {
      if (emailViolation.safeParse(error).success) return "email_taken" as const;

      throw error;
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
