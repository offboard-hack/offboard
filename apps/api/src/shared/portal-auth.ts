import type { PortalPrincipal } from "@offboard/access";
import { t } from "elysia";
import type { EmployeePrincipal } from "./employee-auth.js";

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

export type PortalAccess =
  | { kind: "anonymous" }
  | { kind: "forbidden" }
  | { kind: "authenticated"; principal: PortalPrincipal };

export type PortalAuth = {
  handler: (request: Request) => Promise<Response>;
  resolvePrincipal: (headers: Headers) => Promise<PortalAccess>;
  resolveEmployee?: (headers: Headers) => Promise<EmployeePrincipal | null>;
};
