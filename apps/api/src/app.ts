import { cors } from "@elysia/cors";
import { Elysia, t } from "elysia";
import { actionConfigsRoutes } from "./features/action-configs/routes.js";
import { fireActions } from "./features/action-configs/actions.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { employeeRoutes } from "./features/employee/routes.js";
import { applicationsRoutes } from "./features/applications/routes.js";
import { authRoutes } from "./features/auth/routes.js";
import { createAbacatePayGateway, type AbacatePayGateway } from "./features/billing/abacatepay.js";
import { billingRoutes } from "./features/billing/routes.js";
import { equipmentRoutes } from "./features/equipment/routes.js";
import { catalogSources, type CatalogSource } from "./features/sources/catalog.js";
import { fetchFeed } from "./features/sources/sources.js";
import { exitSurveysRoutes } from "./features/exit-surveys/routes.js";
import { insightsRoutes } from "./features/insights/routes.js";
import { integrationsRoutes } from "./features/integrations/routes.js";
import { organizationsRoutes } from "./features/organizations/routes.js";
import { jobsRoutes } from "./features/jobs/routes.js";
import { offboardingsRoutes } from "./features/offboardings/routes.js";
import { toPublicResume } from "./features/pages/public-view.js";
import { pagesRoutes } from "./features/pages/routes.js";
import { talentRoutes } from "./features/talent/routes.js";
import { talentAccess } from "./shared/talent-access.js";
import { companySponsors } from "./shared/entitlement.js";
import { welcomeEmail, type WelcomeMessage } from "./features/talent/welcome.js";
import { resumesRoutes } from "./features/resumes/routes.js";
import { scoreResume } from "./features/resumes/score.js";
import { scoreMatches, type MatchJob } from "./features/matches/score.js";
import { searchTerms, toTsQuery } from "./features/matches/terms.js";
import { backgroundRoutes } from "./features/background/routes.js";
import { drain, type JobHandler } from "./features/background/drain.js";
import { accountRoutes } from "./features/account/routes.js";
import type { ObjectStorage } from "./shared/object-storage.js";
import { logFailure, logUnhandled } from "./shared/error-summary.js";
import { rejectionsRoutes } from "./features/preferences/rejections-routes.js";
import { answersRoutes } from "./features/preferences/answers-routes.js";
import { readGreenhouseForm } from "./features/ai-apply/greenhouse.js";
import { createAnswersRepository } from "./features/preferences/answers.js";
import { aiApplyRoutes } from "./features/ai-apply/routes.js";
import { packageRoutes } from "./features/preferences/package-routes.js";
import { preferencesRoutes } from "./features/preferences/routes.js";
import type { TrackingConfig } from "./features/offboardings/correios.js";
import { teamRoutes } from "./features/team/routes.js";
import type { Repositories } from "./repositories.js";
import type { DispatchAction } from "./shared/action-dispatch.js";
import type { ResumeContent } from "@offboard/db/schema";
import { portalAccess } from "./shared/access.js";
import type { GenerateStructured } from "./shared/ai.js";
import { renderResumePdf } from "./shared/resume-pdf.js";

const matchCandidates = 30;
const matchBatch = 10;

type AppOptions = {
  adapter?: NonNullable<ConstructorParameters<typeof Elysia>[0]>["adapter"];
  auth: PortalAuth;
  sendEmail: (message: WelcomeMessage) => Promise<void>;
  tracking?: TrackingConfig;
  cronSecret?: string;
  webhookSecret?: string;
  slackSigningSecret?: string;
  abacatepay?: AbacatePayGateway;
  abacatepayWebhookSecret?: string;
  generateStructured?: GenerateStructured;
  catalog?: readonly CatalogSource[];
  fetchFeedImpl?: typeof fetch;
  fetchGreenhouseImpl?: typeof fetch;
  storage?: ObjectStorage;
  runInBackground?: (task: () => Promise<void>) => void;
  publicPageOrigin?: string;
  aiApplyAllowlist?: string[];
};

function ownResumePdf(name: string, content: ResumeContent) {
  const view = toPublicResume(name, content);

  return renderResumePdf({
    ...view,
    contact: { ...view.contact, phone: content.contact.phone, city: content.contact.city },
  });
}

