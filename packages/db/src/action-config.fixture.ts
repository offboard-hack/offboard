import type { ConfigValue } from "./schema/index.ts";

export type SeedActionConfig = {
  actionId: string;
  enabled: boolean;
  config: Record<string, ConfigValue>;
  phase: string;
};

export const seedActionConfigs: SeedActionConfig[] = [
  {
    actionId: "email::notify_collaborator",
    enabled: true,
    config: { subject: "Seu desligamento", body: "Informamos que..." },
    phase: "d0",
  },
  { actionId: "google::block_account", enabled: true, config: {}, phase: "d0" },
  { actionId: "slack::send_message", enabled: false, config: { channel: "#rh" }, phase: "d0" },
];
