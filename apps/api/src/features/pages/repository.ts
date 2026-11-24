import type { Database } from "@offboard/db/client";
import {
  applications,
  publicPageDailyViews,
  publicPages,
  resumes,
  talentProfiles,
} from "@offboard/db/schema";
import { and, between, eq, exists, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import { isValidSlug, suggestSlug } from "./slug.js";

export type PageSettings = {
  slug: string;
  enabled: boolean;
  resumeId: string | null;
  exists: boolean;
};

type Patch = { enabled?: boolean; slug?: string; resumeId?: string | null };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type Reader = Pick<Database, "select">;

const dayMs = 24 * 60 * 60_000;

const slugViolation = z.object({
  cause: z.object({
    code: z.literal("23505"),
    constraint: z.literal("public_pages_slug_idx"),
  }),
});

const settingsColumns = {
  slug: publicPages.slug,
  enabled: publicPages.enabled,
  resumeId: publicPages.resumeId,
};

function weekDays(now: Date) {
  const today = Date.parse(`${saoPauloDate(now)}T00:00:00Z`);

  return Array.from({ length: 7 }, (_, index) =>
    new Date(today - (6 - index) * dayMs).toISOString().slice(0, 10),
  );
}

async function suggestion(reader: Reader, profileId: string) {
  const [profile] = await reader
    .select({ name: talentProfiles.name })
    .from(talentProfiles)
    .where(eq(talentProfiles.id, profileId));

  return suggestSlug(profile.name, async (slug) => {
    const [taken] = await reader
      .select({ profileId: publicPages.profileId })
      .from(publicPages)
      .where(and(eq(publicPages.slug, slug), ne(publicPages.profileId, profileId)));

    return taken !== undefined;
  });
}

async function readyResume(tx: Transaction, profileId: string, resumeId: string) {
  const [row] = await tx
    .select({ id: resumes.id })
    .from(resumes)
    .where(
      and(eq(resumes.id, resumeId), eq(resumes.profileId, profileId), eq(resumes.status, "ready")),
    )
    .for("share");

  return row !== undefined;
}

export function createPagesRepository(db: Database) {
  async function settings(profileId: string) {
    const [row] = await db
      .select(settingsColumns)
      .from(publicPages)
      .where(eq(publicPages.profileId, profileId));

    if (row) return { ...row, exists: true } satisfies PageSettings;

    return {
      slug: await suggestion(db, profileId),
      enabled: false,
      resumeId: null,
      exists: false,
    } satisfies PageSettings;
  }

  async function save(profileId: string, patch: Patch, now: Date) {
    if (patch.slug !== undefined && !isValidSlug(patch.slug)) return "invalid_slug" as const;

    try {
      return await db.transaction(async (tx) => {
        if (patch.resumeId && !(await readyResume(tx, profileId, patch.resumeId))) {
          return "resume_not_ready" as const;
        }

        const [current] = await tx
          .select({ slug: publicPages.slug })
          .from(publicPages)
          .where(eq(publicPages.profileId, profileId));

        const slug = patch.slug ?? current?.slug ?? (await suggestion(tx, profileId));

        const [row] = await tx
          .insert(publicPages)
          .values({
            profileId,
            slug,
            enabled: patch.enabled ?? false,
            resumeId: patch.resumeId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: publicPages.profileId,
            set: {
              slug: patch.slug,
              enabled: patch.enabled,
              resumeId: patch.resumeId,
              updatedAt: now,
            },
          })
          .returning(settingsColumns);

        return { ...row, exists: true } satisfies PageSettings;
      });
    } catch (error) {
      if (slugViolation.safeParse(error).success) return "slug_taken" as const;

      throw error;
    }
  }

  async function publicPage(slug: string) {
    const [row] = await db
      .select({
        profileId: publicPages.profileId,
        name: talentProfiles.name,
        sponsoredUntil: talentProfiles.sponsoredUntil,
        content: resumes.content,
      })
      .from(publicPages)
      .innerJoin(talentProfiles, eq(talentProfiles.id, publicPages.profileId))
      .innerJoin(
        resumes,
        and(
          eq(resumes.profileId, publicPages.profileId),
          eq(resumes.status, "ready"),
          or(
            eq(resumes.id, publicPages.resumeId),
            and(isNull(publicPages.resumeId), eq(resumes.kind, "base")),
          ),
        ),
      )
      .where(and(eq(publicPages.slug, slug), eq(publicPages.enabled, true)));

    return row;
  }

  async function recordVisit(profileId: string, token: string | null, now: Date) {
    const recruiter = exists(
      db
        .select({ one: sql`1` })
        .from(applications)
        .where(
          and(eq(applications.profileId, profileId), eq(applications.publicToken, sql`${token}`)),
        ),
    );

    await db
      .insert(publicPageDailyViews)
      .values({
        profileId,
        day: saoPauloDate(now),
        visits: 1,
        recruiterVisits: sql`case when ${recruiter} then 1 else 0 end`,
      })
      .onConflictDoUpdate({
        target: [publicPageDailyViews.profileId, publicPageDailyViews.day],
        set: {
          visits: sql`${publicPageDailyViews.visits} + 1`,
          recruiterVisits: sql`${publicPageDailyViews.recruiterVisits} + excluded.recruiter_visits`,
        },
      });
  }

  async function week(profileId: string, now: Date) {
    const days = weekDays(now);

    const rows = await db
      .select({
        day: publicPageDailyViews.day,
        visits: publicPageDailyViews.visits,
        recruiterVisits: publicPageDailyViews.recruiterVisits,
      })
      .from(publicPageDailyViews)
      .where(
        and(
          eq(publicPageDailyViews.profileId, profileId),
          between(publicPageDailyViews.day, days[0], days[6]),
        ),
      );

    const counted = new Map(rows.map((row) => [row.day, row]));

    const filled = days.map((day) => counted.get(day) ?? { day, visits: 0, recruiterVisits: 0 });

    return {
      days: filled,
      visits: filled.reduce((total, day) => total + day.visits, 0),
      recruiterVisits: filled.reduce((total, day) => total + day.recruiterVisits, 0),
    };
  }

  async function urlFor(profileId: string) {
    const [row] = await db
      .select({ slug: publicPages.slug })
      .from(publicPages)
      .where(and(eq(publicPages.profileId, profileId), eq(publicPages.enabled, true)));

    return row?.slug ?? null;
  }

  return { settings, save, publicPage, recordVisit, week, urlFor };
}

export type PagesRepository = ReturnType<typeof createPagesRepository>;
