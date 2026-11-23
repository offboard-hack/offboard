import { AbacatePay } from "@abacatepay/sdk";
import { PaymentMethod } from "@abacatepay/types/v2";

export type CreateSubscriptionCheckoutParams = {
  externalId: string;
  planSlug: string;
  returnUrl: string;
  completionUrl: string;
};

export type SubscriptionCheckout = { id: string; url: string };

export function createAbacatePayGateway(
  apiKey: string | undefined,
  base = "https://api.abacatepay.com/v",
) {
  async function createSubscriptionCheckout(params: CreateSubscriptionCheckoutParams) {
    if (!apiKey) throw new Error("ABACATEPAY_API_KEY is not configured");

    const result = await AbacatePay({
      secret: apiKey,
      rest: { base },
    }).subscriptions.create({
      items: [{ id: params.planSlug, quantity: 1 }],
      methods: [PaymentMethod.Pix, PaymentMethod.Card],
      externalId: params.externalId,
      returnUrl: params.returnUrl,
      completionUrl: params.completionUrl,
      retryPolicy: { maxRetry: 3, retryEvery: 1 },
    });

    if (!result.success) {
      throw new Error(`AbacatePay subscription checkout failed: ${result.error}`);
    }

    return { id: result.data.id, url: result.data.url } satisfies SubscriptionCheckout;
  }

  return { configured: Boolean(apiKey), createSubscriptionCheckout };
}

export type AbacatePayGateway = ReturnType<typeof createAbacatePayGateway>;
