import type { Database } from "@offboard/db/client";
import { talentPreferences } from "@offboard/db/schema";
import { eq, sql } from "drizzle-orm";
import { type ProfileFill, toPreferences } from "../../shared/talent-preferences.js";
import type { PreferencesInput } from "./schema.js";

function sameTitles(left: string[], right: string[]) {
  const first = new Set(left.map((title) => title.toLowerCase()));
  const second = new Set(right.map((title) => title.toLowerCase()));

  return first.size === second.size && [...first].every((title) => second.has(title));
}

export function createPreferencesRepository(db: Pick<Database, "select" | "insert">) {
  async function stored(profileId: string) {
    const [row] = await db
      .select()
      .from(talentPreferences)
      .where(eq(talentPreferences.profileId, profileId));

    return row;
  }

  async function get(profileId: string) {
    return toPreferences(await stored(profileId));
  }

  async function save(profileId: string, input: PreferencesInput, now: Date) {
    const before = await stored(profileId);

    const { jobPreferences, profileFields, ...scalars } = input;

    const [row] = await db
      .insert(talentPreferences)
      .values({ ...input, profileId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: talentPreferences.profileId,
        set: {
          ...scalars,
          ...(jobPreferences && {
            jobPreferences: sql`${talentPreferences.jobPreferences} || excluded.job_preferences`,
          }),
          ...(profileFields && {
            profileFields: sql`${talentPreferences.profileFields} || excluded.profile_fields`,
          }),
          updatedAt: now,
        },
      })
      .returning();

    return {
      preferences: toPreferences(row),
      titlesChanged: !sameTitles(before?.targetTitles ?? [], row.targetTitles),
    };
  }

  async function fillUnset(profileId: string, values: ProfileFill, now: Date) {
    const fields = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, { value, share: true }]),
    );

    if (Object.keys(fields).length === 0) return;

    await db
      .insert(talentPreferences)
      .values({ profileId, profileFields: fields, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: talentPreferences.profileId,
        set: {
          profileFields: sql`${talentPreferences.profileFields} || (select coalesce(jsonb_object_agg(fill.key, fill.value), '{}'::jsonb) from jsonb_each(excluded.profile_fields) as fill where ${talentPreferences.profileFields} -> fill.key ->> 'value' is null)`,
          updatedAt: now,
        },
      });
  }

  return { get, save, fillUnset };
}

export type PreferencesRepository = ReturnType<typeof createPreferencesRepository>;
