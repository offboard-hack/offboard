import type { Database } from "@offboard/db/client";
import { candidateContactRequests, resumes, talentProfiles } from "@offboard/db/schema";
import { and, asc, cosineDistance, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

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

  async function contactTarget(resumeId: string) {
    const [row] = await db
      .select({ email: talentProfiles.personalEmail, name: talentProfiles.name })
      .from(resumes)
      .innerJoin(talentProfiles, eq(talentProfiles.id, resumes.profileId))
      .where(
        and(
          eq(resumes.id, resumeId),
          eq(resumes.kind, "base"),
          isNotNull(talentProfiles.searchableAt),
        ),
      );

    return row;
  }

  async function requestContact(request: typeof candidateContactRequests.$inferInsert) {
    await db.insert(candidateContactRequests).values(request);
  }

  async function claimContact(tokenHash: string, since: Date, now: Date) {
    const [row] = await db
      .update(candidateContactRequests)
      .set({ confirmedAt: now })
      .where(
        and(
          eq(candidateContactRequests.tokenHash, tokenHash),
          isNull(candidateContactRequests.confirmedAt),
          gt(candidateContactRequests.createdAt, since),
        ),
      )
      .returning({
        id: candidateContactRequests.id,
        resumeId: candidateContactRequests.resumeId,
        name: candidateContactRequests.name,
        email: candidateContactRequests.email,
        company: candidateContactRequests.company,
        message: candidateContactRequests.message,
      });

    return row;
  }

  async function releaseContact(id: string) {
    await db
      .update(candidateContactRequests)
      .set({ confirmedAt: null })
      .where(eq(candidateContactRequests.id, id));
  }

  return { nearest, contactTarget, requestContact, claimContact, releaseContact };
}

export type CandidatesRepository = ReturnType<typeof createCandidatesRepository>;
