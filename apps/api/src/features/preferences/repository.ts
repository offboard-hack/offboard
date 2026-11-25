import type { Database } from "@offboard/db/client";
import { talentPreferences } from "@offboard/db/schema";
import { eq } from "drizzle-orm";
import { toPreferences } from "../../shared/talent-preferences.js";
import type { PreferencesInput } from "./schema.js";

function sameTitles(left: string[], right: string[]) {
  const first = new Set(left.map((title) => title.toLowerCase()));
  const second = new Set(right.map((title) => title.toLowerCase()));

  return first.size === second.size && [...first].every((title) => second.has(title));
}

export function createPreferencesRepository(db: Database) {
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

    const [row] = await db
      .insert(talentPreferences)
      .values({ ...input, profileId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: talentPreferences.profileId,
        set: { ...input, updatedAt: now },
      })
      .returning();

    return {
      preferences: toPreferences(row),
      titlesChanged: !sameTitles(before?.targetTitles ?? [], row.targetTitles),
    };
  }

  return { get, save };
}

export type PreferencesRepository = ReturnType<typeof createPreferencesRepository>;
