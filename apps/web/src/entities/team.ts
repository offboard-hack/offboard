import type { ApiClient, Treaty } from "@offboard/api-client";
import { queryOptions } from "@tanstack/react-query";
import { getApiClient } from "@/shared/lib/api-client";

export type TeamMember = Treaty.Data<ApiClient["api"]["team"]["get"]>[number];

export type MemberRole = TeamMember["role"];

export type NewTeamMember = Parameters<ApiClient["api"]["team"]["post"]>[0];

async function listTeam({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api.team.get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch team");

  return data;
}

export const teamQuery = queryOptions({
  queryKey: ["team"],
  queryFn: listTeam,
  staleTime: 30_000,
});

export async function createTeamMember(member: NewTeamMember) {
  const { error } = await getApiClient().api.team.post(member);

  if (error) throw new Error("Failed to create team member");
}

export async function deleteTeamMember(id: string) {
  const { error } = await getApiClient()
    .api.team({ id: encodeURIComponent(id) })
    .delete();

  if (error) throw new Error("Failed to delete team member");
}
