import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type TalentAggregates = Treaty.Data<ApiClient["api"]["talent"]["aggregates"]["get"]>;

async function getTalentAggregates({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.talent.aggregates.get({
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch talent aggregates");

  return data;
}

export const talentAggregatesQuery = queryOptions({
  queryKey: ["talent", "aggregates"],
  queryFn: getTalentAggregates,
  staleTime: 30_000,
});
