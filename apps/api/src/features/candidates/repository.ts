import type { Database } from "@offboard/db/client";
import { resumes, talentProfiles } from "@offboard/db/schema";
import { and, asc, cosineDistance, eq, isNotNull, sql } from "drizzle-orm";

export function createCandidatesRepository(db: Database) {
  async function nearest(embedding: number[], limit: number) {
    const distance = cosineDistance(resumes.profileEmbedding, embedding);

    return db
      .select({
        id: resumes.id,
        name: talentProfiles.name,
        content: resumes.content,
        distance: sql<number>`${distance}`.mapWith(Number),
      })
      .from(resumes)
      .innerJoin(talentProfiles, eq(talentProfiles.id, resumes.profileId))
      .where(
        and(
          eq(resumes.kind, "base"),
          isNotNull(resumes.profileEmbedding),
          isNotNull(talentProfiles.searchableAt),
        ),
      )
      .orderBy(asc(distance), asc(resumes.id))
      .limit(limit);
  }

  return { nearest };
}

export type CandidatesRepository = ReturnType<typeof createCandidatesRepository>;
