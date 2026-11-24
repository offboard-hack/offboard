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
};

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const access = portalAccess(options.auth, webOrigin);

  const talent = talentAccess({
    auth: options.auth,
    webOrigin,
    talent: repos.talent,
    companyActive: async () => companySponsors((await repos.billing.getSubscription())?.status),
  });

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
      }),
    )
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
