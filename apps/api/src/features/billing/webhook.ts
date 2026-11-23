import { createHmac } from "node:crypto";
import { z } from "zod";
import { matchesSecret } from "../../shared/machine-auth.js";
import type { BillingRepository } from "./repository.js";

const subscriptionEvent = z.object({
  id: z.string().optional(),
  event: z.string().optional(),
  type: z.string().optional(),
  data: z.object({
    subscription: z.object({ id: z.string(), amount: z.number() }),
    checkout: z.object({ id: z.string(), externalId: z.string().nullable() }).optional(),
    payment: z.object({ id: z.string() }).optional(),
  }),
});

export function parseWebhookEvent(body: string) {
  let json: unknown;

  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }

  const parsed = subscriptionEvent.safeParse(json);

  return parsed.success ? parsed.data : null;
}

export function isAuthorizedWebhook(
  request: Request,
  body: string,
  querySecret: string | undefined,
  secret: string | undefined,
) {
  if (!secret) return false;

  if (matchesSecret(querySecret ?? null, secret)) return true;

  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signatures = request.headers.get("webhook-signature");

  if (!id || !signatures || !timestamp || !/^\d+$/.test(timestamp)) return false;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const digest = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");

  return signatures.split(" ").some((candidate) => matchesSecret(candidate, `v1,${digest}`));
}

function addOneMonth(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);

  return next.toISOString().slice(0, 10);
}

type SubscriptionEvent = NonNullable<ReturnType<typeof parseWebhookEvent>>;

async function openInvoice(repos: BillingRepository, subscriptionId: string, amount: number) {
  const open = await repos.findOpenInvoice(subscriptionId);

  if (open) return open;

  return repos.createInvoice(subscriptionId, amount, new Date().toISOString().slice(0, 10));
}

export async function applyWebhookEvent(repos: BillingRepository, event: SubscriptionEvent) {
  const name = event.event ?? event.type;
  const subscriptionId = event.data.checkout?.externalId;

  if (!name || !subscriptionId) return;

  const subscription = await repos.getSubscriptionById(subscriptionId);

  if (!subscription) return;

  const amount = event.data.subscription.amount;

  if (name === "subscription.trial_started") {
    await repos.updateSubscription(subscription.id, { status: "trialing" });
  }

  if (name === "subscription.cancelled") {
    await repos.updateSubscription(subscription.id, { status: "canceled" });
  }

  if (name === "subscription.completed" || name === "subscription.renewed") {
    const billingId = event.data.payment?.id ?? event.id ?? event.data.subscription.id;

    if (await repos.getInvoiceByBillingId(billingId)) return;

    const invoice = await openInvoice(repos, subscription.id, amount);
    const today = new Date().toISOString().slice(0, 10);

    await repos.updateInvoiceStatus(invoice.id, "paid", billingId, new Date());
    await repos.updateSubscription(subscription.id, {
      status: "active",
      currentPeriodStart: today,
      currentPeriodEnd: addOneMonth(today),
    });
  }

  if (name === "subscription.payment_failed") {
    const invoice = await openInvoice(repos, subscription.id, amount);

    await repos.updateInvoiceStatus(invoice.id, "failed");
    await repos.updateSubscription(subscription.id, { status: "past_due" });
  }
}
