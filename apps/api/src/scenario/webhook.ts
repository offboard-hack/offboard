import { createHmac } from "node:crypto";

export type WebhookEvent = {
  id: string;
  event: string;
  data: {
    subscription: { id: string; amount: number };
    checkout: { id: string; externalId: string };
    payment: { id: string };
  };
};

export function completedEvent(input: {
  eventId: string;
  externalId: string;
  amountCents: number;
}) {
  return {
    id: `evt_dev_${input.eventId}`,
    event: "subscription.completed",
    data: {
      subscription: { id: `subs_dev_${input.eventId}`, amount: input.amountCents },
      checkout: { id: `bill_dev_${input.eventId}`, externalId: input.externalId },
      payment: { id: `pay_dev_${input.eventId}` },
    },
  } satisfies WebhookEvent;
}

export function signWebhook(secret: string, id: string, timestamp: number, body: string) {
  const digest = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");

  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${digest}`,
  };
}
