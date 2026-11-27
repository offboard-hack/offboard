import type { integrations } from "./schema/index.ts";

type ConnectionStatus = (typeof integrations.$inferSelect)["status"];

export type SeedIntegration = { name: string; status: ConnectionStatus };

export const seedIntegrations: SeedIntegration[] = [
  { name: "E-mail", status: "connected" },
  { name: "Transportadora::Correios", status: "connected" },
];
