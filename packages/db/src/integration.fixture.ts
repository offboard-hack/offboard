import type { ConnectionStatus } from "./repositories/index.ts";

export type SeedIntegration = { name: string; status: ConnectionStatus };

export const seedIntegrations: SeedIntegration[] = [
  { name: "Email (Resend)", status: "connected" },
  { name: "Slack", status: "connected" },
  { name: "Correios", status: "connected" },
  { name: "Google Workspace", status: "connected" },
  { name: "Sistema de folha", status: "connected" },
  { name: "Sistema de ponto", status: "reconnect" },
  { name: "HubSpot", status: "connected" },
  { name: "Inventário de TI", status: "connected" },
  { name: "Clínica ocupacional", status: "connected" },
  { name: "Operadora do plano de saúde", status: "connected" },
  { name: "Cartão corporativo", status: "disconnected" },
  { name: "Microsoft 365", status: "disconnected" },
];
