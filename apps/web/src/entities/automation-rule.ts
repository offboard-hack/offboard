import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type AutomationRuleRow = Treaty.Data<ApiClient["api"]["automation-rules"]["get"]>[number];

export type AutomationRuleInput = Treaty.Data<ApiClient["api"]["automation-rules"]["post"]>;

export type AutomationRuleDraft = {
  name: string;
  trigger: AutomationRuleRow["trigger"];
  conditions: AutomationRuleRow["conditions"];
  actions: AutomationRuleRow["actions"];
  enabled: boolean;
  cronSchedule: string | null;
};

async function listAutomationRules({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["automation-rules"].get({
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch automation rules");

  return data;
}

export const automationRulesQuery = queryOptions({
  queryKey: ["automation-rules"],
  queryFn: listAutomationRules,
  staleTime: 30_000,
});

function useRuleMutation<Variables, Result>(mutationFn: (variables: Variables) => Promise<Result>) {
  const client = useQueryClient();

  return useMutation({
    mutationFn,
    onSettled: () => client.invalidateQueries(automationRulesQuery),
  });
}

export function useCreateAutomationRule() {
  return useRuleMutation(async (draft: AutomationRuleDraft) => {
    const { data, error } = await getApiClient().api["automation-rules"].post(draft);

    if (error) throw new Error("Failed to create automation rule");

    return data;
  });
}

export function useUpdateAutomationRule() {
  return useRuleMutation(
    async ({ id, ...draft }: Partial<AutomationRuleDraft> & { id: string }) => {
      const { data, error } = await getApiClient().api["automation-rules"]({ id }).put(draft);

      if (error) throw new Error("Failed to update automation rule");

      return data;
    },
  );
}

export function useDeleteAutomationRule() {
  return useRuleMutation(async (id: string) => {
    const { error } = await getApiClient().api["automation-rules"]({ id }).delete();

    if (error) throw new Error("Failed to delete automation rule");
  });
}
