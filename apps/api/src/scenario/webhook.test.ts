import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { completedEvent, signWebhook } from "./webhook.js";

it("builds a completed subscription event the webhook parser understands", () => {
  expect(completedEvent({ eventId: "abc", externalId: "talent:1", amountCents: 7900 })).toEqual({
    id: "evt_dev_abc",
    event: "subscription.completed",
    data: {
      subscription: { id: "subs_dev_abc", amount: 7900 },
      checkout: { id: "bill_dev_abc", externalId: "talent:1" },
      payment: { id: "pay_dev_abc" },
    },
  });
});

it("carries the issued checkout id when given", () => {
  const event = completedEvent({
    eventId: "abc",
    externalId: "sub-1",
    amountCents: 100,
    checkoutId: "bill_real",
  });

  expect(event.data.checkout).toEqual({ id: "bill_real", externalId: "sub-1" });
});

it("signs the id, timestamp and body with the Standard Webhooks scheme", () => {
  const headers = signWebhook("secret", "evt_1", 1_700_000_000, '{"a":1}');
  const digest = createHmac("sha256", "secret").update('evt_1.1700000000.{"a":1}').digest("base64");

  expect(headers).toEqual({
    "webhook-id": "evt_1",
    "webhook-timestamp": "1700000000",
    "webhook-signature": `v1,${digest}`,
  });
});
