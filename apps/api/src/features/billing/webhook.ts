import { createHmac } from "node:crypto";
import { z } from "zod";
import { matchesSecret } from "../../shared/machine-auth.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import type { AbacatePayGateway } from "./abacatepay.js";
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

const talentPrefix = "talent:";

const talentProfileId = z.uuid();

async function talentSubscriptionOf(repos: BillingRepository, externalId: string) {
  const parsed = talentProfileId.safeParse(externalId.slice(talentPrefix.length));

  return parsed.success ? repos.findTalentSubscription(parsed.data) : null;
}

type TalentTarget = {
  profileId: string;
  providerSubscriptionId: string | null;
  currentPeriodEnd: string | null;
};

const replaceableEvents = new Set([
  "subscription.renewed",
  "subscription.payment_failed",
  "subscription.cancelled",
]);

function isStale(name: string | undefined, event: SubscriptionEvent, talent: TalentTarget) {
  return (
    name !== undefined &&
    replaceableEvents.has(name) &&
    talent.providerSubscriptionId !== null &&
    talent.providerSubscriptionId !== event.data.subscription.id
  );
}

function talentPatch(name: string | undefined, event: SubscriptionEvent, talent: TalentTarget) {
  const today = saoPauloDate(new Date());
  const providerSubscriptionId = event.data.subscription.id;

  if (name === "subscription.completed") {
    return {
      status: "active",
      providerSubscriptionId,
      currentPeriodEnd: addOneMonth(today),
    } as const;
  }

  if (name === "subscription.renewed") {
    const from =
      talent.currentPeriodEnd !== null && talent.currentPeriodEnd > today
        ? talent.currentPeriodEnd
        : today;

    return {
      status: "active",
      providerSubscriptionId,
      currentPeriodEnd: addOneMonth(from),
    } as const;
  }

  if (name === "subscription.payment_failed") return { status: "past_due" } as const;

  if (name === "subscription.cancelled") return { status: "canceled" } as const;

  return null;
}

async function applyTalentEvent(
  repos: BillingRepository,
  name: string | undefined,
  event: SubscriptionEvent,
  deliveryId: string | null,
  talent: TalentTarget | null,
) {
  if (!talent) {
    console.error("talent webhook ignored", { event: name });

    return;
  }

  if (isStale(name, event, talent)) {
    console.error("talent webhook ignored", { event: name });

    return;
  }

  const patch = talentPatch(name, event, talent);

  if (!patch) return;

  await repos.updateTalentSubscription(talent.profileId, patch, event.id ?? deliveryId, new Date());
}

type CompanyTarget = {
  status: string;
  checkoutId: string | null;
  providerSubscriptionId: string | null;
};

function issuedCheckout(event: SubscriptionEvent) {
  return { providerSubscriptionId: event.data.subscription.id, checkoutUrl: null };
}

function bindsCheckout(name: string, subscription: CompanyTarget) {
  return (
    name === "subscription.completed" ||
    name === "subscription.trial_started" ||
    (name === "subscription.renewed" && subscription.providerSubscriptionId === null)
  );
}

function isStaleCompanyEvent(name: string, event: SubscriptionEvent, subscription: CompanyTarget) {
  if (bindsCheckout(name, subscription)) {
    const paid = event.data.checkout?.id;

    return subscription.status === "pending"
      ? subscription.checkoutId === null || subscription.checkoutId !== paid
      : subscription.checkoutId !== null && subscription.checkoutId !== paid;
  }

  return (
    replaceableEvents.has(name) &&
    subscription.providerSubscriptionId !== null &&
    subscription.providerSubscriptionId !== event.data.subscription.id
  );
}

async function openInvoice(
  repos: BillingRepository,
  orgId: string,
  subscriptionId: string,
  amount: number,
) {
  const open = await repos.findOpenInvoice(orgId, subscriptionId);

  if (open) return open;

  return repos.createInvoice(orgId, subscriptionId, amount, new Date().toISOString().slice(0, 10));
}

const copayPrefix = "copay:";

export type CopayBenefits = {
  findAssignmentByProfile(profileId: string): Promise<{
    assignedPlanId: string;
    effectivePlanId: string;
    copaySubscriptionId: string | null;
    validUntil: string;
  } | null>;
  findAssignmentBySubscription(subscriptionId: string): Promise<{ profileId: string } | null>;
  planPriceMap(): Promise<Map<string, number>>;
  updateCopayState(
    profileId: string,
    patch: { effectivePlanId?: string; copaySubscriptionId?: string | null },
  ): Promise<void>;
};

