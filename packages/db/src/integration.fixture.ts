import type { ConnectionStatus } from "./repositories/index.ts";

export type SeedIntegration = { name: string; status: ConnectionStatus };

export const seedIntegrations: SeedIntegration[] = [
  { name: "Sistema de folha", status: "connected" },
  { name: "Sistema de ponto", status: "reconnect" },
  { name: "Google Workspace", status: "connected" },
  { name: "Slack", status: "connected" },
  { name: "HubSpot", status: "connected" },
  { name: "Inventário de TI", status: "connected" },
  { name: "Transportadora::Correios", status: "connected" },
  { name: "Clínica ocupacional", status: "connected" },
  { name: "Operadora do plano de saúde", status: "connected" },
  { name: "Cartão corporativo", status: "disconnected" },
  { name: "Microsoft 365", status: "disconnected" },
];
