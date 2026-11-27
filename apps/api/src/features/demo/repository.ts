import type { Database } from "@offboard/db/client";
import { demoProfileEmbeddings } from "@offboard/db/schema";
import { asc, cosineDistance, notInArray, sql } from "drizzle-orm";

export function createDemoRepository(db: Database) {
  async function stored() {
    return db
      .select({ slug: demoProfileEmbeddings.slug, hash: demoProfileEmbeddings.embeddedHash })
      .from(demoProfileEmbeddings);
  }

  async function save(entries: { slug: string; hash: string; embedding: number[] }[]) {
    for (const entry of entries) {
      await db
        .insert(demoProfileEmbeddings)
        .values({ slug: entry.slug, embeddedHash: entry.hash, embedding: entry.embedding })
        .onConflictDoUpdate({
          target: demoProfileEmbeddings.slug,
          set: { embeddedHash: entry.hash, embedding: entry.embedding },
        });
    }
  }

  async function keepOnly(slugs: string[]) {
    await db.delete(demoProfileEmbeddings).where(notInArray(demoProfileEmbeddings.slug, slugs));
  }

  async function nearest(embedding: number[], limit: number) {
    const distance = cosineDistance(demoProfileEmbeddings.embedding, embedding);

    return db
      .select({
        slug: demoProfileEmbeddings.slug,
        distance: sql<number>`${distance}`.mapWith(Number),
      })
      .from(demoProfileEmbeddings)
      .orderBy(asc(distance), asc(demoProfileEmbeddings.slug))
      .limit(limit);
  }

  return { stored, save, keepOnly, nearest };
}

export type DemoRepository = ReturnType<typeof createDemoRepository>;
