import { queryOptions } from "@tanstack/react-query";
import { apiBase } from "./offboarding";

export type MemberRole = "admin" | "gestor" | "rh" | "visualizador";

export type TeamMember = { id: string; name: string; email: string; role: MemberRole };

export type NewTeamMember = Omit<TeamMember, "id">;

async function listTeam() {
  const response = await fetch(`${apiBase()}/api/team`);

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
  const response = await fetch(`${apiBase()}/api/team`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(member),
  });

  if (!response.ok) {
    throw new Error("Failed to create team member");
  }
}

export async function deleteTeamMember(id: string) {
  const response = await fetch(`${apiBase()}/api/team/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to delete team member");
  }
}
