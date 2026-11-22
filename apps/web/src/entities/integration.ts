import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiBase } from "./offboarding";

export type ConnectionStatus = "connected" | "disconnected" | "reconnect";

export type IntegrationRow = { name: string; status: ConnectionStatus };

async function listIntegrations() {
  const base = apiBase();
  const response = await fetch(`${base}/api/integrations`);

  if (!response.ok) {
    throw new Error("Failed to fetch integrations");
  }

  const rows: IntegrationRow[] = await response.json();

  return rows;
}

export const integrationsQuery = queryOptions({
  queryKey: ["integrations"],
  queryFn: listIntegrations,
  staleTime: 30_000,
});

async function putIntegration(name: string, status: ConnectionStatus) {
  const base = apiBase();

  const response = await fetch(`${base}/api/integrations/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error("Failed to update integration");
  }

  const updated: IntegrationRow = await response.json();

  return updated;
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
