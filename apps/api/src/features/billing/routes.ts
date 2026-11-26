import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import type { AbacatePayGateway } from "./abacatepay.js";
import type { BillingRepository } from "./repository.js";
import { applyWebhookEvent, isAuthorizedWebhook, parseWebhookEvent } from "./webhook.js";

const planRow = t.Object({
  id: t.String(),
  name: t.String(),
  slug: t.String(),
  monthlyPriceCents: t.Number(),
  maxEmployees: t.Number(),
  features: t.Array(t.String()),
});

const subscriptionRow = t.Object({
  id: t.String(),
  status: t.Union([
    t.Literal("active"),
    t.Literal("past_due"),
    t.Literal("canceled"),
    t.Literal("trialing"),
  ]),
  currentPeriodStart: t.String(),
  currentPeriodEnd: t.String(),
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

export function billingRoutes(
  repos: BillingRepository,
  access: PortalAccessPlugin,
  gateway: AbacatePayGateway,
  webOrigin: string,
  webhookSecret: string | undefined,
) {
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
    .post(
      "/billing/checkout",
      async ({ principal, status }) => {
        if (!gateway.configured) return status(503, { error: "Payments are not configured" });

        const subscription = await repos.getSubscription(principal.orgId);

        if (!subscription) return status(404, { error: "No subscription" });

        const checkout = await gateway.createSubscriptionCheckout({
          externalId: subscription.id,
          planSlug: subscription.plan.slug,
          returnUrl: `${webOrigin}/planos-e-gastos`,
          completionUrl: `${webOrigin}/planos-e-gastos`,
        });

        return { checkoutId: checkout.id, url: checkout.url };
      },
      {
        permit: ["manage", "Billing"],
        response: { 200: checkoutResponse, 404: errorResponse, 503: errorResponse },
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

        await applyWebhookEvent(repos, event, request.headers.get("webhook-id"));

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
