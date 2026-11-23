import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/shared/lib/api-fetch";

import type { MemberRole } from "@offboard/access";

export type { MemberRole } from "@offboard/access";

export type TeamMember = { id: string; name: string; email: string; role: MemberRole };

export type NewTeamMember = Omit<TeamMember, "id">;

async function listTeam({ signal }: { signal: AbortSignal }) {
  const response = await apiFetch("/api/team", { signal });

  if (!response.ok) {
    throw new Error("Failed to fetch team");
  }

  const rows: TeamMember[] = await response.json();

  return rows;
}

export const teamQuery = queryOptions({
  queryKey: ["team"],
  queryFn: listTeam,
  staleTime: 30_000,
});

export async function createTeamMember(member: NewTeamMember) {
  const response = await fetch("/api/team", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(member),
  });

  if (!response.ok) {
    throw new Error("Failed to create team member");
  }
}

export async function deleteTeamMember(id: string) {
  const response = await fetch(`/api/team/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to delete team member");
  }
}
