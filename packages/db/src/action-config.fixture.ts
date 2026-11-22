import type { ConfigValue } from "./schema/index.ts";

export type SeedActionConfig = {
  actionId: string;
  enabled: boolean;
  config: Record<string, ConfigValue>;
  phase: string;
};

export const seedActionConfigs: SeedActionConfig[] = [
  {
    actionId: "email:notify-collaborator",
    enabled: true,
    config: {
      to: "rh@empresa.com.br",
      subject: "Offboard: {{task}} — {{status}}",
      body: "<p>A tarefa <b>{{task}}</b> mudou para <b>{{status}}</b> na fase <b>{{phase}}</b>.</p>",
    },
    phase: "d0",
  },
  {
    actionId: "email:notify-manager",
    enabled: true,
    config: {
      to: "gestao@empresa.com.br",
      subject: "Desligamento: {{task}}",
      body: "<p>Tarefa <b>{{task}}</b> concluída ({{status}}) — fase {{phase}}.</p>",
    },
    phase: "first-week",
  },
  {
    actionId: "slack:rh-channel",
    enabled: true,
    config: { channel: "#rh-offboard", message: "✅ {{task}} → {{status}} ({{phase}})" },
    phase: "d0",
  },
  {
    actionId: "slack:ti-channel",
    enabled: true,
    config: { channel: "#ti-offboard", message: "🔒 {{task}} → {{status}} ({{phase}})" },
    phase: "d0",
  },
  {
    actionId: "webhook:erp-sync",
    enabled: true,
    config: { url: "https://erp.empresa.com.br/api/offboard/events", method: "POST" },
    phase: "first-week",
  },
  {
    actionId: "webhook:audit-log",
    enabled: true,
    config: { url: "https://audit.empresa.com.br/api/events", method: "POST" },
    phase: "d0",
  },
  {
    actionId: "email:farewell",
    enabled: false,
    config: {
      to: "all@empresa.com.br",
      subject: "Despedida: {{task}}",
      body: "<p>Comunicamos o desligamento — fase {{phase}}.</p>",
    },
    phase: "follow-up",
  },
];
