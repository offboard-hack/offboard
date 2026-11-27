import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type PlanRow = Treaty.Data<ApiClient["api"]["billing"]["plans"]["get"]>[number];

export type SubscriptionRow = NonNullable<
  Treaty.Data<ApiClient["api"]["billing"]["subscription"]["get"]>
>;

export type InvoiceRow = Treaty.Data<ApiClient["api"]["billing"]["invoices"]["get"]>[number];

async function listPlans({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.billing.plans.get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch plans");

  return data;
}

async function getSubscription({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.billing.subscription.get({
    fetch: { signal },
  });

  if (error?.status === 404) return null;

  if (error) throw new Error("Failed to fetch subscription");

  return data;
}

async function listInvoices({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.billing.invoices.get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch invoices");

  return data;
}

export const plansQuery = queryOptions({
  queryKey: ["billing", "plans"],
  queryFn: listPlans,
  staleTime: 60_000,
});

export const subscriptionQuery = queryOptions({
  queryKey: ["billing", "subscription"],
  queryFn: getSubscription,
  staleTime: 30_000,
});

export const invoicesQuery = queryOptions({
  queryKey: ["billing", "invoices"],
  queryFn: listInvoices,
  staleTime: 30_000,
});

async function postCheckout() {
  const { data, error } = await getApiClient().api.billing.checkout.post();

  if (error) throw new Error("Failed to start checkout");

  return data;
}

export function useCheckout() {
  return useMutation({
    mutationFn: postCheckout,
    onSuccess: (checkout) => window.location.assign(checkout.url),
  });
}

async function postSubscribe(planSlug: string) {
  const { data, error } = await getApiClient().api.billing.subscription.post({ planSlug });

  if (error) throw new Error("Failed to start subscription");

  return data;
}

export function useSubscribe() {
  return useMutation({
    mutationFn: postSubscribe,
    onSuccess: (checkout) => window.location.assign(checkout.url),
  });
}
