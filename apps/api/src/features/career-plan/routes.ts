import { Elysia, t } from "elysia";
import { careerPro } from "../../shared/career-pro.js";
import { logFailureCode } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import type { CareerPlanRepository } from "./repository.js";

const nullableDate = t.Union([t.String(), t.Null()]);

const careerPlanResponse = t.Object({
  company: t.Object({
    name: t.Union([t.String(), t.Null()]),
    includesAiApply: t.Boolean(),
    sponsoredUntil: t.String(),
  }),
  individual: t.Union([
    t.Object({
      plan: t.Literal("carreira-pro"),
      status: t.Union([
        t.Literal("pending"),
        t.Literal("active"),
        t.Literal("past_due"),
        t.Literal("canceled"),
      ]),
      currentPeriodEnd: nullableDate,
    }),
    t.Null(),
  ]),
  aiApply: t.Object({
    allowedBy: t.Union([t.Literal("company"), t.Literal("individual"), t.Null()]),
  }),
  upgrade: t.Object({
    offered: t.Boolean(),
    priceCents: t.Literal(7900),
    dailyLimit: t.Literal(10),
  }),
});

type CareerCheckout = {
  configured: boolean;
  createSubscriptionCheckout(params: {
    externalId: string;
    planSlug: string;
    returnUrl: string;
    completionUrl: string;
  }): Promise<{ url: string }>;
};

export function careerPlanRoutes(
  repos: CareerPlanRepository,
  talentAccess: TalentAccessPlugin,
  gateway: CareerCheckout,
  webOrigin: string,
) {
  const careerScreen = `${webOrigin}/colaborador?tela=carreira`;

  return new Elysia()
    .use(talentAccess)
    .get(
      "/me/plan",
      async ({ me, status }) => {
        const plan = await repos.plan(me.id, new Date());

        if (!plan) return status(404, { error: "Profile not found" });

        return {
          ...plan,
          upgrade: { ...plan.upgrade, offered: plan.upgrade.offered && gateway.configured },
        };
      },
      {
        talent: "signed-in",
        response: { 200: careerPlanResponse, 404: errorResponse },
      },
    )
    .post(
      "/me/plan/checkout",
      async ({ me, status }) => {
        if (!gateway.configured) return status(503, { error: "Billing not configured" });

        const row = await repos.startCheckout(me.id, new Date());

        if (!row) return status(409, { error: "Already subscribed" });

        try {
          const checkout = await gateway.createSubscriptionCheckout({
            externalId: `talent:${row.profileId}`,
            planSlug: careerPro.slug,
            returnUrl: careerScreen,
            completionUrl: `${careerScreen}&plano=ok`,
          });

          return { url: checkout.url };
        } catch (cause) {
          logFailureCode("Carreira Pro checkout failed")(cause);

          return status(502, { error: "Could not start the checkout" });
        }
      },
      {
        talent: "signed-in",
        response: {
          200: t.Object({ url: t.String() }),
          409: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    );
}
