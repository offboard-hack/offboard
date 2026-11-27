import { Elysia, t } from "elysia";
import { logFailureCode } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import type { BenefitCopayRepository, CopayCheckoutPorts } from "./repository.js";

type CopayGateway = {
  configured: boolean;
  ensureCopayProduct: CopayCheckoutPorts["ensureProduct"];
  createSubscriptionCheckout(params: {
    externalId: string;
    planSlug: string;
    returnUrl: string;
    completionUrl: string;
  }): Promise<{ id: string; url: string }>;
  cancelSubscription(id: string): Promise<void>;
};

const refusals = {
  no_benefit: "No active benefit",
  top_tier: "Already on the top tier",
  pro_active: "Carreira Pro is active",
  already_active: "An upgrade is already active",
} as const;

export function benefitCopayRoutes(
  repos: BenefitCopayRepository,
  talentAccess: TalentAccessPlugin,
  gateway: CopayGateway,
  webOrigin: string,
) {
  const careerScreen = `${webOrigin}/colaborador?tela=carreira`;

  const ports = {
    ensureProduct: gateway.ensureCopayProduct,
    createCheckout: (params: { externalId: string; planSlug: string }) =>
      gateway.createSubscriptionCheckout({
        ...params,
        returnUrl: careerScreen,
        completionUrl: `${careerScreen}&plano=ok`,
      }),
    cancelSubscription: gateway.cancelSubscription,
  } satisfies CopayCheckoutPorts;

  return new Elysia()
    .use(talentAccess)
    .post(
      "/me/benefit/copay/checkout",
      async ({ me, status }) => {
        if (!gateway.configured) return status(503, { error: "Billing not configured" });

        try {
          const started = await repos.startCheckout(me.id, me.orgId, new Date(), ports);

          if (started.outcome !== "issued") {
            return status(409, { error: refusals[started.outcome] });
          }

          return { url: started.url, checkoutId: started.checkoutId };
        } catch (cause) {
          logFailureCode("Benefit co-pay checkout failed")(cause);

          return status(502, { error: "Could not start the checkout" });
        }
      },
      {
        talent: "signed-in",
        response: {
          200: t.Object({ url: t.String(), checkoutId: t.String() }),
          409: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/me/benefit/copay/cancel",
      async ({ me, status }) => {
        if (!gateway.configured) return status(503, { error: "Billing not configured" });

        const copay = await repos.cancelable(me.id, me.orgId);

        if (!copay) return status(409, { error: "No active upgrade" });

        try {
          await gateway.cancelSubscription(copay.providerSubscriptionId);
        } catch (cause) {
          logFailureCode("Benefit co-pay cancellation failed")(cause);

          return status(502, { error: "Could not cancel the upgrade" });
        }

        await repos.markCanceled(copay.assignmentId, copay.providerSubscriptionId, new Date());

        return { currentPeriodEnd: copay.currentPeriodEnd };
      },
      {
        talent: "signed-in",
        response: {
          200: t.Object({ currentPeriodEnd: t.Union([t.String(), t.Null()]) }),
          409: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    );
}
