import type { Database } from "@offboard/db/client";
import {
  aiApplications,
  employeeAccess,
  offboardingCases,
  talentProfiles,
} from "@offboard/db/schema";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { aiApplyConsentVersion } from "../../shared/ai-apply-access.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import type { TalentProfile } from "../../shared/talent-profile.js";

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

type Row = typeof talentProfiles.$inferSelect;

function toProfile(row: Row) {
  return {
    id: row.id,
    orgId: row.orgId,
    caseId: row.caseId,
    name: row.name,
    email: row.personalEmail,
    sponsoredUntil: row.sponsoredUntil,
    termsAcceptedAt: row.termsAcceptedAt?.toISOString() ?? null,
    firstSignedInAt: row.firstSignedInAt?.toISOString() ?? null,
    shareOutcomeWithHr: row.shareOutcomeWithHr,
    aiApplyConsentAt: row.aiApplyConsentAt?.toISOString() ?? null,
    aiApplyConsentVersion: row.aiApplyConsentVersion,
    searchableAt: row.searchableAt?.toISOString() ?? null,
  } satisfies TalentProfile;
}

export function createTalentRepository(db: Database) {
  async function findByCase(orgId: string, caseId: string) {
    const [row] = await db
      .select()
      .from(talentProfiles)
      .where(and(eq(talentProfiles.orgId, orgId), eq(talentProfiles.caseId, caseId)));

    return row ? toProfile(row) : undefined;
  }

  async function findById(id: string) {
    const [row] = await db.select().from(talentProfiles).where(eq(talentProfiles.id, id));

    return row ? toProfile(row) : undefined;
  }

  async function enable(input: {
    orgId: string;
    caseId: string;
    personalEmail: string;
    sponsoredUntil: string;
  }) {
    try {
      const [row] = await db
        .insert(talentProfiles)
        .select(
          db
            .select({
              id: sql<string>`gen_random_uuid()`.as("id"),
              orgId: sql<string>`${offboardingCases.orgId}`.as("org_id"),
              caseId: sql<string>`${offboardingCases.id}`.as("case_id"),
              personalEmail: sql<string>`${normalizeEmail(input.personalEmail)}`.as(
                "personal_email",
              ),
              name: sql<string>`${offboardingCases.name}`.as("name"),
              sponsoredUntil: sql<string>`${input.sponsoredUntil}::date`.as("sponsored_until"),
              termsAcceptedAt: sql<null>`null::timestamp`.as("terms_accepted_at"),
              firstSignedInAt: sql<null>`null::timestamp`.as("first_signed_in_at"),
              shareOutcomeWithHr: sql<boolean>`false`.as("share_outcome_with_hr"),
              aiApplyConsentAt: sql<null>`null::timestamp`.as("ai_apply_consent_at"),
              aiApplyConsentVersion: sql<null>`null::varchar`.as("ai_apply_consent_version"),
              searchableAt: sql<null>`null::timestamp`.as("searchable_at"),
              createdAt: sql<Date>`now()`.as("created_at"),
              updatedAt: sql<Date>`now()`.as("updated_at"),
            })
            .from(offboardingCases)
            .where(
              and(eq(offboardingCases.orgId, input.orgId), eq(offboardingCases.id, input.caseId)),
            ),
        )
        .returning();

      return row ? toProfile(row) : ("case_not_found" as const);
    } catch (error) {
      if (caseViolation.safeParse(error).success) return "already_enabled" as const;

      if (emailViolation.safeParse(error).success) return "email_taken" as const;

      throw error;
    }
  }

  async function signsInAsCollaborator(caseId: string) {
    const [row] = await db
      .select({ caseId: employeeAccess.caseId })
      .from(employeeAccess)
      .where(and(eq(employeeAccess.caseId, caseId), isNotNull(employeeAccess.email)));

    return row !== undefined;
  }

  async function profileOfCase(caseId: string) {
    const [row] = await db.select().from(talentProfiles).where(eq(talentProfiles.caseId, caseId));

    return row;
  }

  async function createForCollaborator(
    principal: { caseId: string; name: string; email: string },
    now: Date,
  ) {
    const at = sql<Date>`${now.toISOString()}::timestamp`;

    await db
      .insert(talentProfiles)
      .select(
        db
          .select({
            id: sql<string>`gen_random_uuid()`.as("id"),
            orgId: sql<string>`${offboardingCases.orgId}`.as("org_id"),
            caseId: sql<string>`${offboardingCases.id}`.as("case_id"),
            personalEmail: sql<string>`${normalizeEmail(principal.email)}`.as("personal_email"),
            name: sql<string>`${principal.name}`.as("name"),
            sponsoredUntil: sql<string>`${saoPauloDate(now)}::date`.as("sponsored_until"),
            termsAcceptedAt: at.as("terms_accepted_at"),
            firstSignedInAt: at.as("first_signed_in_at"),
            shareOutcomeWithHr: sql<boolean>`false`.as("share_outcome_with_hr"),
            aiApplyConsentAt: sql<null>`null::timestamp`.as("ai_apply_consent_at"),
            aiApplyConsentVersion: sql<null>`null::varchar`.as("ai_apply_consent_version"),
            searchableAt: sql<null>`null::timestamp`.as("searchable_at"),
            createdAt: at.as("created_at"),
            updatedAt: at.as("updated_at"),
          })
          .from(offboardingCases)
          .where(eq(offboardingCases.id, principal.caseId)),
      )
      .onConflictDoNothing();

    return profileOfCase(principal.caseId);
  }

  async function ensureForCollaborator(
    principal: { caseId: string; name: string; email: string },
    now: Date,
  ) {
    const email = normalizeEmail(principal.email);

    const existing =
      (await profileOfCase(principal.caseId)) ?? (await createForCollaborator(principal, now));

    if (!existing) return "email_taken" as const;

    if (
      existing.personalEmail === email &&
      existing.termsAcceptedAt !== null &&
      existing.firstSignedInAt !== null
    ) {
      return toProfile(existing);
    }

    try {
      const [row] = await db
        .update(talentProfiles)
        .set({
          personalEmail: email,
          termsAcceptedAt: sql`coalesce(${talentProfiles.termsAcceptedAt}, ${sql.param(now, talentProfiles.termsAcceptedAt)})`,
          firstSignedInAt: sql`coalesce(${talentProfiles.firstSignedInAt}, ${sql.param(now, talentProfiles.firstSignedInAt)})`,
          updatedAt: now,
        })
        .where(eq(talentProfiles.id, existing.id))
        .returning();

      return toProfile(row);
    } catch (error) {
      if (emailViolation.safeParse(error).success) return "email_taken" as const;

      throw error;
    }
  }

  async function updateAccess(
    orgId: string,
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
            eq(talentProfiles.orgId, orgId),
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

      return (await findByCase(orgId, caseId)) ? ("email_locked" as const) : ("not_found" as const);
    } catch (error) {
      if (emailViolation.safeParse(error).success) return "email_taken" as const;

      throw error;
    }
  }

  async function findForSignIn(email: string, id?: string) {
    const [row] = await db
      .select({
        id: talentProfiles.id,
        name: talentProfiles.name,
        email: talentProfiles.personalEmail,
      })
      .from(talentProfiles)
      .leftJoin(employeeAccess, eq(employeeAccess.caseId, talentProfiles.caseId))
      .where(
        and(
          sql`lower(${talentProfiles.personalEmail}) = ${normalizeEmail(email)}`,
          id === undefined ? undefined : eq(talentProfiles.id, id),
          isNull(employeeAccess.email),
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

  async function setConsent(id: string, share: boolean, now: Date) {
    const [row] = await db
      .update(talentProfiles)
      .set({ shareOutcomeWithHr: share, updatedAt: now })
      .where(eq(talentProfiles.id, id))
      .returning();

    return toProfile(row);
  }

  async function setSearchable(id: string, searchable: boolean, now: Date) {
    const [row] = await db
      .update(talentProfiles)
      .set({ searchableAt: searchable ? now : null, updatedAt: now })
      .where(eq(talentProfiles.id, id))
      .returning();

    return toProfile(row);
  }

  async function setAiApplyConsent(id: string, accept: boolean, now: Date) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(talentProfiles)
        .set({
          aiApplyConsentAt: accept ? now : null,
          aiApplyConsentVersion: accept ? aiApplyConsentVersion : null,
          updatedAt: now,
        })
        .where(eq(talentProfiles.id, id))
        .returning();

      if (!accept) {
        await tx
          .update(aiApplications)
          .set({
            state: "cancelled",
            reason: "consent_withdrawn",
            finishedAt: now,
            liveUrl: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(aiApplications.profileId, id),
              inArray(aiApplications.state, ["draft", "queued", "running"]),
            ),
          );
      }

      return toProfile(row);
    });
  }

  return {
    enable,
    ensureForCollaborator,
    findByCase,
    updateAccess,
    findForSignIn,
    signsInAsCollaborator,
    markSignedIn,
    findById,
    acceptTerms,
    setConsent,
    setSearchable,
    setAiApplyConsent,
  };
}

export type TalentRepository = ReturnType<typeof createTalentRepository>;
