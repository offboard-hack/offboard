import { Elysia, t } from "elysia";
import { careerPro } from "../../shared/career-pro.js";
import { logFailureCode } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
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
      cancelable: t.Boolean(),
    }),
    t.Null(),
  ]),
  benefit: t.Union([
    t.Object({
      planName: t.String(),
      aiApplyDailyLimit: t.Number(),
      aiApplyPriority: t.Boolean(),
      detailedScore: t.Boolean(),
      validUntil: t.String(),
      source: t.Union([t.Literal("default"), t.Literal("rule"), t.Literal("manual")]),
    }),
    t.Null(),
  ]),
  aiApply: t.Object({
    allowedBy: t.Union([
      t.Literal("company"),
      t.Literal("individual"),
      t.Literal("benefit"),
      t.Null(),
    ]),
    dailyLimit: t.Number(),
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
  cancelSubscription(id: string): Promise<void>;
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

        if (!row) {
          const today = saoPauloDate(new Date());
          const current = await repos.individual(me.id);
          const end = current?.status === "canceled" ? current.currentPeriodEnd : null;

          if (end !== null && today <= end) {
            return status(409, { error: `Carreira Pro canceled until ${end}` });
          }

          return status(409, { error: "Already subscribed" });
        }

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
          await repos.releaseCheckout(row.profileId);

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
    )
    .post(
      "/me/plan/cancel",
      async ({ me, status }) => {
        if (!gateway.configured) return status(503, { error: "Billing not configured" });

        const subscription = await repos.cancelable(me.id);

        if (!subscription) return status(409, { error: "No active Carreira Pro" });

        try {
          await gateway.cancelSubscription(subscription.providerSubscriptionId);
        } catch (cause) {
          logFailureCode("Carreira Pro cancellation failed")(cause);

          return status(502, { error: "Could not cancel Carreira Pro" });
        }

        await repos.markCanceled(me.id, subscription.providerSubscriptionId, new Date());

        return { currentPeriodEnd: subscription.currentPeriodEnd };
      },
      {
        talent: "signed-in",
        response: {
          200: t.Object({ currentPeriodEnd: nullableDate }),
          409: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    );
}
