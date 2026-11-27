import { z } from "zod";
import { expectStatus, parseBody, type Context } from "./context.js";
import { paymentKeys, sendWebhook, type Collaborator } from "./steps.js";
import { completedEvent } from "./webhook.js";

const copayState = z.object({
  offered: z.boolean(),
  targetPlanId: z.string(),
  targetPlanName: z.string(),
  priceCents: z.number(),
  active: z.boolean(),
  endsAt: z.string().nullable(),
});

type CopayState = z.infer<typeof copayState>;

const planView = z.object({
  benefit: z.object({ planName: z.string() }).nullable(),
  copay: copayState.nullable(),
});

const checkoutReply = z.object({ url: z.string(), checkoutId: z.string().optional() });

const billPattern = /bill_[A-Za-z0-9]+/;

export function issuedCheckoutId(reply: { url: string; checkoutId?: string }) {
  const id = reply.checkoutId ?? reply.url.match(billPattern)?.[0];

  if (id === undefined) {
    throw new Error("The co-pay checkout does not expose its bill id in the response or the URL");
  }

  return id;
}

export function copayStanding(copay: CopayState | null) {
  if (copay === null) return "unavailable" as const;

  if (copay.active) return copay.endsAt === null ? ("active" as const) : ("canceled" as const);

  return copay.offered ? ("offered" as const) : ("closed" as const);
}

async function readPlan(ctx: Context, cookie: string) {
  return parseBody(
    expectStatus(await ctx.http("GET", "/me/plan", { cookie }), "Reading the plan", 200),
    "Plan",
    planView,
  );
}

async function startCheckout(ctx: Context, cookie: string, targetPlanId: string) {
  return parseBody(
    expectStatus(
      await ctx.http("POST", "/me/plan/copay-checkout", { cookie, body: { targetPlanId } }),
      "Starting the co-pay checkout",
      200,
    ),
    "Co-pay checkout",
    checkoutReply,
  );
}

export async function payBenefitCopay(ctx: Context, collaborator: Collaborator, profileId: string) {
  const keys = paymentKeys(ctx);

  if ("skipped" in keys) {
    ctx.log(`benefit co-pay ${keys.skipped}`);

    return "skipped" as const;
  }

  const { name } = collaborator.person;
  const { cookie } = collaborator.session;
  const before = await readPlan(ctx, cookie);

  const standing = copayStanding(before.copay);

  if (before.copay === null) {
    ctx.log(
      `${name} has no co-pay on offer (needs a benefit with a next tier and a copay_products row)`,
    );

    return standing;
  }

  if (standing === "closed") {
    ctx.log("skipped: the co-pay is not offered (is AbacatePay configured on the API?)");

    return standing;
  }

  if (standing === "active" || standing === "canceled") {
    ctx.log(
      `${name} co-pay already ${standing}${before.copay.endsAt === null ? "" : ` until ${before.copay.endsAt}`}`,
    );

    return standing;
  }

  const { targetPlanId, targetPlanName, priceCents } = before.copay;

  ctx.log(
    `${name} is offered ${targetPlanName} for ${priceCents} cents a month (now ${before.benefit?.planName ?? "no plan"})`,
  );

  const first = await startCheckout(ctx, cookie, targetPlanId);
  const again = await startCheckout(ctx, cookie, targetPlanId);

  if (again.url !== first.url) throw new Error("Repeating the co-pay checkout issued another URL");

  ctx.log(`AbacatePay sandbox checkout: ${first.url}`);

  await sendWebhook(
    ctx,
    keys.secret,
    completedEvent({
      eventId: ctx.newId(),
      externalId: `copay:${profileId}:${targetPlanId}`,
      checkoutId: issuedCheckoutId(first),
      amountCents: priceCents,
    }),
  );

  const paid = await readPlan(ctx, cookie);

  if (copayStanding(paid.copay) !== "active") {
    throw new Error("The co-pay did not become active after the payment");
  }

  if (paid.benefit?.planName !== targetPlanName) {
    throw new Error(`The effective plan is ${paid.benefit?.planName}, not ${targetPlanName}`);
  }

  ctx.log(`${name} co-pay is active and the benefit is now ${targetPlanName}`);

  const canceled = parseBody(
    expectStatus(
      await ctx.http("POST", "/me/plan/copay-cancel", { cookie }),
      "Canceling the co-pay",
      200,
    ),
    "Co-pay cancellation",
    z.object({ endsAt: z.string() }),
  );

  const after = await readPlan(ctx, cookie);

  if (
    copayStanding(after.copay) !== "canceled" ||
    after.copay?.endsAt !== canceled.endsAt ||
    after.benefit?.planName !== targetPlanName
  ) {
    throw new Error("The canceled co-pay does not keep access until the period end");
  }

  ctx.log(`${name} canceled the co-pay; ${targetPlanName} stays until ${canceled.endsAt}`);

  return "canceled" as const;
}
