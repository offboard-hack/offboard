import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type IntegrationRow = Treaty.Data<ApiClient["api"]["integrations"]["get"]>[number];

export type ConnectionStatus = IntegrationRow["status"];

async function listIntegrations({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.integrations.get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch integrations");

  return data;
}

export const integrationsQuery = queryOptions({
  queryKey: ["integrations"],
  queryFn: listIntegrations,
  staleTime: 30_000,
});

async function putIntegration(name: string, status: ConnectionStatus) {
  const { data, error } = await getApiClient()
    .api.integrations({ name: encodeURIComponent(name) })
    .put({ status });

  if (error) throw new Error("Failed to update integration");

  return data;
}

export function useToggleIntegration() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ name, status }: { name: string; status: ConnectionStatus }) =>
      putIntegration(name, status),
    onMutate: async ({ name, status }) => {
      await client.cancelQueries(integrationsQuery);
      const previous = client.getQueryData(integrationsQuery.queryKey);

      client.setQueryData(
        integrationsQuery.queryKey,
        (old) =>
          old?.map((row) => (row.name === name ? { ...row, status } : row)) ?? [{ name, status }],
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(integrationsQuery.queryKey, context.previous);
      }
    },
    onSettled: () => client.invalidateQueries(integrationsQuery),
  });
}
