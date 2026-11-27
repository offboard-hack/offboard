import type { Database } from "@offboard/db/client";
import { demoSearchUsage } from "@offboard/db/schema";
import { sql } from "drizzle-orm";
import { textHash } from "./embed.js";

export function createSearchQuota(db: Database) {
  async function take(buckets: { bucket: string; limit: number }[], day: string) {
    let allowed = true;

    for (const { bucket, limit } of buckets) {
      const [row] = await db
        .insert(demoSearchUsage)
        .values({ bucket, day, searches: 1 })
        .onConflictDoUpdate({
          target: [demoSearchUsage.bucket, demoSearchUsage.day],
          set: { searches: sql`${demoSearchUsage.searches} + 1` },
        })
        .returning({ searches: demoSearchUsage.searches });

      if (row.searches > limit) allowed = false;
    }

    return allowed;
  }

  async function takeForVisitor(
    scope: string,
    request: Request,
    limits: { visitor: number; total: number },
  ) {
    const visitor = await textHash(request.headers.get("cf-connecting-ip") ?? "unknown");

    return take(
      [
        { bucket: `${scope}:ip:${visitor.slice(0, 32)}`, limit: limits.visitor },
        { bucket: `${scope}:all`, limit: limits.total },
      ],
      new Date().toISOString().slice(0, 10),
    );
  }

  return { take, takeForVisitor };
}

export type SearchQuota = ReturnType<typeof createSearchQuota>;
