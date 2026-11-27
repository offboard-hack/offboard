import { createHmac } from "node:crypto";
import { z } from "zod";
import { logFailureCode } from "../../shared/error-summary.js";
import { matchesSecret } from "../../shared/machine-auth.js";
import { addMonths, saoPauloDate } from "../../shared/sao-paulo-date.js";
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

const attemptToken = /^[a-z0-9]{1,32}$/i;

export function checkoutReferenceId(externalId: string, prefix = "") {
  const [id, attempt, ...extra] = externalId.slice(prefix.length).split(":");
  const parsed = talentProfileId.safeParse(id);

  if (!parsed.success || extra.length > 0) return null;

  return attempt === undefined || attemptToken.test(attempt) ? parsed.data : null;
}

async function cancelSuperseded(
  gateway: SubscriptionCanceler,
  superseded: string,
  kept: string | null,
) {
  if (superseded === kept) return;

  if (!gateway.configured) {
    console.error("superseded subscription could not be canceled", { superseded, kept });

    return;
  }

  try {
    await gateway.cancelSubscription(superseded);
    console.error("superseded subscription canceled", { superseded, kept });
  } catch (cause) {
    logFailureCode("superseded subscription cancellation failed")(cause);
    console.error("superseded subscription left active", { superseded, kept });
  }
}

type TalentTarget = {
  profileId: string;
  status: "pending" | "active" | "past_due" | "canceled";
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

    if (talent.status === "canceled") return { currentPeriodEnd: addOneMonth(from) } as const;

    return {
      status: "active",
      providerSubscriptionId,
      currentPeriodEnd: addOneMonth(from),
    } as const;
  }

  if (name === "subscription.payment_failed") {
    return talent.status === "canceled" ? null : ({ status: "past_due" } as const);
  }

  if (name === "subscription.cancelled") return { status: "canceled" } as const;

  return null;
}

export type SubscriptionCanceler = {
  configured: boolean;
  cancelSubscription(id: string): Promise<void>;
};

const chargingEvents = new Set(["subscription.completed", "subscription.renewed"]);

async function cancelOrphan(
  kind: "talent" | "copay",
  gateway: SubscriptionCanceler,
  name: string | undefined,
  event: SubscriptionEvent,
) {
  if (name === undefined || !chargingEvents.has(name)) {
    console.error(`${kind} webhook ignored`, { event: name });

    return;
  }

  if (!gateway.configured) {
    console.error(`${kind} webhook for a deleted account could not be canceled`, { event: name });

    return;
  }

  await gateway.cancelSubscription(event.data.subscription.id);
  console.error(`${kind} subscription of a deleted account canceled`, { event: name });
}

