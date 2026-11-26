import { Elysia } from "elysia";
import type { PortalAuth } from "./portal-auth.js";
import { entitlementOf, type Entitlement } from "./entitlement.js";
import type { TalentProfile } from "./talent-profile.js";

const collaboratorEntitlement: Entitlement = { kind: "sponsored", until: null };

export function talentAccess(deps: {
  auth: PortalAuth;
  webOrigin: string;
  talent: {
    findById(id: string): Promise<TalentProfile | undefined>;
    ensureForCollaborator(
      principal: { caseId: string; name: string; email: string },
      now: Date,
    ): Promise<TalentProfile | "email_taken">;
  };
  companyActive: (orgId: string) => Promise<boolean>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return new Elysia({ name: "offboard:talent-access" }).macro({
    talent: (mode: "signed-in" | "active") => ({
      async resolve({ request, set, status }) {
        set.headers["cache-control"] = "no-store";
        const access = await deps.auth.resolvePrincipal(request.headers);

        if (access.kind === "anonymous") return status(401, { error: "Unauthorized" });

        const isRead = request.method === "GET" || request.method === "HEAD";

        if (!isRead && request.headers.get("origin") !== deps.webOrigin) {
          return status(403, { error: "Forbidden" });
        }

        if (access.kind !== "talent") {
          const collaborator =
            access.kind === "forbidden" ? await deps.auth.resolveEmployee?.(request.headers) : null;

          if (!collaborator) return status(403, { error: "Forbidden" });

          const me = await deps.talent.ensureForCollaborator(collaborator, now());

          if (me === "email_taken") return status(403, { error: "Forbidden" });

          return { me, entitlement: collaboratorEntitlement };
        }

        const me = await deps.talent.findById(access.profile.id);

        if (!me) return status(403, { error: "Forbidden" });

        const entitlement: Entitlement = entitlementOf({
          sponsoredUntil: me.sponsoredUntil,
          companyActive: await deps.companyActive(me.orgId),
          now: now(),
        });

        if (mode === "active") {
          if (me.termsAcceptedAt === null) return status(403, { error: "Terms not accepted" });

          if (entitlement.kind === "lapsed") return status(402, { error: "Access lapsed" });
        }

        return { me, entitlement };
      },
    }),
  });
}

export type TalentAccessPlugin = ReturnType<typeof talentAccess>;
