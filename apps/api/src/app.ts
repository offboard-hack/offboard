import { cors } from "@elysia/cors";
import { Elysia, ElysiaCustomStatusResponse, t } from "elysia";
import { actionConfigsRoutes } from "./features/action-configs/routes.js";
import { fireActions } from "./features/action-configs/actions.js";
import { saoPauloDate } from "./shared/sao-paulo-date.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { employeeRoutes } from "./features/employee/routes.js";
import { applicationsRoutes } from "./features/applications/routes.js";
import { authRoutes } from "./features/auth/routes.js";
import { createAbacatePayGateway, type AbacatePayGateway } from "./features/billing/abacatepay.js";
import { benefitRoutes } from "./features/benefits/routes.js";
import { billingRoutes } from "./features/billing/routes.js";
import { equipmentRoutes } from "./features/equipment/routes.js";
import { catalogSources, type CatalogSource } from "./features/sources/catalog.js";
import { fetchFeed } from "./features/sources/sources.js";
import { exitSurveysRoutes } from "./features/exit-surveys/routes.js";
import { insightsRoutes } from "./features/insights/routes.js";
import { integrationsRoutes, slackTokenReader } from "./features/integrations/routes.js";
import { organizationsRoutes } from "./features/organizations/routes.js";
import { jobsRoutes } from "./features/jobs/routes.js";
import { offboardingsRoutes } from "./features/offboardings/routes.js";
import { toPublicResume } from "./features/pages/public-view.js";
import { pagesRoutes } from "./features/pages/routes.js";
import { talentRoutes } from "./features/talent/routes.js";
import { careerPlanRoutes } from "./features/career-plan/routes.js";
import { talentAccess } from "./shared/talent-access.js";
import { companySponsors } from "./shared/entitlement.js";
import type { AccessGranted, InviteEmployee } from "./shared/employee-invite.js";
import type { TalentProfile } from "./shared/talent-profile.js";
import { welcomeEmail, type WelcomeMessage } from "./features/talent/welcome.js";
import { employeeInviteEmail } from "./features/auth/sign-in-email.js";
import { resumesRoutes } from "./features/resumes/routes.js";
import { scoreIsCurrent } from "./features/resumes/repository.js";
import { scoreResume } from "./features/resumes/score.js";
import { scoreMatches, type MatchJob } from "./features/matches/score.js";
import { searchTerms, toTsQuery } from "./features/matches/terms.js";
import { backgroundRoutes } from "./features/background/routes.js";
import { drain, type JobHandler } from "./features/background/drain.js";
import { accountRoutes } from "./features/account/routes.js";
import type { ObjectStorage } from "./shared/object-storage.js";
import { logFailure, logFailureCode, logUnhandled } from "./shared/error-summary.js";
import { rejectionsRoutes } from "./features/preferences/rejections-routes.js";
import { answersRoutes } from "./features/preferences/answers-routes.js";
import { readGreenhouseForm } from "./features/ai-apply/greenhouse.js";
import { createAnswersRepository } from "./features/preferences/answers.js";
import { aiApplyRoutes } from "./features/ai-apply/routes.js";
import { createBrowserbase } from "./features/ai-apply/browser/browserbase.js";
import { openPage } from "./features/ai-apply/browser/cdp.js";
import { runAiApplication, type RunnerDeps } from "./features/ai-apply/runner.js";
import { packageRoutes } from "./features/preferences/package-routes.js";
import { createPreferencesRepository } from "./features/preferences/repository.js";
import { preferencesRoutes } from "./features/preferences/routes.js";
import type { TrackingConfig } from "./features/offboardings/correios.js";
import { teamRoutes } from "./features/team/routes.js";
import type { Repositories } from "./repositories.js";
import { dispatchTaskAction, type DispatchAction } from "./shared/action-dispatch.js";
import type { ResumeContent } from "@offboard/db/schema";
import { portalAccess } from "./shared/access.js";
import type { GenerateStructured } from "./shared/ai.js";
import { jobEmbeddingText, resumeEmbeddingText, textHash, type Embed } from "./shared/embed.js";
import { renderResumePdf } from "./shared/resume-pdf.js";
import { secretBox } from "./shared/secret-box.js";
import { defaultSlackApiUrl } from "./shared/slack.js";

const textCandidateLimit = 30;
const embeddedCandidateLimit = 50;
const matchBatch = 10;
const embedJobsLimit = 100;
const embedBatch = 20;
const embedSubject = "jobs";
const aiApplyBudgetMs = 210_000;

