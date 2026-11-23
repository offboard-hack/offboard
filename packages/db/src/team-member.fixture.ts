import type { teamMembers } from "./schema/index.ts";

type MemberRole = (typeof teamMembers.$inferSelect)["role"];

export type SeedTeamMember = { name: string; email: string; role: MemberRole };

export const seedTeamMembers: SeedTeamMember[] = [
  { name: "Beatriz Castro", email: "beatriz.castro@offboard.com", role: "admin" },
  { name: "Camila Rocha", email: "camila.rocha@offboard.com", role: "rh" },
  { name: "Diego Alves", email: "diego.alves@offboard.com", role: "gestor" },
];
