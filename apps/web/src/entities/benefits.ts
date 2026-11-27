import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";
import { plansQuery } from "@/entities/billing";

export type BenefitPolicyData = NonNullable<Treaty.Data<ApiClient["api"]["benefit-policy"]["get"]>>;

export type BenefitAssignmentRow = Treaty.Data<
  ApiClient["api"]["benefit-assignments"]["get"]
>[number];

async function getPolicy({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["benefit-policy"].get({ fetch: { signal } });

  if (error?.status === 404) return null;

  if (error) throw new Error("Failed to fetch benefit policy");

  return data;
}

async function listAssignments({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["benefit-assignments"].get({
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch benefit assignments");

  return data;
}

export const benefitPolicyQuery = queryOptions({
  queryKey: ["benefits", "policy"],
  queryFn: getPolicy,
  staleTime: 30_000,
});

export const benefitAssignmentsQuery = queryOptions({
  queryKey: ["benefits", "assignments"],
  queryFn: listAssignments,
  staleTime: 30_000,
});

export const benefitPlansQuery = plansQuery;

async function putPolicy(policy: BenefitPolicyData) {
  const { error } = await getApiClient().api["benefit-policy"].put(policy);

  if (error) throw new Error("Failed to save benefit policy");
}

async function postAssignment(input: { profileId: string; planId: string }) {
  const { data, error } = await getApiClient().api["benefit-assignments"].post(input);

  if (error) throw new Error("Failed to assign benefit");

  return data;
}

async function putAssignment({ id, planId }: { id: string; planId: string }) {
  const { data, error } = await getApiClient().api["benefit-assignments"]({ id }).put({ planId });

  if (error) throw new Error("Failed to update benefit assignment");

  return data;
}

export function useSaveBenefitPolicy(onSuccess: () => void) {
  return useMutation({ mutationFn: putPolicy, onSuccess });
}

export function useAssignBenefit(onSuccess: () => void) {
  return useMutation({ mutationFn: postAssignment, onSuccess });
}

export function useUpdateAssignment(onSuccess: () => void) {
  return useMutation({ mutationFn: putAssignment, onSuccess });
}

export { costSummary, policyDefaults, type BenefitPlanOption } from "./benefits-summary";
