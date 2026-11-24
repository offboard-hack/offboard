import type { PortalPrincipal } from "@offboard/access";
import { t } from "elysia";

export const memberRole = t.Union([
  t.Literal("admin"),
  t.Literal("gestor"),
  t.Literal("rh"),
  t.Literal("visualizador"),
]);

export const portalPrincipalResponse = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  role: memberRole,
});

export type TalentPrincipal = { id: string; name: string; email: string };

export type PortalAccess =
  | { kind: "anonymous" }
  | { kind: "forbidden" }
  | { kind: "authenticated"; principal: PortalPrincipal }
  | { kind: "talent"; profile: TalentPrincipal };

export type PortalAuth = {
  handler: (request: Request) => Promise<Response>;
  resolvePrincipal: (headers: Headers) => Promise<PortalAccess>;
};
