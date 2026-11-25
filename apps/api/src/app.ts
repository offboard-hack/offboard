import { cors } from "@elysia/cors";
import { Elysia, t } from "elysia";
import { actionConfigsRoutes } from "./features/action-configs/routes.js";
import { fireActions } from "./features/action-configs/actions.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { employeeRoutes } from "./features/employee/routes.js";
import { authRoutes } from "./features/auth/routes.js";
import { createAbacatePayGateway, type AbacatePayGateway } from "./features/billing/abacatepay.js";
import { billingRoutes } from "./features/billing/routes.js";
import { equipmentRoutes } from "./features/equipment/routes.js";
import { exitSurveysRoutes } from "./features/exit-surveys/routes.js";
import { integrationsRoutes } from "./features/integrations/routes.js";
import { organizationsRoutes } from "./features/organizations/routes.js";
import { offboardingsRoutes } from "./features/offboardings/routes.js";
import type { TrackingConfig } from "./features/offboardings/correios.js";
import { teamRoutes } from "./features/team/routes.js";
import type { Repositories } from "./repositories.js";
import type { DispatchAction } from "./shared/action-dispatch.js";
import { portalAccess } from "./shared/access.js";

type AppOptions = {
  adapter?: NonNullable<ConstructorParameters<typeof Elysia>[0]>["adapter"];
  auth: PortalAuth;
  tracking?: TrackingConfig;
  cronSecret?: string;
  webhookSecret?: string;
  slackSigningSecret?: string;
  abacatepay?: AbacatePayGateway;
  abacatepayWebhookSecret?: string;
};

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const access = portalAccess(options.auth, webOrigin);

  const dispatchAction: DispatchAction = async (context, stepId) => {
    const getActionConfigsByPhase = stepId
      ? (orgId: string) => repos.actionConfigs.getActionConfigsByStep(orgId, stepId)
      : repos.actionConfigs.getActionConfigsByPhase;

    await fireActions({ getActionConfigsByPhase }, context);
  };

  return new Elysia({ adapter: options.adapter, prefix: "/api" })
    .use(cors({ origin: webOrigin, credentials: false }))
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
