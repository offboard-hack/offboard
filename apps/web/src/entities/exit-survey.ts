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

export type ExitSurveyComment = Treaty.Data<
  ApiClient["api"]["exit-surveys"]["comments"]["get"]
>[number];

async function getExitSurveyComments({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["exit-surveys"].comments.get({
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch exit survey comments");

  return data;
}

export const exitSurveyCommentsQuery = queryOptions({
  queryKey: ["exit-surveys", "comments"],
  queryFn: getExitSurveyComments,
  staleTime: 30_000,
});
