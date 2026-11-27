import { Elysia } from "elysia";
import { accessVerifierFromEnv, denyAll, type AccessVerifier } from "./cloudflare-access.js";

export type BackofficeAccess = { verify: AccessVerifier; staffEmails: ReadonlySet<string> };

export const closedBackoffice: BackofficeAccess = { verify: denyAll, staffEmails: new Set() };

export function parseStaffEmails(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function backofficeAccessFromEnv(env: {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  BACKOFFICE_STAFF_EMAILS?: string;
}) {
  return {
    verify: accessVerifierFromEnv(env),
    staffEmails: parseStaffEmails(env.BACKOFFICE_STAFF_EMAILS),
  } satisfies BackofficeAccess;
}

export function staffAccess({ verify, staffEmails }: BackofficeAccess) {
  return new Elysia({ name: "offboard:staff-access" }).macro({
    staff: {
      async resolve({ request, set, status }) {
        set.headers["cache-control"] = "no-store";

        const token = request.headers.get("cf-access-jwt-assertion");
        const email = token === null ? undefined : await verify(token).catch(() => undefined);

        if (email === undefined) return status(401, { error: "Unauthorized" });

        if (!staffEmails.has(email.toLowerCase())) return status(403, { error: "Forbidden" });

        return {};
      },
    },
  });
}

export type StaffAccessPlugin = ReturnType<typeof staffAccess>;
