import { cors } from "@elysia/cors";
import { Elysia, t } from "elysia";
import { actionConfigsRoutes } from "./features/action-configs/routes.js";
import { fireActions } from "./features/action-configs/actions.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { automationRulesRoutes } from "./features/automation-rules/routes.js";
import { fireRulesForTrigger, runScheduledRules } from "./features/automation-rules/engine.js";
import { createCorreiosCheck } from "./features/offboardings/correios-check.js";
import type { DispatchAction } from "./shared/action-dispatch.js";
import type { FireRules } from "./shared/rule-dispatch.js";
import { authRoutes } from "./features/auth/routes.js";
import { createAbacatePayGateway, type AbacatePayGateway } from "./features/billing/abacatepay.js";
import { billingRoutes } from "./features/billing/routes.js";
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
  abacatepay?: AbacatePayGateway;
  abacatepayWebhookSecret?: string;
};

export function createApp(webOrigin: string, repos: Repositories, options: AppOptions) {
  const access = portalAccess(options.auth, webOrigin);

  const engine = {
    automationRules: repos.automationRules,
    offboardings: repos.offboardings,
    equipment: repos.equipment,
    runCorreiosCheck: async () => {
      await checkTrackedShipments();
    },
  };

  const fireRules: FireRules = (trigger, context) => fireRulesForTrigger(trigger, context, engine);

  const dispatchAction: DispatchAction = async (context) => {
    await fireActions(repos.actionConfigs, context);
  };

  const checkTrackedShipments = createCorreiosCheck(
    repos.offboardings,
    dispatchAction,
    fireRules,
    options.correiosBaseUrl,
  );

  async function runScheduled() {
    const results = await runScheduledRules(engine);

    return { ran: results.length, failed: results.filter((r) => r.errors.length > 0).length };
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
        dispatchAction,
        fireRules,
        checkTrackedShipments,
        options.cronSecret,
        options.webhookSecret,
        options.correiosBaseUrl,
      ),
    )
    .use(actionConfigsRoutes(repos.actionConfigs, access))
    .use(automationRulesRoutes(repos.automationRules, access, runScheduled, options.cronSecret))
    .use(teamRoutes(repos.team, access))
    .use(equipmentRoutes(repos.equipment, access, fireRules))
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
