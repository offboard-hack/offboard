import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type AutomationRule = Treaty.Data<ApiClient["api"]["automation-rules"]["get"]>[number];

export type RuleTrigger = AutomationRule["trigger"];

export type RuleAction = AutomationRule["actions"][number];

export type NewAutomationRule = Parameters<ApiClient["api"]["automation-rules"]["post"]>[0];

async function listRules({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["automation-rules"].get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch automation rules");

  return data;
}

export const automationRulesQuery = queryOptions({
  queryKey: ["automation-rules"],
  queryFn: listRules,
  staleTime: 30_000,
});

async function createRule(rule: NewAutomationRule) {
  const { error } = await getApiClient().api["automation-rules"].post(rule);

  if (error) throw new Error("Failed to create automation rule");
}

async function updateRule({ id, ...patch }: { id: string } & Partial<NewAutomationRule>) {
  const { error } = await getApiClient()
    .api["automation-rules"]({ id: encodeURIComponent(id) })
    .put(patch);

  if (error) throw new Error("Failed to update automation rule");
}

async function deleteRule(id: string) {
  const { error } = await getApiClient()
    .api["automation-rules"]({ id: encodeURIComponent(id) })
    .delete();

  if (error) throw new Error("Failed to delete automation rule");
}

export function useAutomationRuleMutations() {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries(automationRulesQuery);

  return {
    create: useMutation({ mutationFn: createRule, onSettled }),
    update: useMutation({ mutationFn: updateRule, onSettled }),
    remove: useMutation({ mutationFn: deleteRule, onSettled }),
  };
}
