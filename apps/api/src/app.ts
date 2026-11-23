import { cors } from "@elysia/cors";
import { Elysia, t } from "elysia";
import { actionConfigsRoutes } from "./features/action-configs/routes.js";
import { fireActions } from "./features/action-configs/actions.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { authRoutes } from "./features/auth/routes.js";
import { equipmentRoutes } from "./features/equipment/routes.js";
import { exitSurveysRoutes } from "./features/exit-surveys/routes.js";
import { integrationsRoutes } from "./features/integrations/routes.js";
import { offboardingsRoutes } from "./features/offboardings/routes.js";
import { teamRoutes } from "./features/team/routes.js";
import type { Repositories } from "./repositories.js";
import { portalAccess } from "./shared/access.js";

type AppOptions = {
  adapter?: NonNullable<ConstructorParameters<typeof Elysia>[0]>["adapter"];
  auth: PortalAuth;
  correiosBaseUrl?: string;
  cronSecret?: string;
  webhookSecret?: string;
  slackSigningSecret?: string;
};

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const access = portalAccess(options.auth, webOrigin);

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
    .use(equipmentRoutes(repos.equipment, access))
    .use(exitSurveysRoutes(repos.exitSurveys, access))
    .use(integrationsRoutes(repos.integrations, access, options.slackSigningSecret));
}

export type App = ReturnType<typeof createApp>;
