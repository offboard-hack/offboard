import type { teamMembers } from "./schema/index.ts";

type MemberRole = (typeof teamMembers.$inferSelect)["role"];

export type SeedTeamMember = { name: string; email: string; role: MemberRole };

export const seedTeamMembers: SeedTeamMember[] = [
  { name: "Beatriz Castro", email: "beatriz.castro@offboard.com", role: "admin" },
  { name: "Camila Rocha", email: "camila.rocha@offboard.com", role: "rh" },
  { name: "Diego Alves", email: "diego.alves@offboard.com", role: "gestor" },
  { name: "Fernanda Lima", email: "fernanda.lima@offboard.com", role: "rh" },
  { name: "Lucas Pereira", email: "lucas.pereira@offboard.com", role: "gestor" },
  { name: "Mariana Santos", email: "mariana.santos@offboard.com", role: "visualizador" },
  { name: "Roberto Souza", email: "roberto.souza@offboard.com", role: "admin" },
  { name: "Juliana Ferreira", email: "juliana.ferreira@offboard.com", role: "visualizador" },
  { name: "Samuel Molling", email: "samuelmolling@gmail.com", role: "admin" },
];
