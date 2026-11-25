import type { Database } from "@offboard/db/client";
import {
  aiApplications,
  answerQuestions,
  applicationEvents,
  applicationPackages,
  applications,
  authUser,
  interviews,
  jobMatches,
  jobRejections,
  jobs,
  publicPageDailyViews,
  publicPages,
  resumes,
  resumeSuggestions,
  talentAnswers,
  talentPreferences,
  talentProfiles,
  teamMembers,
} from "@offboard/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { toPreferences } from "../../shared/talent-preferences.js";

const resumeJobs = alias(jobs, "resume_jobs");

export function createAccountRepository(db: Database) {
  async function exportData(profileId: string) {
    const [profile] = await db
      .select({
        name: talentProfiles.name,
        email: talentProfiles.personalEmail,
        sponsoredUntil: talentProfiles.sponsoredUntil,
        termsAcceptedAt: talentProfiles.termsAcceptedAt,
        shareOutcomeWithHr: talentProfiles.shareOutcomeWithHr,
        aiApplyConsentAt: talentProfiles.aiApplyConsentAt,
        aiApplyConsentVersion: talentProfiles.aiApplyConsentVersion,
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
        matchScore: resumes.matchScore,
        updatedAt: sql<Date>`coalesce(${resumes.updatedAt}, ${resumes.createdAt})`.mapWith(
          resumes.updatedAt,
        ),
        job: { title: jobs.title, company: jobs.company, url: jobs.url },
      })
      .from(resumes)
      .leftJoin(jobs, eq(jobs.id, resumes.jobId))
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
        resume: { kind: resumes.kind },
        resumeJob: { title: resumeJobs.title, company: resumeJobs.company },
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(resumes, eq(resumes.id, applications.resumeId))
      .leftJoin(resumeJobs, eq(resumeJobs.id, resumes.jobId))
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

    const [ownPage] = await db
      .select({
        slug: publicPages.slug,
        enabled: publicPages.enabled,
        createdAt: publicPages.createdAt,
        updatedAt: publicPages.updatedAt,
        resume: { kind: resumes.kind },
        resumeJob: { title: resumeJobs.title, company: resumeJobs.company },
      })
      .from(publicPages)
      .leftJoin(resumes, eq(resumes.id, publicPages.resumeId))
      .leftJoin(resumeJobs, eq(resumeJobs.id, resumes.jobId))
      .where(eq(publicPages.profileId, profileId));

    const views = await db
      .select({
        day: publicPageDailyViews.day,
        visits: publicPageDailyViews.visits,
        recruiterVisits: publicPageDailyViews.recruiterVisits,
      })
      .from(publicPageDailyViews)
      .where(eq(publicPageDailyViews.profileId, profileId))
      .orderBy(asc(publicPageDailyViews.day));

    const [ownPreferences] = await db
      .select()
      .from(talentPreferences)
      .where(eq(talentPreferences.profileId, profileId));

    const ownRejections = await db
      .select({
        job: { id: jobs.id, title: jobs.title, company: jobs.company },
        reason: jobRejections.reason,
        note: jobRejections.note,
        createdAt: jobRejections.createdAt,
      })
      .from(jobRejections)
      .innerJoin(jobs, eq(jobs.id, jobRejections.jobId))
      .where(eq(jobRejections.profileId, profileId))
      .orderBy(desc(jobRejections.createdAt), asc(jobRejections.jobId));

    const ownPackages = await db
      .select({
        job: { id: jobs.id, title: jobs.title, company: jobs.company },
        coverLetter: applicationPackages.coverLetter,
        updatedAt: applicationPackages.updatedAt,
      })
      .from(applicationPackages)
      .innerJoin(jobs, eq(jobs.id, applicationPackages.jobId))
      .where(eq(applicationPackages.profileId, profileId))
      .orderBy(
        sql`${applicationPackages.updatedAt} desc nulls last`,
        asc(applicationPackages.jobId),
      );

    const ownAnswers = await db
      .select({
        question: answerQuestions.text,
        answer: talentAnswers.answer,
        updatedAt: talentAnswers.updatedAt,
      })
      .from(talentAnswers)
      .innerJoin(answerQuestions, eq(answerQuestions.id, talentAnswers.questionId))
      .where(eq(talentAnswers.profileId, profileId))
      .orderBy(asc(answerQuestions.text), asc(answerQuestions.id));

    const ownAttempts = await db
      .select({
        job: { id: jobs.id, title: jobs.title, company: jobs.company },
        state: aiApplications.state,
        reason: aiApplications.reason,
        form: aiApplications.form,
        draft: aiApplications.draft,
        confirmed: aiApplications.confirmed,
        preparedAt: aiApplications.preparedAt,
        confirmedAt: aiApplications.confirmedAt,
        finishedAt: aiApplications.finishedAt,
      })
      .from(aiApplications)
      .innerJoin(jobs, eq(jobs.id, aiApplications.jobId))
      .where(eq(aiApplications.profileId, profileId))
      .orderBy(desc(aiApplications.createdAt), asc(aiApplications.id));

    return {
      profile: {
        name: profile.name,
        email: profile.email,
        sponsoredUntil: profile.sponsoredUntil,
        termsAcceptedAt: profile.termsAcceptedAt?.toISOString() ?? null,
        shareOutcomeWithHr: profile.shareOutcomeWithHr,
        aiApplyConsentAt: profile.aiApplyConsentAt?.toISOString() ?? null,
        aiApplyConsentVersion: profile.aiApplyConsentVersion,
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
        job: resume.job,
        matchScore: resume.matchScore,
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
      applications: ownApplications.map(({ id, appliedAt, resume, resumeJob, ...application }) => ({
        ...application,
        resume: resume && { kind: resume.kind, job: resumeJob },
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
      page: ownPage
        ? {
            slug: ownPage.slug,
            enabled: ownPage.enabled,
            resume: ownPage.resume && { kind: ownPage.resume.kind, job: ownPage.resumeJob },
            createdAt: ownPage.createdAt?.toISOString() ?? null,
            updatedAt: ownPage.updatedAt?.toISOString() ?? null,
          }
        : null,
      pageViews: views,
      preferences: toPreferences(ownPreferences),
      rejections: ownRejections.map((rejection) => ({
        ...rejection,
        createdAt: rejection.createdAt?.toISOString() ?? null,
      })),
      packages: ownPackages.map((item) => ({
        ...item,
        updatedAt: item.updatedAt?.toISOString() ?? null,
      })),
      aiApplications: ownAttempts.map(({ form, draft, confirmed, ...attempt }) => ({
        ...attempt,
        answers: (confirmed ?? draft).flatMap((answer) => {
          const question = form.questions.find((item) => item.id === answer.questionId);

          if (
            question === undefined ||
            ["resume", "cover_letter", "document"].includes(question.kind)
          ) {
            return [];
          }

          const options = question.fields[0]?.options ?? [];

          const label = (value: string) =>
            options.find((item) => item.value === value)?.label ?? value;

          return [
            {
              question: question.label,
              value: Array.isArray(answer.value)
                ? answer.value.map(label)
                : answer.value === null
                  ? null
                  : label(answer.value),
            },
          ];
        }),
        preparedAt: attempt.preparedAt.toISOString(),
        confirmedAt: attempt.confirmedAt?.toISOString() ?? null,
        finishedAt: attempt.finishedAt?.toISOString() ?? null,
      })),
      answers: ownAnswers.map((item) => ({
        question: item.question,
        answer: item.answer,
        updatedAt: item.updatedAt?.toISOString() ?? null,
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
