import type { Database } from "@offboard/db/client";
import {
  applicationEvents,
  applications,
  authUser,
  interviews,
  jobMatches,
  jobs,
  resumes,
  resumeSuggestions,
  talentProfiles,
  teamMembers,
} from "@offboard/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";

export function createAccountRepository(db: Database) {
  async function exportData(profileId: string) {
    const [profile] = await db
      .select({
        name: talentProfiles.name,
        email: talentProfiles.personalEmail,
        sponsoredUntil: talentProfiles.sponsoredUntil,
        termsAcceptedAt: talentProfiles.termsAcceptedAt,
        shareOutcomeWithHr: talentProfiles.shareOutcomeWithHr,
        firstSignedInAt: talentProfiles.firstSignedInAt,
        createdAt: talentProfiles.createdAt,
      })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, profileId));

    if (!profile) return undefined;

    const ownResumes = await db
      .select({
        id: resumes.id,
        kind: resumes.kind,
        status: resumes.status,
        content: resumes.content,
        score: resumes.score,
        scoredAt: resumes.scoredAt,
        updatedAt: sql<Date>`coalesce(${resumes.updatedAt}, ${resumes.createdAt})`.mapWith(
          resumes.updatedAt,
        ),
      })
      .from(resumes)
      .where(eq(resumes.profileId, profileId))
      .orderBy(asc(resumes.createdAt), asc(resumes.id));

    const suggestions = await db
      .select({
        resumeId: resumeSuggestions.resumeId,
        originalText: resumeSuggestions.originalText,
        suggestedText: resumeSuggestions.suggestedText,
        rationale: resumeSuggestions.rationale,
        estimatedGain: resumeSuggestions.estimatedGain,
        status: resumeSuggestions.status,
        createdAt: resumeSuggestions.createdAt,
      })
      .from(resumeSuggestions)
      .where(
        inArray(
          resumeSuggestions.resumeId,
          ownResumes.map((resume) => resume.id),
        ),
      )
      .orderBy(asc(resumeSuggestions.createdAt), asc(resumeSuggestions.id));

    const ownApplications = await db
      .select({
        id: applications.id,
        status: applications.status,
        closedReason: applications.closedReason,
        appliedAt: applications.appliedAt,
        job: { title: jobs.title, company: jobs.company, url: jobs.url },
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(eq(applications.profileId, profileId))
      .orderBy(desc(applications.appliedAt), desc(applications.id));

    const applicationIds = ownApplications.map((application) => application.id);

    const events = await db
      .select({
        applicationId: applicationEvents.applicationId,
        status: applicationEvents.status,
        closedReason: applicationEvents.closedReason,
        createdAt: applicationEvents.createdAt,
      })
      .from(applicationEvents)
      .where(inArray(applicationEvents.applicationId, applicationIds))
      .orderBy(asc(applicationEvents.createdAt), asc(applicationEvents.id));

    const meetings = await db
      .select({
        applicationId: interviews.applicationId,
        startsAt: interviews.startsAt,
        mode: interviews.mode,
        with: interviews.withWhom,
        notes: interviews.notes,
      })
      .from(interviews)
      .where(inArray(interviews.applicationId, applicationIds))
      .orderBy(asc(interviews.startsAt), asc(interviews.id));

    const ownMatches = await db
      .select({
        job: { title: jobs.title, company: jobs.company, url: jobs.url },
        score: jobMatches.score,
        reasons: jobMatches.reasons,
        computedAt: jobMatches.computedAt,
      })
      .from(jobMatches)
      .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
      .where(eq(jobMatches.profileId, profileId))
      .orderBy(desc(jobMatches.score), desc(jobMatches.computedAt), asc(jobMatches.jobId));

    return {
      profile: {
        name: profile.name,
        email: profile.email,
        sponsoredUntil: profile.sponsoredUntil,
        termsAcceptedAt: profile.termsAcceptedAt?.toISOString() ?? null,
        shareOutcomeWithHr: profile.shareOutcomeWithHr,
        firstSignedInAt: profile.firstSignedInAt?.toISOString() ?? null,
        createdAt: profile.createdAt?.toISOString() ?? null,
      },
      resumes: ownResumes.map((resume) => ({
        kind: resume.kind,
        status: resume.status,
        content: resume.content,
        score: resume.score,
        scoredAt: resume.scoredAt?.toISOString() ?? null,
        updatedAt: resume.updatedAt.toISOString(),
        suggestions: suggestions
          .filter((suggestion) => suggestion.resumeId === resume.id)
          .map((suggestion) => ({
            originalText: suggestion.originalText,
            suggestedText: suggestion.suggestedText,
            rationale: suggestion.rationale,
            estimatedGain: suggestion.estimatedGain,
            status: suggestion.status,
            createdAt: suggestion.createdAt?.toISOString() ?? null,
          })),
      })),
      applications: ownApplications.map(({ id, appliedAt, ...application }) => ({
        ...application,
        appliedAt: appliedAt.toISOString(),
        events: events
          .filter((event) => event.applicationId === id)
          .map((event) => ({
            status: event.status,
            closedReason: event.closedReason,
            createdAt: event.createdAt.toISOString(),
          })),
        interviews: meetings
          .filter((meeting) => meeting.applicationId === id)
          .map((meeting) => ({
            startsAt: meeting.startsAt.toISOString(),
            mode: meeting.mode,
            with: meeting.with,
            notes: meeting.notes,
          })),
      })),
      matches: ownMatches.map((match) => ({
        ...match,
        computedAt: match.computedAt.toISOString(),
      })),
    };
  }

  async function fileKeys(profileId: string) {
    const rows = await db
      .select({ key: sql<string>`${resumes.sourceFileKey}` })
      .from(resumes)
      .where(and(eq(resumes.profileId, profileId), isNotNull(resumes.sourceFileKey)));

    return rows.map((row) => row.key);
  }

  async function deleteProfile(profileId: string) {
    return db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(talentProfiles)
        .where(eq(talentProfiles.id, profileId))
        .returning({ email: sql<string>`lower(${talentProfiles.personalEmail})` });

      if (!deleted) return false;

      await tx.delete(authUser).where(
        and(
          eq(sql`lower(${authUser.email})`, deleted.email),
          notExists(
            tx
              .select({ id: teamMembers.id })
              .from(teamMembers)
              .where(eq(sql`lower(${teamMembers.email})`, deleted.email)),
          ),
        ),
      );

      return true;
    });
  }

  return { exportData, fileKeys, deleteProfile };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;
