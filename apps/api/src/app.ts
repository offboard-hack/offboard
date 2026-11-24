import { cors } from "@elysia/cors";
import { Elysia, t } from "elysia";
import { actionConfigsRoutes } from "./features/action-configs/routes.js";
import { fireActions } from "./features/action-configs/actions.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { applicationsRoutes } from "./features/applications/routes.js";
import { authRoutes } from "./features/auth/routes.js";
import { createAbacatePayGateway, type AbacatePayGateway } from "./features/billing/abacatepay.js";
import { billingRoutes } from "./features/billing/routes.js";
import { equipmentRoutes } from "./features/equipment/routes.js";
import { exitSurveysRoutes } from "./features/exit-surveys/routes.js";
import { integrationsRoutes } from "./features/integrations/routes.js";
import { jobsRoutes } from "./features/jobs/routes.js";
import { offboardingsRoutes } from "./features/offboardings/routes.js";
import { talentRoutes } from "./features/talent/routes.js";
import { talentAccess } from "./shared/talent-access.js";
import { companySponsors } from "./shared/entitlement.js";
import { welcomeEmail, type WelcomeMessage } from "./features/talent/welcome.js";
import { resumesRoutes } from "./features/resumes/routes.js";
import { scoreResume } from "./features/resumes/score.js";
import { backgroundRoutes } from "./features/background/routes.js";
import { drain, type JobHandler } from "./features/background/drain.js";
import { accountRoutes } from "./features/account/routes.js";
import type { ObjectStorage } from "./shared/object-storage.js";
import { teamRoutes } from "./features/team/routes.js";
import type { Repositories } from "./repositories.js";
import { portalAccess } from "./shared/access.js";
import type { GenerateStructured } from "./shared/ai.js";
import { fetchPageText, type FetchPageResult } from "./shared/page-text.js";

type AppOptions = {
  adapter?: NonNullable<ConstructorParameters<typeof Elysia>[0]>["adapter"];
  auth: PortalAuth;
  sendEmail: (message: WelcomeMessage) => Promise<void>;
  correiosBaseUrl?: string;
  cronSecret?: string;
  webhookSecret?: string;
  slackSigningSecret?: string;
  abacatepay?: AbacatePayGateway;
  abacatepayWebhookSecret?: string;
  generateStructured?: GenerateStructured;
  fetchPage?: (url: URL) => Promise<FetchPageResult>;
  storage?: ObjectStorage;
  runInBackground?: (task: () => Promise<void>) => void;
};

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const access = portalAccess(options.auth, webOrigin);

  const talent = talentAccess({
    auth: options.auth,
    webOrigin,
    talent: repos.talent,
    companyActive: async () => companySponsors((await repos.billing.getSubscription())?.status),
  });

  const runInBackground =
    options.runInBackground ??
    ((task) => {
      void task().catch(() => undefined);
    });

  const handlers = {
    score_resume: async (job) => {
      const resume = await repos.resumes.forScoring(job.subject);

      if (!resume || resume.score !== null) return;

      if (!options.generateStructured) throw new Error("AI not configured");

      const taken = await repos.llmUsage.takeLlmCall(resume.profileId, new Date());

      if (taken !== true) return { postponeUntil: taken.retryAt };

      const result = await scoreResume(options.generateStructured, resume.content);

      await repos.resumeSuggestions.saveScore(job.subject, resume.updatedAt, result, new Date());
    },
  } satisfies Record<string, JobHandler>;

  async function rescore(resumeId: string) {
    try {
      await repos.background.enqueue("score_resume", resumeId);
    } catch {
      return;
    }

    runInBackground(async () => {
      await drain(repos.background, handlers, { limit: 1 });
    });
  }

  return new Elysia({ adapter: options.adapter, prefix: "/api" })
    .use(cors({ origin: webOrigin, credentials: false }))
    .get("/health", () => ({ status: "ok" }) satisfies { status: "ok" }, {
      response: t.Object({ status: t.Literal("ok") }),
    })
    .use(authRoutes(options.auth))
    .use(
      offboardingsRoutes(
        repos.offboardings,
        access,
        async (context) => {
          await fireActions(repos.actionConfigs, context);
        },
        options.cronSecret,
        options.webhookSecret,
        options.correiosBaseUrl,
      ),
    )
    .use(actionConfigsRoutes(repos.actionConfigs, access))
    .use(teamRoutes(repos.team, access))
    .use(
      talentRoutes(repos.talent, access, talent, (profile) =>
        options.sendEmail(welcomeEmail(profile, webOrigin)),
      ),
    )
    .use(
      jobsRoutes(repos.jobs, access, talent, {
        generate: options.generateStructured,
        fetchPage: options.fetchPage ?? fetchPageText,
      }),
    )
    .use(applicationsRoutes(repos.applications, talent))
    .use(
      resumesRoutes(repos.resumes, talent, {
        generate: options.generateStructured,
        storage: options.storage,
        suggestions: repos.resumeSuggestions,
        rescore,
      }),
    )
    .use(backgroundRoutes(repos.background, handlers, options.cronSecret))
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
