import type { MongoAbility } from "@casl/ability";
import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import { z } from "zod";

export const memberRoleSchema = z.enum(["admin", "rh", "gestor", "visualizador"]);

export type MemberRole = z.infer<typeof memberRoleSchema>;

export const principalSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  role: memberRoleSchema,
});

export type PortalPrincipal = z.infer<typeof principalSchema>;

export type PortalPermission = [
  "manage" | "read" | "create" | "update",
  "all" | "Offboarding" | "Team" | "Integrations",
];

export function createPortalAbility(role: MemberRole) {
  const { can, build } = new AbilityBuilder<MongoAbility<PortalPermission>>(createMongoAbility);

  can("read", "Offboarding");

  if (role === "admin") {
    can("manage", "all");
  }

  if (role === "rh") {
    can(["create", "update"], "Offboarding");
  }

  return build();
}
