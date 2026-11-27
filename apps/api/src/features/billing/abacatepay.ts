import { AbacatePay } from "@abacatepay/sdk";
import {
  PaymentMethod,
  ProductCycle,
  ProductStatus,
  SubscriptionStatus,
} from "@abacatepay/types/v2";

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

  async function ensureCopayProduct(fromSlug: string, toSlug: string, priceCents: number) {
    const api = client();
    const externalId = `copay-${fromSlug}-${toSlug}`;
    const listed = await api.products.list({ externalId, status: ProductStatus.Active });

    if (!listed.success) throw new Error(`AbacatePay product lookup failed: ${listed.error}`);

    const [existing] = listed.data;

    if (existing) return { id: existing.id };

    const created = await api.products.create({
      externalId,
      name: `Upgrade de benefício ${fromSlug} para ${toSlug}`,
      price: priceCents,
      currency: "BRL",
      cycle: ProductCycle.Monthly,
    });

    if (!created.success) throw new Error(`AbacatePay product creation failed: ${created.error}`);

    return { id: created.data.id };
  }

  return {
    configured: Boolean(apiKey),
    createSubscriptionCheckout,
    cancelSubscription,
    ensureCopayProduct,
  };
}

export type AbacatePayGateway = ReturnType<typeof createAbacatePayGateway>;
