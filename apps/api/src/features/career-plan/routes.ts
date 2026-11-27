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
  copay: t.Union([
    t.Object({
      offered: t.Boolean(),
      targetPlanId: t.String(),
      targetPlanName: t.String(),
      priceCents: t.Number(),
      active: t.Boolean(),
    }),
    t.Null(),
  ]),
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

type CopayBenefits = {
  findAssignmentByProfile(profileId: string): Promise<{
    assignedPlanId: string;
    copaySubscriptionId: string | null;
  } | null>;
  getCopayProduct(
    fromPlanId: string,
    toPlanId: string,
  ): Promise<{ abacatePayProductId: string } | null>;
  planPriceMap(): Promise<Map<string, number>>;
  listCopayTargets(
    fromPlanId: string,
  ): Promise<{ planId: string; name: string; upgradeCents: number }[]>;
};

export function careerPlanRoutes(
  repos: CareerPlanRepository,
  talentAccess: TalentAccessPlugin,
  gateway: CareerCheckout,
  webOrigin: string,
  benefits: CopayBenefits,
) {
  const careerScreen = `${webOrigin}/colaborador?tela=carreira`;

  async function copayOf(profileId: string) {
    const assignment = await benefits.findAssignmentByProfile(profileId);

    if (!assignment) return null;

    const [target] = await benefits.listCopayTargets(assignment.assignedPlanId);

    if (!target) return null;

    const active = assignment.copaySubscriptionId !== null;

    return {
      offered: gateway.configured && !active,
      targetPlanId: target.planId,
      targetPlanName: target.name,
      priceCents: target.upgradeCents,
      active,
    };
  }

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
          copay: await copayOf(me.id),
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
      "/me/plan/copay-checkout",
      async ({ me, body, status }) => {
        if (!gateway.configured) return status(503, { error: "Billing not configured" });

        const assignment = await benefits.findAssignmentByProfile(me.id);

        if (!assignment) return status(404, { error: "No benefit plan" });

        if (assignment.copaySubscriptionId) return status(409, { error: "Co-pay already active" });

        const prices = await benefits.planPriceMap();
        const assignedPrice = prices.get(assignment.assignedPlanId) ?? 0;
        const targetPrice = prices.get(body.targetPlanId);

        if (
          body.targetPlanId === assignment.assignedPlanId ||
          targetPrice === undefined ||
          targetPrice <= assignedPrice
        ) {
          return status(422, { error: "Target plan is not an upgrade" });
        }

        const product = await benefits.getCopayProduct(
          assignment.assignedPlanId,
          body.targetPlanId,
        );

        if (!product) return status(422, { error: "No co-pay available for this plan" });

        const row = await repos.startCopayCheckout(me.id, new Date());

        if (!row) return status(409, { error: "Co-pay already active" });

        try {
          const checkout = await gateway.createSubscriptionCheckout({
            externalId: `copay:${me.id}:${body.targetPlanId}`,
            planSlug: product.abacatePayProductId,
            returnUrl: careerScreen,
            completionUrl: `${careerScreen}&plano=ok`,
          });

          return { url: checkout.url };
        } catch (cause) {
          logFailureCode("Co-pay checkout failed")(cause);
          await repos.releaseCopayCheckout(me.id);

          return status(502, { error: "Could not start the checkout" });
        }
      },
      {
        talent: "signed-in",
        body: t.Object({ targetPlanId: t.String({ format: "uuid" }) }),
        response: {
          200: t.Object({ url: t.String() }),
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    );
}