async function copayTargetOf(
  benefits: CopayBenefits,
  externalId: string | null | undefined,
  providerSubscriptionId: string,
) {
  const [profileId, targetPlanId] = externalId?.startsWith(copayPrefix)
    ? externalId.slice(copayPrefix.length).split(":")
    : [(await benefits.findAssignmentBySubscription(providerSubscriptionId))?.profileId];

  const parsed = talentProfileId.safeParse(profileId);
  const assignment = parsed.success ? await benefits.findAssignmentByProfile(parsed.data) : null;

  return assignment && parsed.success ? { profileId: parsed.data, targetPlanId, assignment } : null;
}

async function applyCopayEvent(
  benefits: CopayBenefits,
  gateway: AbacatePayGateway,
  name: string | undefined,
  event: SubscriptionEvent,
  target: NonNullable<Awaited<ReturnType<typeof copayTargetOf>>>,
) {
  const { profileId, targetPlanId, assignment } = target;
  const providerSubscriptionId = event.data.subscription.id;
  const owned = assignment.copaySubscriptionId === providerSubscriptionId;

  if (name === "subscription.completed" && targetPlanId) {
    const prices = await benefits.planPriceMap();

    if (prices.get(targetPlanId)! > prices.get(assignment.effectivePlanId)!) {
      await benefits.updateCopayState(profileId, {
        effectivePlanId: targetPlanId,
        copaySubscriptionId: providerSubscriptionId,
      });
    }

    return;
  }

  if (name === "subscription.cancelled" && owned) {
    await benefits.updateCopayState(profileId, {
      effectivePlanId: assignment.assignedPlanId,
      copaySubscriptionId: null,
    });

    return;
  }

  if (
    name === "subscription.renewed" &&
    owned &&
    assignment.validUntil < saoPauloDate(new Date())
  ) {
    await gateway.cancelSubscription(providerSubscriptionId);
    await benefits.updateCopayState(profileId, { copaySubscriptionId: null });

    return;
  }

  if (name === "subscription.payment_failed") {
    console.error("copay payment failed", { profileId });
  }
}

export async function applyWebhookEvent(
  repos: BillingRepository,
  benefits: CopayBenefits,
  gateway: AbacatePayGateway,
  event: SubscriptionEvent,
  deliveryId: string | null,
) {
  const name = event.event ?? event.type;
  const subscriptionId = event.data.checkout?.externalId;

  if (subscriptionId?.startsWith(copayPrefix)) {
    const copay = await copayTargetOf(benefits, subscriptionId, event.data.subscription.id);

    if (!copay) {
      console.error("copay webhook ignored", { event: name });

      return;
    }

    return applyCopayEvent(benefits, gateway, name, event, copay);
  }

  if (subscriptionId?.startsWith(talentPrefix)) {
    const talent = await talentSubscriptionOf(repos, subscriptionId);

    return applyTalentEvent(repos, name, event, deliveryId, talent);
  }

  if (!subscriptionId) {
    const talent = await repos.findTalentSubscriptionByProvider(event.data.subscription.id);

    if (talent) return applyTalentEvent(repos, name, event, deliveryId, talent);

    const copay = await copayTargetOf(benefits, null, event.data.subscription.id);

    if (copay) return applyCopayEvent(benefits, gateway, name, event, copay);
  }

  if (!name || !subscriptionId) return;

  const subscription = await repos.getSubscriptionById(subscriptionId);

  if (!subscription) return;

  const { orgId } = subscription;

  if (isStaleCompanyEvent(name, event, subscription)) {
    console.error("company webhook ignored", { event: name });

    return;
  }

  const amount = event.data.subscription.amount;

  if (name === "subscription.trial_started") {
    await repos.updateSubscription(orgId, subscription.id, {
      status: "trialing",
      ...issuedCheckout(event),
    });
  }

  if (name === "subscription.cancelled") {
    await repos.updateSubscription(orgId, subscription.id, { status: "canceled" });
  }

  if (name === "subscription.completed" || name === "subscription.renewed") {
    const billingId = event.data.payment?.id ?? event.id ?? event.data.subscription.id;

    if (await repos.getInvoiceByBillingId(orgId, billingId)) return;

    const invoice = await openInvoice(repos, orgId, subscription.id, amount);
    const today = new Date().toISOString().slice(0, 10);

    await repos.updateInvoiceStatus(orgId, invoice.id, "paid", billingId, new Date());
    await repos.updateSubscription(orgId, subscription.id, {
      status: "active",
      currentPeriodStart: today,
      currentPeriodEnd: addOneMonth(today),
      ...(bindsCheckout(name, subscription) && issuedCheckout(event)),
    });
  }

  if (name === "subscription.payment_failed") {
    const invoice = await openInvoice(repos, orgId, subscription.id, amount);

    await repos.updateInvoiceStatus(orgId, invoice.id, "failed");
    await repos.updateSubscription(orgId, subscription.id, { status: "past_due" });
  }
}
