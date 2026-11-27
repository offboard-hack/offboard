import { Elysia, t } from "elysia";
import { checkoutAttempt } from "../../shared/checkout-attempt.js";
import { careerPro, checkoutInFlight, checkoutRetryMs } from "../../shared/career-pro.js";
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
  copay: t.Union([
    t.Object({
      offered: t.Boolean(),
      targetPlanId: t.String(),
      targetPlanName: t.String(),
      priceCents: t.Number(),
      active: t.Boolean(),
      checkoutOpen: t.Boolean(),
      endsAt: nullableDate,
      checkoutUrl: nullableDate,
      paymentFailed: t.Boolean(),
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
  }): Promise<{ id: string; url: string }>;
  cancelSubscription(id: string): Promise<void>;
};

type CopayAssignment = {
  assignedPlanId: string;
  effectivePlanId: string;
  copaySubscriptionId: string | null;
  copayCheckoutUrl: string | null;
  copayTargetPlanId: string | null;
  copayPaymentFailedAt: Date | null;
  copayCheckoutAt: Date | null;
  copayPriceCents: number | null;
  copayPeriodEnd: string | null;
  validUntil: string;
};

type CopayBenefits = {
  findAssignmentByProfile(profileId: string): Promise<CopayAssignment | null>;
  getCopayProduct(
    fromPlanId: string,
    toPlanId: string,
  ): Promise<{ abacatePayProductId: string } | null>;
  planPriceMap(): Promise<Map<string, number>>;
  planNameMap(): Promise<Map<string, string>>;
  listCopayTargets(
    fromPlanId: string,
  ): Promise<{ planId: string; name: string; upgradeCents: number }[]>;
  windDownCopay(profileId: string, subscriptionId: string, now: Date): Promise<string | null>;
  restoreCopay(
    profileId: string,
    subscriptionId: string,
    markedAt: Date,
    previous: {
      copayCheckoutAt: Date | null;
      copayPeriodEnd: string | null;
      copayPaymentFailedAt: Date | null;
    },
  ): Promise<void>;
};

function checkoutOpenOf(assignment: CopayAssignment, now: Date) {
  return (
    assignment.copaySubscriptionId === null &&
    assignment.copayCheckoutAt !== null &&
    assignment.copayCheckoutAt.getTime() > now.getTime() - checkoutRetryMs
  );
}

export function careerPlanRoutes(
  repos: CareerPlanRepository,
  talentAccess: TalentAccessPlugin,
  gateway: CareerCheckout,
  webOrigin: string,
  benefits: CopayBenefits,
) {
  const careerScreen = `${webOrigin}/colaborador?tela=carreira`;

  async function copayOf(profileId: string) {
    const now = new Date();
    const assignment = await benefits.findAssignmentByProfile(profileId);

    if (!assignment || assignment.validUntil < saoPauloDate(now)) return null;

    if (assignment.copaySubscriptionId !== null) {
      const prices = await benefits.planPriceMap();
      const names = await benefits.planNameMap();
      const effectivePrice = prices.get(assignment.effectivePlanId)!;
      const assignedPrice = prices.get(assignment.assignedPlanId)!;

      return {
        offered: false,
        targetPlanId: assignment.effectivePlanId,
        targetPlanName: names.get(assignment.effectivePlanId)!,
        priceCents: assignment.copayPriceCents ?? effectivePrice - assignedPrice,
        active: true,
        checkoutOpen: false,
        endsAt:
          assignment.copayCheckoutAt === null || assignment.copayPaymentFailedAt !== null
            ? null
            : assignment.copayPeriodEnd,
        checkoutUrl: null,
        paymentFailed: assignment.copayPaymentFailedAt !== null,
      };
    }

    const [target] = await benefits.listCopayTargets(assignment.assignedPlanId);

    if (!target) return null;

    const checkoutOpen = checkoutOpenOf(assignment, now);
    const issued = checkoutOpen && assignment.copayTargetPlanId === target.planId;

    return {
      offered: gateway.configured,
      targetPlanId: target.planId,
      targetPlanName: target.name,
      priceCents: issued
        ? (assignment.copayPriceCents ?? target.upgradeCents)
        : target.upgradeCents,
      active: false,
      checkoutOpen,
      endsAt: null,
      checkoutUrl: issued ? assignment.copayCheckoutUrl : null,
      paymentFailed: false,
    };
  }

  async function carreiraProBlock(profileId: string, now: Date) {
    const individual = await repos.individual(profileId);
    const end = individual?.currentPeriodEnd ?? null;

    if (
      individual?.status === "past_due" ||
      (individual?.status === "active" && (end === null || end >= saoPauloDate(now)))
    ) {
      return "Carreira Pro active";
    }

    return checkoutInFlight(individual, now) ? "Carreira Pro checkout open" : null;
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

        const now = new Date();
        const assignment = await benefits.findAssignmentByProfile(me.id);

        if (assignment) {
          if (assignment.copaySubscriptionId !== null) {
            return status(409, { error: "Co-pay active" });
          }

          if (checkoutOpenOf(assignment, now)) {
            return status(409, { error: "Co-pay checkout open" });
          }
        }

        const row = await repos.startCheckout(me.id, now);

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
            externalId: `talent:${row.profileId}:${checkoutAttempt()}`,
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

        if (assignment.copaySubscriptionId !== null) {
          return status(409, { error: "Co-pay already active" });
        }

        const now = new Date();
        const block = await carreiraProBlock(me.id, now);

        if (block) return status(409, { error: block });

        const prices = await benefits.planPriceMap();
        const assignedPrice = prices.get(assignment.assignedPlanId)!;
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

        const priceCents = targetPrice - assignedPrice;

        if (checkoutOpenOf(assignment, now)) {
          if (assignment.copayCheckoutUrl === null) {
            return status(409, { error: "Co-pay checkout open" });
          }

          if (
            assignment.copayTargetPlanId === body.targetPlanId &&
            assignment.copayPriceCents === priceCents
          ) {
            return { url: assignment.copayCheckoutUrl };
          }

          await repos.releaseCopayCheckout(me.id);
        }

        const row = await repos.startCopayCheckout(me.id, now);

        if (!row) return status(409, { error: "Co-pay checkout open" });

        try {
          const checkout = await gateway.createSubscriptionCheckout({
            externalId: `copay:${me.id}:${body.targetPlanId}:${checkoutAttempt()}`,
            planSlug: product.abacatePayProductId,
            returnUrl: careerScreen,
            completionUrl: `${careerScreen}&copay=ok`,
          });

          const stored = await repos.storeCopayCheckout(me.id, {
            id: checkout.id,
            url: checkout.url,
            priceCents,
            targetPlanId: body.targetPlanId,
          });

          if (!stored) return status(502, { error: "Could not start the checkout" });

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
    )
    .post(
      "/me/plan/copay-cancel",
      async ({ me, status }) => {
        if (!gateway.configured) return status(503, { error: "Billing not configured" });

        const assignment = await benefits.findAssignmentByProfile(me.id);

        if (!assignment || assignment.copaySubscriptionId === null) {
          return status(409, { error: "No active co-pay" });
        }

        const subscriptionId = assignment.copaySubscriptionId;
        const markedAt = new Date();
        const endsAt = await benefits.windDownCopay(me.id, subscriptionId, markedAt);

        if (endsAt === null) return status(409, { error: "No active co-pay" });

        try {
          await gateway.cancelSubscription(subscriptionId);
        } catch (cause) {
          logFailureCode("Co-pay cancellation failed")(cause);
          await benefits.restoreCopay(me.id, subscriptionId, markedAt, {
            copayCheckoutAt: assignment.copayCheckoutAt,
            copayPeriodEnd: assignment.copayPeriodEnd,
            copayPaymentFailedAt: assignment.copayPaymentFailedAt,
          });

          return status(502, { error: "Could not cancel the co-pay" });
        }

        return { endsAt };
      },
      {
        talent: "signed-in",
        response: {
          200: t.Object({ endsAt: t.String() }),
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