const unhandledCodes = new Set<string | number>(["UNKNOWN", "INTERNAL_SERVER_ERROR"]);

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const access = portalAccess(options.auth, webOrigin);

  const dispatchAction: DispatchAction = async (context, stepId) => {
    const getActionConfigsByPhase = stepId
      ? (orgId: string) => repos.actionConfigs.getActionConfigsByStep(orgId, stepId)
      : repos.actionConfigs.getActionConfigsByPhase;

    await fireActions({ getActionConfigsByPhase }, context);
  };

  const companyActive = async (orgId: string) =>
    companySponsors((await repos.billing.getSubscription(orgId))?.status);

  const talent = talentAccess({
    auth: options.auth,
    webOrigin,
    talent: repos.talent,
    companyActive,
  });

  const fetchGreenhouse = options.fetchGreenhouseImpl ?? fetch;

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

  const handlers = {
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

      if (synced !== "failed" && synced.created > 0) {
        await matchNewJob().catch(logFailure("source match fan-out failed"));
      }
    },
    score_resume: async (job) => {
      const resume = await repos.resumes.forScoring(job.subject);

      if (!resume || resume.score !== null) return;

      if (!options.generateStructured) throw new Error("AI not configured");

      const taken = await repos.llmUsage.takeLlmCall(resume.profileId, new Date());

      if (taken !== true) return { postponeUntil: taken.retryAt };

      const result = await scoreResume(options.generateStructured, resume.content);

      await repos.resumeSuggestions.saveScore(job.subject, resume.updatedAt, result, new Date());
    },
    compute_matches: async (job) => {
      const resume = await repos.matches.baseResume(job.subject);

      if (!resume) return;

      if (!options.generateStructured) throw new Error("AI not configured");

      const fresh = await repos.matches.freshJobIds(job.subject, resume.version);

      const titles = await repos.matches.targetTitles(job.subject);

      const pending = (
        await repos.matches.candidates(
          job.subject,
          toTsQuery(searchTerms(resume.content, titles)),
          matchCandidates,
        )
      ).filter((candidate) => !fresh.has(candidate.id));

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

  async function enqueued(kind: string, subject: string) {
    try {
      await repos.background.enqueue(kind, subject);

      return true;
    } catch {
      return false;
    }
  }

  async function rescore(resumeId: string, profileId: string) {
    const scoring = await enqueued("score_resume", resumeId);

    await enqueued("compute_matches", profileId);

    if (!scoring) return;

    runInBackground(async () => {
      await drain(repos.background, handlers, {
        limit: 1,
        target: { kind: "score_resume", subject: resumeId },
      });
    });
  }

  const fitScore = (model: GenerateStructured) => async (content: ResumeContent, job: MatchJob) =>
    (await scoreMatches(model, content, [job])).find((result) => result.jobId === job.id)?.score ??
    null;

  async function matchNewJob() {
    const profiles = await repos.matches.profilesForMatching(new Date());
    const sponsors = [...new Set(profiles.map((profile) => profile.orgId))];

    const active = new Set(
      (
        await Promise.all(
          sponsors.map(async (orgId) => ((await companyActive(orgId)) ? [orgId] : [])),
        )
      ).flat(),
    );

    await repos.background.enqueueMany(
      "compute_matches",
      profiles.filter((profile) => active.has(profile.orgId)).map((profile) => profile.profileId),
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

  return new Elysia({ adapter: options.adapter, prefix: "/api" })
    .use(cors({ origin: webOrigin, credentials: false }))
    .onError(({ code, error, status }) => {
      if (!unhandledCodes.has(code)) return undefined;

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
          allowlist: options.aiApplyAllowlist ?? [],
          configured: options.generateStructured !== undefined,
        },
      ),
    )
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
        allowlist: options.aiApplyAllowlist ?? [],
        generate: options.generateStructured,
        takeLlmCall: repos.llmUsage.takeLlmCall,
        readForm: (board, posting) => readGreenhouseForm(fetchGreenhouse, board, posting),
        library: async (profileId) =>
          (await repos.answers.library(profileId)).questions.flatMap((item) =>
            item.answer === null
              ? []
              : [{ question: item.text, answer: item.answer, sensitive: item.sensitive }],
          ),
        saveAnswer: async (tx, profileId, label, text, { sensitive }, now) => {
          const answers = createAnswersRepository(tx);
          const questionId = await answers.ensureQuestion(label, now, { sensitive });

          await answers.answer(profileId, questionId, text, now);
        },
      }),
    )
    .use(backgroundRoutes(repos.background, handlers, options.cronSecret, scheduleSources))
    .use(accountRoutes(repos.account, talent, options.storage))
    .use(equipmentRoutes(repos.equipment, access))
    .use(exitSurveysRoutes(repos.exitSurveys, access))
    .use(integrationsRoutes(repos.integrations, access, options.slackSigningSecret))
    .use(
      billingRoutes(
        repos.billing,
        access,
        options.abacatepay ?? createAbacatePayGateway(undefined),
        webOrigin,
        options.abacatepayWebhookSecret,
      ),
    );
}

export type App = ReturnType<typeof createApp>;
