import { AbacatePay } from "@abacatepay/sdk";
import { PaymentMethod, SubscriptionStatus } from "@abacatepay/types/v2";

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
  function client() {
    if (!apiKey) throw new Error("ABACATEPAY_API_KEY is not configured");

    return AbacatePay({ secret: apiKey, rest: { base } });
  }

  async function cancelSubscription(id: string) {
    const api = client();
    const result = await api.subscriptions.cancel(id);

    if (result.success) return;

    const current = await api.subscriptions.get({ id });

    const settled = current.success
      ? current.data.status === SubscriptionStatus.Cancelled
      : current.error === "Subscription not found";

    if (!settled) throw new Error(`AbacatePay subscription cancel failed: ${result.error}`);
  }

  async function createSubscriptionCheckout(params: CreateSubscriptionCheckoutParams) {
    const result = await client().subscriptions.create({
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

  return { configured: Boolean(apiKey), createSubscriptionCheckout, cancelSubscription };
}

export type AbacatePayGateway = ReturnType<typeof createAbacatePayGateway>;
