import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
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

export type SlackSettings = Treaty.Data<ApiClient["api"]["integrations"]["slack"]["get"]>;

async function readSlackSettings({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.integrations.slack.get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch Slack settings");

  return data;
}

export const slackSettingsQuery = queryOptions({
  queryKey: ["integrations", "slack"],
  queryFn: readSlackSettings,
});

const slackFailure = z.object({ error: z.string() });

export class SlackSettingsError extends Error {
  constructor(readonly code: string | undefined) {
    super("Failed to save Slack settings");
  }
}

function useSlackMutation<Variables>(mutationFn: (variables: Variables) => Promise<SlackSettings>) {
  const client = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (settings) => client.setQueryData(slackSettingsQuery.queryKey, settings),
    onSettled: () => client.invalidateQueries(integrationsQuery),
  });
}

export function useSaveSlack() {
  return useSlackMutation(async (botToken: string) => {
    const { data, error } = await getApiClient().api.integrations.slack.put({ botToken });

    if (error) throw new SlackSettingsError(slackFailure.safeParse(error.value).data?.error);

    return data;
  });
}

export function useRemoveSlack() {
  return useSlackMutation<void>(async () => {
    const { data, error } = await getApiClient().api.integrations.slack.delete();

    if (error) throw new SlackSettingsError(slackFailure.safeParse(error.value).data?.error);

    return data;
  });
}
