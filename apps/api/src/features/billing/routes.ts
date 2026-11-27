import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { logFailureCode } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import type { AbacatePayGateway } from "./abacatepay.js";
import type { BillingRepository } from "./repository.js";
import {
  applyWebhookEvent,
  type CopayBenefits,
  isAuthorizedWebhook,
  parseWebhookEvent,
} from "./webhook.js";

const planRow = t.Object({
  id: t.String(),
  name: t.String(),
  slug: t.String(),
  monthlyPriceCents: t.Number(),
  maxEmployees: t.Number(),
  perPersonPriceCents: t.Number(),
  features: t.Array(t.String()),
});

const subscriptionRow = t.Object({
  id: t.String(),
  status: t.Union([
    t.Literal("active"),
    t.Literal("past_due"),
    t.Literal("canceled"),
    t.Literal("trialing"),
    t.Literal("pending"),
  ]),
  currentPeriodStart: t.String(),
  currentPeriodEnd: t.String(),
  canRestart: t.Boolean(),
  plan: planRow,
});

const invoiceRow = t.Object({
  id: t.String(),
  subscriptionId: t.String(),
  amountCents: t.Number(),
  status: t.Union([
    t.Literal("pending"),
    t.Literal("paid"),
    t.Literal("failed"),
    t.Literal("refunded"),
  ]),
  abacatepayBillingId: t.Nullable(t.String()),
  paidAt: t.Nullable(t.String()),
  dueDate: t.String(),
});

const checkoutResponse = t.Object({ checkoutId: t.String(), url: t.String() });

const benefitInvoiceRow = t.Object({
  id: t.String(),
  period: t.String(),
  totalCents: t.Number(),
  status: t.String(),
});

type BenefitInvoices = {
  tallyActiveAssignments(orgId: string): Promise<{ totalCents: number }>;
  createBenefitInvoice(
    orgId: string,
    period: string,
    totalCents: number,
  ): Promise<{ id: string; period: string; totalCents: number; status: string }>;
  listBenefitInvoices(orgId: string): Promise<
    {
      id: string;
      period: string;
      totalCents: number;
      status: string;
      createdAt: Date | null;
    }[]
  >;
};

export function billingRoutes(
  repos: BillingRepository,
  benefits: CopayBenefits & BenefitInvoices,
  access: PortalAccessPlugin,
  gateway: AbacatePayGateway,
  webOrigin: string,
  webhookSecret: string | undefined,
) {
  const planScreen = `${webOrigin}/planos-e-gastos?aba=plano`;

  const issueCheckout = (params: { externalId: string; planSlug: string }) =>
    gateway.createSubscriptionCheckout({
      ...params,
      returnUrl: planScreen,
      completionUrl: `${planScreen}&plano=ok`,
    });

  return new Elysia()
    .use(access)
    .get("/billing/plans", () => repos.listPlans(), {
      permit: ["read", "Billing"],
      response: t.Array(planRow),
    })
    .get(
      "/billing/subscription",
      async ({ principal, status }) => {
        const subscription = await repos.getSubscription(principal.orgId);

        return subscription ?? status(404, { error: "No subscription" });
      },
      {
        permit: ["read", "Billing"],
        response: { 200: subscriptionRow, 404: errorResponse },
      },
    )
    .get("/billing/invoices", ({ principal }) => repos.listInvoices(principal.orgId), {
      permit: ["manage", "Billing"],
      response: t.Array(invoiceRow),
    })
    .get(
      "/billing/benefit-invoices",
      ({ principal }) => benefits.listBenefitInvoices(principal.orgId),
      {
        permit: ["read", "Billing"],
        response: t.Array(
          t.Composite([benefitInvoiceRow, t.Object({ createdAt: t.Nullable(t.Date()) })]),
        ),
      },
    )
    .post(
      "/billing/benefit-invoices/generate",
      async ({ principal }) => {
        const { totalCents } = await benefits.tallyActiveAssignments(principal.orgId);

        return benefits.createBenefitInvoice(
          principal.orgId,
          saoPauloDate(new Date()).slice(0, 7),
          totalCents,
        );
      },
      { permit: ["manage", "Billing"], response: benefitInvoiceRow },
    )
    .post(
      "/billing/checkout",
      async ({ principal, status }) => {
        if (!gateway.configured) return status(503, { error: "Payments are not configured" });

        try {
          const paid = await repos.payExisting(principal.orgId, new Date(), issueCheckout);

          if (paid.outcome === "none") return status(404, { error: "No subscription" });

          if (paid.outcome === "not_payable") {
            return status(409, { error: "Nothing to pay on this subscription" });
          }

          return { checkoutId: paid.checkoutId, url: paid.url };
        } catch (cause) {
          logFailureCode("Company checkout failed")(cause);

          return status(502, { error: "Could not start the checkout" });
        }
      },
      {
        permit: ["manage", "Billing"],
        response: {
          200: checkoutResponse,
          404: errorResponse,
          409: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/billing/subscription",
      async ({ principal, body, status }) => {
        if (!gateway.configured) return status(503, { error: "Payments are not configured" });

        try {
          const started = await repos.startSubscription(
            principal.orgId,
            body.planSlug,
            new Date(),
            issueCheckout,
          );

          if (started.outcome === "unknown_plan") return status(422, { error: "Unknown plan" });

          if (started.outcome === "subscribed") {
            return status(409, { error: "Already subscribed" });
          }

          if (started.outcome === "in_progress") {
            return status(409, { error: "A checkout is already in progress" });
          }

          return { url: started.url };
        } catch (cause) {
          logFailureCode("Company plan checkout failed")(cause);

          return status(502, { error: "Could not start the checkout" });
        }
      },
      {
        permit: ["manage", "Billing"],
        body: t.Object({ planSlug: t.String() }),
        response: {
          200: t.Object({ url: t.String() }),
          409: errorResponse,
          422: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/billing/webhook",
      async ({ request, query, status }) => {
        const body = await request.text();

        if (!isAuthorizedWebhook(request, body, query.webhookSecret, webhookSecret)) {
          return status(401, { error: "Unauthorized" });
        }

        const event = parseWebhookEvent(body);

        if (!event) return status(422, { error: "Invalid webhook event" });

        await applyWebhookEvent(repos, benefits, gateway, event, request.headers.get("webhook-id"));

        return { ok: true } satisfies { ok: true };
      },
      {
        parse: "none",
        query: t.Object({ webhookSecret: t.Optional(t.String()) }),
        response: {
          200: t.Object({ ok: t.Literal(true) }),
          401: errorResponse,
          422: errorResponse,
        },
      },
    );
}
