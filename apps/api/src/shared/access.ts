import { createPortalAbility, type PortalPermission } from "@offboard/access";
import { Elysia } from "elysia";
import type { PortalAuth } from "./portal-auth.js";

export function portalAccess(auth: PortalAuth, webOrigin: string) {
  return new Elysia({ name: "offboard:portal-access" }).macro({
    permit: (permission: PortalPermission) => ({
      async beforeHandle({ request, set, status }) {
        set.headers["cache-control"] = "no-store";
        const access = await auth.resolvePrincipal(request.headers);

        if (access.kind === "anonymous") return status(401, { error: "Unauthorized" });

        if (access.kind !== "authenticated") return status(403, { error: "Forbidden" });

        const ability = createPortalAbility(access.principal.role);
        const isRead = request.method === "GET" || request.method === "HEAD";

        if (
          !ability.can(...permission) ||
          (!isRead && request.headers.get("origin") !== webOrigin)
        ) {
          return status(403, { error: "Forbidden" });
        }
      },
    }),
  });
}

export type PortalAccessPlugin = ReturnType<typeof portalAccess>;
