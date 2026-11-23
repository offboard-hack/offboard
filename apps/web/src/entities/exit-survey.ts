import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type ExitSurveyAggregates = Treaty.Data<
  ApiClient["api"]["exit-surveys"]["aggregates"]["get"]
>;

async function getExitSurveyAggregates({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["exit-surveys"].aggregates.get({
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch exit survey aggregates");

  return data;
}

export const exitSurveyAggregatesQuery = queryOptions({
  queryKey: ["exit-surveys", "aggregates"],
  queryFn: getExitSurveyAggregates,
  staleTime: 30_000,
});
