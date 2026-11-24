import type { Database } from "@offboard/db/client";
import {
  applicationEvents,
  applications,
  interviews,
  jobs,
  resumes,
  talentProfiles,
} from "@offboard/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

export function createAccountRepository(db: Database) {
  async function exportData(profileId: string) {
    const [profile] = await db
      .select({
        name: talentProfiles.name,
        email: talentProfiles.personalEmail,
        sponsoredUntil: talentProfiles.sponsoredUntil,
        termsAcceptedAt: talentProfiles.termsAcceptedAt,
      })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, profileId));

    if (!profile) return undefined;

    const ownResumes = await db
      .select({
        kind: resumes.kind,
        status: resumes.status,
        content: resumes.content,
        updatedAt: sql<Date>`coalesce(${resumes.updatedAt}, ${resumes.createdAt})`.mapWith(
          resumes.updatedAt,
        ),
      })
      .from(resumes)
      .where(eq(resumes.profileId, profileId))
      .orderBy(asc(resumes.createdAt), asc(resumes.id));

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

    return {
      profile: {
        name: profile.name,
        email: profile.email,
        sponsoredUntil: profile.sponsoredUntil,
        termsAcceptedAt: profile.termsAcceptedAt?.toISOString() ?? null,
      },
      resumes: ownResumes.map((resume) => ({
        kind: resume.kind,
        status: resume.status,
        content: resume.content,
        updatedAt: resume.updatedAt.toISOString(),
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
    const deleted = await db
      .delete(talentProfiles)
      .where(eq(talentProfiles.id, profileId))
      .returning({ id: talentProfiles.id });

    return deleted.length > 0;
  }

  return { exportData, fileKeys, deleteProfile };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;
