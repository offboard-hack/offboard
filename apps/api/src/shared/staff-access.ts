import { Elysia } from "elysia";
import type { PortalAuth } from "./portal-auth.js";

export function parseStaffEmails(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function staffAccess(auth: PortalAuth) {
  return new Elysia({ name: "offboard:staff-access" }).macro({
    staff: {
      async resolve({ request, set, status }) {
        set.headers["cache-control"] = "no-store";

        const access = await auth.resolvePrincipal(request.headers);

        if (access.kind === "anonymous") return status(401, { error: "Unauthorized" });

        if (access.kind !== "staff") return status(403, { error: "Forbidden" });

        return {};
      },
    },
  });
}

export type StaffAccessPlugin = ReturnType<typeof staffAccess>;