async function applyTalentEvent(
  repos: BillingRepository,
  gateway: SubscriptionCanceler,
  name: string | undefined,
  event: SubscriptionEvent,
  deliveryId: string | null,
  talent: TalentTarget | null,
) {
  if (!talent) return cancelOrphan("talent", gateway, name, event);

  if (isStale(name, event, talent)) {
    console.error("talent webhook ignored", { event: name });

    return;
  }

  const patch = talentPatch(name, event, talent);

  if (!patch) return;

  const applied = await repos.updateTalentSubscription(
    talent.profileId,
    patch,
    event.id ?? deliveryId,
    new Date(),
  );

  if (applied && name === "subscription.completed" && talent.providerSubscriptionId !== null) {
    await cancelSuperseded(gateway, talent.providerSubscriptionId, event.data.subscription.id);
  }
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

type CopayAssignment = {
  assignedPlanId: string;
  effectivePlanId: string;
  copaySubscriptionId: string | null;
  copayCheckoutId: string | null;
  copayCheckoutAt: Date | null;
  copayPeriodEnd: string | null;
  validUntil: string;
};

export type CopayBenefits = {
  findAssignmentByProfile(profileId: string): Promise<CopayAssignment | null>;
  findAssignmentBySubscription(
    subscriptionId: string,
  ): Promise<(Omit<CopayAssignment, "copaySubscriptionId"> & { profileId: string }) | null>;
  planPriceMap(): Promise<Map<string, number>>;
  activateCopay(
    profileId: string,
    checkoutId: string,
    patch: { effectivePlanId: string; copaySubscriptionId: string; copayPeriodEnd: string },
  ): Promise<boolean>;
  renewCopay(profileId: string, subscriptionId: string, periodEnd: string): Promise<void>;
  windDownCopay(profileId: string, subscriptionId: string, now: Date): Promise<string | null>;
  revertCopay(profileId: string, subscriptionId: string): Promise<void>;
};

function copayReference(externalId: string) {
  const [profileId, planId, attempt, ...extra] = externalId.slice(copayPrefix.length).split(":");
  const profile = talentProfileId.safeParse(profileId);
  const plan = talentProfileId.safeParse(planId);

  if (!profile.success || !plan.success || extra.length > 0) return null;

  if (attempt !== undefined && !attemptToken.test(attempt)) return null;

  return { profileId: profile.data, targetPlanId: plan.data };
}

type CopayTarget = {
  profileId: string;
  targetPlanId: string | undefined;
  assignment: CopayAssignment;
};

async function copayTargetOf(benefits: CopayBenefits, providerSubscriptionId: string) {
  const found = await benefits.findAssignmentBySubscription(providerSubscriptionId);

  if (!found) return null;

  const { profileId, ...assignment } = found;

  return {
    profileId,
    targetPlanId: undefined,
    assignment: { ...assignment, copaySubscriptionId: providerSubscriptionId },
  };
}

async function rejectUnowned(
  gateway: SubscriptionCanceler,
  name: string | undefined,
  event: SubscriptionEvent,
  profileId: string,
  reason: string,
) {
  const detail = {
    event: name,
    reason,
    profileId,
    subscriptionId: event.data.subscription.id,
    checkoutId: event.data.checkout?.id,
  };

  console.error("copay payment needs refund", detail);

  if (!gateway.configured) {
    console.error("copay subscription could not be canceled", detail);

    return;
  }

  await gateway.cancelSubscription(event.data.subscription.id);
}

async function activateCopay(
  benefits: CopayBenefits,
  gateway: SubscriptionCanceler,
  name: string | undefined,
  event: SubscriptionEvent,
  profileId: string,
  targetPlanId: string,
  assignment: CopayAssignment,
) {
  const subscriptionId = event.data.subscription.id;
  const checkoutId = event.data.checkout?.id;

  if (checkoutId === undefined || assignment.copayCheckoutId !== checkoutId) {
    return rejectUnowned(gateway, name, event, profileId, "checkout does not match the issued one");
  }

  if (assignment.copaySubscriptionId !== null) {
    return rejectUnowned(gateway, name, event, profileId, "co-pay already owned");
  }

  const prices = await benefits.planPriceMap();

  if (!(prices.get(targetPlanId)! > prices.get(assignment.effectivePlanId)!)) {
    return rejectUnowned(gateway, name, event, profileId, "target is not an upgrade");
  }

  const activated = await benefits.activateCopay(profileId, checkoutId, {
    effectivePlanId: targetPlanId,
    copaySubscriptionId: subscriptionId,
    copayPeriodEnd: addMonths(saoPauloDate(new Date()), 1),
  });

  if (activated) return;

  const current = await benefits.findAssignmentByProfile(profileId);

  if (current?.copaySubscriptionId !== subscriptionId) {
    await rejectUnowned(gateway, name, event, profileId, "lost the activation race");
  }
}

async function applyCopayEvent(
  benefits: CopayBenefits,
  gateway: SubscriptionCanceler,
  name: string | undefined,
  event: SubscriptionEvent,
  target: CopayTarget,
) {
  const { profileId, targetPlanId, assignment } = target;
  const providerSubscriptionId = event.data.subscription.id;
  const today = saoPauloDate(new Date());

  if (assignment.copaySubscriptionId !== providerSubscriptionId) {
    if (name === "subscription.completed" && targetPlanId) {
      return activateCopay(benefits, gateway, name, event, profileId, targetPlanId, assignment);
    }

    if (name === "subscription.renewed" || name === "subscription.trial_started") {
      return rejectUnowned(gateway, name, event, profileId, "subscription is not the owned one");
    }

    return;
  }

  if (name === "subscription.cancelled") {
    const { copayCheckoutAt, copayPeriodEnd } = assignment;

    if (copayCheckoutAt !== null && copayPeriodEnd !== null && copayPeriodEnd >= today) return;

    await benefits.revertCopay(profileId, providerSubscriptionId);

    return;
  }

  if (name === "subscription.renewed") {
    if (assignment.validUntil < today) {
      await gateway.cancelSubscription(providerSubscriptionId);
      await benefits.revertCopay(profileId, providerSubscriptionId);

      return;
    }

    await benefits.renewCopay(profileId, providerSubscriptionId, addMonths(today, 1));

    return;
  }

  if (name === "subscription.payment_failed") {
    console.error("copay payment failed", { profileId });
    await benefits.windDownCopay(profileId, providerSubscriptionId, new Date());
  }
}

export async function applyWebhookEvent(
  repos: BillingRepository,
  benefits: CopayBenefits,
  gateway: SubscriptionCanceler,
  event: SubscriptionEvent,
  deliveryId: string | null,
) {
  const name = event.event ?? event.type;
  const externalId = event.data.checkout?.externalId;

  if (externalId?.startsWith(copayPrefix)) {
    const reference = copayReference(externalId);

    if (!reference) {
      console.error("copay webhook ignored", { event: name });

      return;
    }

    const assignment = await benefits.findAssignmentByProfile(reference.profileId);

    if (!assignment) return cancelOrphan("copay", gateway, name, event);

    return applyCopayEvent(benefits, gateway, name, event, { ...reference, assignment });
  }

  if (externalId?.startsWith(talentPrefix)) {
    const profileId = checkoutReferenceId(externalId, talentPrefix);

    if (!profileId) {
      console.error("talent webhook ignored", {
        event: name,
        subscriptionId: event.data.subscription.id,
      });

      return;
    }

    const talent = await repos.findTalentSubscription(profileId);

    return applyTalentEvent(repos, gateway, name, event, deliveryId, talent);
  }

  if (!externalId) {
    const talent = await repos.findTalentSubscriptionByProvider(event.data.subscription.id);

    if (talent) return applyTalentEvent(repos, gateway, name, event, deliveryId, talent);

    const copay = await copayTargetOf(benefits, event.data.subscription.id);

    if (copay) return applyCopayEvent(benefits, gateway, name, event, copay);
  }

  const subscriptionId = externalId ? checkoutReferenceId(externalId) : null;

  if (!name || !subscriptionId) return;

  const subscription = await repos.getSubscriptionById(subscriptionId);

  if (!subscription) return;

  const { orgId } = subscription;

  if (isStaleCompanyEvent(name, event, subscription)) {
    console.error("company webhook ignored", { event: name });

    if (name === "subscription.completed") {
      await cancelSuperseded(
        gateway,
        event.data.subscription.id,
        subscription.providerSubscriptionId,
      );
    }

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

    if (name === "subscription.completed" && subscription.providerSubscriptionId !== null) {
      await cancelSuperseded(
        gateway,
        subscription.providerSubscriptionId,
        event.data.subscription.id,
      );
    }
  }

  if (name === "subscription.payment_failed") {
    const invoice = await openInvoice(repos, orgId, subscription.id, amount);

    await repos.updateInvoiceStatus(orgId, invoice.id, "failed");
    await repos.updateSubscription(orgId, subscription.id, { status: "past_due" });
  }
}
