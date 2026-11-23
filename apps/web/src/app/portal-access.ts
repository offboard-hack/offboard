import { createPortalAbility, type PortalPermission, type PortalPrincipal } from "@offboard/access";
import { redirect } from "@tanstack/react-router";

export function requirePortalAccess(principal: PortalPrincipal, ...permission: PortalPermission) {
  if (!createPortalAbility(principal.role).can(...permission)) {
    throw redirect({ to: "/sem-acesso", replace: true });
  }
}