type AppOptions = {
  adapter?: NonNullable<ConstructorParameters<typeof Elysia>[0]>["adapter"];
  auth: PortalAuth;
  sendEmail: (message: WelcomeMessage) => Promise<void>;
  tracking?: TrackingConfig;
  cronSecret?: string;
  webhookSecret?: string;
  slackSigningSecret?: string;
  secretKey?: string;
  slackApiUrl?: string;
  abacatepay?: AbacatePayGateway;
  abacatepayWebhookSecret?: string;
  generateStructured?: GenerateStructured;
  embed?: Embed;
  catalog?: readonly CatalogSource[];
  fetchFeedImpl?: typeof fetch;
  fetchGreenhouseImpl?: typeof fetch;
  fetchBrowserImpl?: typeof fetch;
  storage?: ObjectStorage;
  runInBackground?: (task: () => Promise<void>) => void;
  publicPageOrigin?: string;
  browserbase?: { apiKey: string; projectId: string };
};

function ownResumePdf(name: string, content: ResumeContent) {
  const view = toPublicResume(name, content);

  return renderResumePdf({
    ...view,
    contact: { ...view.contact, phone: content.contact.phone, city: content.contact.city },
  });
}

const elysiaCodes = new Set<string | number>([
  "VALIDATION",
  "PARSE",
  "NOT_FOUND",
  "INVALID_COOKIE_SIGNATURE",
  "INVALID_FILE_TYPE",
]);

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const candidateLimit = options.embed ? embeddedCandidateLimit : textCandidateLimit;

  const access = portalAccess(options.auth, webOrigin);

  const box = options.secretKey ? secretBox(options.secretKey) : undefined;

  const slackApiUrl = options.slackApiUrl ?? defaultSlackApiUrl;
  const readSlackToken = slackTokenReader(repos.integrations, box);

  const dispatchAction: DispatchAction = async (context, stepId) => {
    const getActionConfigsByPhase = stepId
      ? (orgId: string) => repos.actionConfigs.getActionConfigsByStep(orgId, stepId)
      : repos.actionConfigs.getActionConfigsByPhase;

    await fireActions({ getActionConfigsByPhase }, context, {
      apiUrl: slackApiUrl,
      readToken: readSlackToken,
    });
  };

  const inviteEmployee: InviteEmployee = async (orgId, caseId) => {
    try {
      const invitee = await repos.employee.readInvitee(orgId, caseId);

      if (!invitee) return "missing-case";

      if (!invitee.email) return "no-email";

      if (!(await repos.employee.claimInvite(caseId))) return "rate-limited";

      await options.sendEmail(
        employeeInviteEmail({ ...invitee, email: invitee.email, origin: webOrigin }),
      );
    } catch {
      console.error({ event: "employee.invite_failed" });

      return "failed";
    }

    try {
      const changes = await repos.employee.markInviteSent(orgId, caseId);

      await Promise.allSettled(changes.map((change) => dispatchTaskAction(dispatchAction, change)));
    } catch {
      console.error({ event: "employee.invite_task_failed" });
    }

    return "sent";
  };

  async function applyCaseBenefit(orgId: string, caseId: string, profileId: string, at: Date) {
    const person = await repos.benefits.pendingPerson(orgId, caseId, profileId);

    if (person) await repos.benefits.applyBenefitPolicy(orgId, profileId, person, saoPauloDate(at));
  }

  const accessGranted: AccessGranted = async (orgId, caseId) => {
    try {
      const profile = await repos.talent.findByCase(orgId, caseId);

      if (profile) await applyCaseBenefit(orgId, caseId, profile.id, new Date());
    } catch {
      console.error({ event: "benefit.apply_failed" });
    }
  };

  const collaboratorBridged = async (me: TalentProfile, caseId: string, at: Date) => {
    try {
      await applyCaseBenefit(me.orgId, caseId, me.id, at);
    } catch {
      console.error({ event: "benefit.apply_failed" });
    }
  };

  const companyActive = async (orgId: string) =>
    companySponsors((await repos.billing.getSubscription(orgId))?.status);

  const talent = talentAccess({
    auth: options.auth,
    webOrigin,
    talent: repos.talent,
    collaboratorBridged,
    companyActive,
    individualPlan: repos.careerPlan.individual,
    benefitPlan: (profileId) =>
      repos.benefits.getEffectiveBenefit(profileId, saoPauloDate(new Date())),
  });

  const fetchGreenhouse = options.fetchGreenhouseImpl ?? fetch;

  const abacatepay = options.abacatepay ?? createAbacatePayGateway(undefined);

  const pageOrigin = (options.publicPageOrigin || webOrigin).replace(/\/$/, "");

  async function publicPageUrl(profileId: string, token: string) {
    const slug = await repos.pages.urlFor(profileId);

    return slug === null ? null : `${pageOrigin}/p/${slug}?a=${token}`;
  }

  const runInBackground =
    options.runInBackground ??
    ((task) => {
      void task().catch(() => undefined);
    });

  const fetchBrowser = options.fetchBrowserImpl ?? fetch;

  const runner = {
    repo: repos.aiApply,
    allowedBy: repos.careerPlan.allowedBy,
    browserbase: options.browserbase && createBrowserbase(fetchBrowser, options.browserbase),
    openPage: (connectUrl: string) => openPage(fetchBrowser, connectUrl),
    storage: options.storage,
    renderResume: ownResumePdf,
    budgetMs: 200_000,
    outcomeMs: 30_000,
  } satisfies RunnerDeps;

  const handlers = {
    ai_apply: (job) => runAiApplication(runner, job.subject, () => new Date()),
    ingest_jobs: async (job) => {
      const source = await repos.sources.get(job.subject);

      if (!source?.enabled) return;

      const result = await fetchFeed(
        { provider: source.kind, board: source.target, companyLabel: source.label },
        options.fetchFeedImpl,
      );

      if ("error" in result) {
        const failure = { kind: source.kind, target: source.target, error: result.error };

        if (result.error === "http_error") {
          console.error("source sync failed", { ...failure, status: result.status });
        } else {
          console.error("source sync failed", failure);
        }
      }

      const synced = await repos.sources.sync(source.id, result, new Date());

      if (synced === "failed") return;

      if (options.embed) {
        await repos.background
          .enqueue("embed_jobs", embedSubject)
          .catch(logFailure("embed jobs enqueue failed"));
      } else if (synced.created > 0) {
        await matchNewJob().catch(logFailure("source match fan-out failed"));
      }
    },
    embed_jobs: async () => {
      if (!options.embed) return;

      const rows = await repos.matches.jobsToEmbed(embedJobsLimit + 1);
      const batch = rows.slice(0, embedJobsLimit);

      for (let start = 0; start < batch.length; start += embedBatch) {
        const part = batch.slice(start, start + embedBatch);
        const vectors = await options.embed(part.map(jobEmbeddingText));

        await repos.matches.saveJobEmbeddings(
          part.map((row, index) => ({ id: row.id, embedding: vectors[index] })),
          new Date(),
        );
      }

      if (rows.length > embedJobsLimit) {
        await repos.background.enqueue("embed_jobs", embedSubject);
      } else if (batch.length > 0) {
        await matchNewJob().catch(logFailure("source match fan-out failed"));
      }
    },
    score_resume: async (job) => {
      const resume = await repos.resumes.forScoring(job.subject);

      if (!resume || scoreIsCurrent(resume)) return;

      if (!options.generateStructured) throw new Error("AI not configured");

      const taken = await repos.llmUsage.takeLlmCall(resume.profileId, new Date());

      if (taken !== true) return { postponeUntil: taken.retryAt };

      const result = await scoreResume(options.generateStructured, resume.content, {
        previous: resume.scoreBreakdown,
        history: await repos.resumeSuggestions.history(job.subject),
      });

      await repos.resumeSuggestions.saveScore(job.subject, resume.updatedAt, result, new Date());
    },
    compute_matches: async (job) => {
      const resume = await repos.matches.baseResume(job.subject);

      if (!resume) return;

      if (!options.generateStructured) throw new Error("AI not configured");

      const fresh = await repos.matches.freshJobIds(job.subject, resume.version);

      const titles = await repos.matches.targetTitles(job.subject);

      const textCandidates = () =>
        repos.matches.candidates(
          job.subject,
          toTsQuery(searchTerms(resume.content, titles)),
          candidateLimit,
        );

      const nearest = await nearestFor(job.subject, resume, titles);

      const topUp =
        nearest.length >= candidateLimit
          ? []
          : (await textCandidates()).filter((candidate) => !fresh.has(candidate.id));

      const pending = [...new Map([...nearest, ...topUp].map((item) => [item.id, item])).values()]
        .filter((candidate) => !fresh.has(candidate.id))
        .slice(0, candidateLimit);

      for (let start = 0; start < pending.length; start += matchBatch) {
        const taken = await repos.llmUsage.takeLlmCall(job.subject, new Date());

        if (taken !== true) return { postponeUntil: taken.retryAt };

        const results = await scoreMatches(
          options.generateStructured,
          resume.content,
          pending.slice(start, start + matchBatch),
        );

        if (!(await repos.matches.saveMatches(job.subject, resume.version, results, new Date()))) {
          return;
        }
      }
    },
  } satisfies Record<string, JobHandler>;

  async function resumeVector(
    profileId: string,
    resume: { content: ResumeContent },
    titles: string[],
    embed: Embed,
  ) {
    const text = resumeEmbeddingText(resume.content, titles);
    const hash = await textHash(text);
    const stored = await repos.matches.resumeEmbedding(profileId, hash);

    if (stored) return stored;

    const [embedding] = await embed([text]);

    await repos.matches.saveResumeEmbedding(profileId, hash, embedding);

    return embedding;
  }

  async function nearestFor(
    profileId: string,
    resume: { content: ResumeContent },
    titles: string[],
  ) {
    if (!options.embed) return [];

    try {
      const embedding = await resumeVector(profileId, resume, titles, options.embed);

      return await repos.matches.nearestCandidates(profileId, embedding, candidateLimit);
    } catch (cause) {
      logFailureCode("resume embedding failed")(cause);

      return [];
    }
  }

  async function enqueued(kind: string, subject: string) {
    try {
      await repos.background.enqueue(kind, subject);

      return true;
    } catch {
      return false;
    }
  }

  async function runScore(resumeId: string) {
    await drain(repos.background, handlers, {
      limit: 1,
      target: { kind: "score_resume", subject: resumeId },
    });
  }

  async function requestScore(resumeId: string) {
    const scoring = await enqueued("score_resume", resumeId);

    if (scoring) runInBackground(() => runScore(resumeId));

    return scoring;
  }

  async function rescore(resumeId: string, profileId: string) {
    const scoring = await requestScore(resumeId);

    await enqueued("compute_matches", profileId);

    return scoring;
  }

  const fitScore = (model: GenerateStructured) => async (content: ResumeContent, job: MatchJob) =>
    (await scoreMatches(model, content, [job])).find((result) => result.jobId === job.id)?.score ??
    null;

  async function matchNewJob() {
    const profiles = await repos.matches.profilesForMatching(new Date());

    const sponsors = [
      ...new Set(
        profiles.flatMap((profile) =>
          profile.collaborator || profile.individual ? [] : [profile.orgId],
        ),
      ),
    ];

    const active = new Set(
      (
        await Promise.all(
          sponsors.map(async (orgId) => ((await companyActive(orgId)) ? [orgId] : [])),
        )
      ).flat(),
    );

    await repos.background.enqueueMany(
      "compute_matches",
      profiles
        .filter(
          (profile) => profile.collaborator || profile.individual || active.has(profile.orgId),
        )
        .map((profile) => profile.profileId),
    );
  }

  const catalog = options.catalog ?? catalogSources;

  async function scheduleSources() {
    const now = new Date();

    await repos.sources
      .syncCatalog(catalog, now)
      .then(() => repos.sources.dueIds(now))
      .then((due) => repos.background.enqueueMany("ingest_jobs", due))
      .catch(logFailure("source scheduling failed"));
  }

  async function beforeDrain() {
    await repos.aiApply.sweepStale(new Date()).catch(logFailure("AI application sweep failed"));
    await scheduleSources();
    await repos.aiApply
      .queuedIds()
      .then((ids) => repos.background.enqueueMany("ai_apply", ids))
      .catch(logFailure("AI application scheduling failed"));
  }

  return new Elysia({ adapter: options.adapter, prefix: "/api" })
    .use(cors({ origin: webOrigin, credentials: false }))
    .onError(({ code, error, status }) => {
      if (elysiaCodes.has(code) || error instanceof ElysiaCustomStatusResponse) return undefined;

      logUnhandled(error);

      return status(500, { error: "Internal error" });
    })
    .get("/health", () => ({ status: "ok" }) satisfies { status: "ok" }, {
      response: t.Object({ status: t.Literal("ok") }),
    })
    .use(authRoutes(options.auth))
    .use(organizationsRoutes(repos.organizations))
    .use(
      employeeRoutes(
        repos.employee,
        access,
        options.auth.resolveEmployee,
        webOrigin,
        dispatchAction,
        inviteEmployee,
        accessGranted,
      ),
    )
    .use(
      offboardingsRoutes(
        repos.offboardings,
        access,
        dispatchAction,
        repos.actionConfigs.readChecklist,
        options.cronSecret,
        options.webhookSecret,
        inviteEmployee,
        options.tracking,
      ),
    )
    .use(actionConfigsRoutes(repos.actionConfigs, access))
    .use(teamRoutes(repos.team, access))
    .use(insightsRoutes(repos.insights, access))
    .use(
      talentRoutes(
        repos.talent,
        access,
        talent,
        (profile) => options.sendEmail(welcomeEmail(profile, webOrigin)),
        {
          allowedBy: repos.careerPlan.allowedBy,
          configured: options.generateStructured !== undefined && options.browserbase !== undefined,
        },
      ),
    )
    .use(careerPlanRoutes(repos.careerPlan, talent, abacatepay, webOrigin))
    .use(jobsRoutes(repos.jobs, talent))
    .use(applicationsRoutes(repos.applications, talent, publicPageUrl))
    .use(
      pagesRoutes(repos.pages, talent, {
        auth: options.auth,
        companyActive,
        origin: pageOrigin,
      }),
    )
    .use(
      resumesRoutes(repos.resumes, talent, {
        generate: options.generateStructured,
        storage: options.storage,
        suggestions: repos.resumeSuggestions,
        rescore,
        requestScore,
        runScore,
        versions: repos.resumeVersions,
        takeLlmCall: repos.llmUsage.takeLlmCall,
        fitScore: options.generateStructured && fitScore(options.generateStructured),
        renderPdf: ownResumePdf,
      }),
    )
    .use(
      preferencesRoutes(repos.preferences, talent, async (profileId) => {
        await repos.background
          .enqueue("compute_matches", profileId)
          .catch(logFailure("title re-match enqueue failed"));
      }),
    )
    .use(answersRoutes(repos.answers, talent))
    .use(rejectionsRoutes(repos.rejections, talent))
    .use(
      packageRoutes(repos.packages, talent, {
        generate: options.generateStructured,
        takeLlmCall: repos.llmUsage.takeLlmCall,
      }),
    )
    .use(
      aiApplyRoutes(repos.aiApply, talent, {
        allowedBy: repos.careerPlan.allowedBy,
        generate: options.generateStructured,
        runnerConfigured: options.browserbase !== undefined,
        takeLlmCall: repos.llmUsage.takeLlmCall,
        readForm: (board, posting) => readGreenhouseForm(fetchGreenhouse, board, posting),
        library: async (profileId) =>
          (await repos.answers.library(profileId)).questions.flatMap((item) =>
            item.answer === null
              ? []
              : [{ question: item.text, answer: item.answer, sensitive: item.sensitive }],
          ),
        enqueueRun: (attemptId) => repos.background.enqueue("ai_apply", attemptId),
        runNow: async (attemptId) => {
          const target = { kind: "ai_apply", subject: attemptId };

          if (!(await repos.background.scheduled(target))) {
            await repos.background.enqueue(target.kind, target.subject);
          }

          const drained = await drain(repos.background, handlers, {
            limit: 1,
            budgetMs: aiApplyBudgetMs,
            target,
          });

          return drained.processed + drained.failed > 0;
        },
        storage: options.storage,
        saveAnswer: async (tx, profileId, label, text, { sensitive }, now) => {
          const answers = createAnswersRepository(tx);
          const questionId = await answers.ensureQuestion(label, now, { sensitive });

          await answers.answer(profileId, questionId, text, now);
        },
        saveProfile: (tx, profileId, values, now) =>
          createPreferencesRepository(tx).fillUnset(profileId, values, now),
      }),
    )
    .use(
      backgroundRoutes(repos.background, handlers, options.cronSecret, {
        beforeDrain,
        isolated: { kind: "ai_apply", budgetMs: aiApplyBudgetMs },
      }),
    )
    .use(accountRoutes(repos.account, talent, options.storage))
    .use(equipmentRoutes(repos.equipment, access))
    .use(exitSurveysRoutes(repos.exitSurveys, access))
    .use(
      integrationsRoutes(repos.integrations, access, options.slackSigningSecret, box, slackApiUrl),
    )
    .use(benefitRoutes(repos.benefits, access))
    .use(
      billingRoutes(repos.billing, access, abacatepay, webOrigin, options.abacatepayWebhookSecret),
    );
}

export type App = ReturnType<typeof createApp>;
