import type { Database } from "@offboard/db/client";
import { llmUsage } from "@offboard/db/schema";
import { lt, sql } from "drizzle-orm";

const dailyCalls = 30;
const dayMs = 24 * 60 * 60_000;
const saoPauloOffsetMs = 3 * 60 * 60_000;

function saoPauloDay(now: Date) {
  return new Date(now.getTime() - saoPauloOffsetMs).toISOString().slice(0, 10);
}

export function createUsageRepository(db: Database) {
  async function takeLlmCall(profileId: string, now: Date) {
    const day = saoPauloDay(now);

    const [taken] = await db
      .insert(llmUsage)
      .values({ profileId, day, calls: 1 })
      .onConflictDoUpdate({
        target: [llmUsage.profileId, llmUsage.day],
        set: { calls: sql`${llmUsage.calls} + 1` },
        setWhere: lt(llmUsage.calls, dailyCalls),
      })
      .returning({ calls: llmUsage.calls });

    if (taken) return true as const;

    return { retryAt: new Date(Date.parse(`${day}T00:00:00.000Z`) + dayMs + saoPauloOffsetMs) };
  }

  return { takeLlmCall };
}

export type UsageRepository = ReturnType<typeof createUsageRepository>;
