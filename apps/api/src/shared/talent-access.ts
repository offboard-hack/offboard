import { Elysia } from "elysia";
import type { PortalAuth } from "./portal-auth.js";
import {
  benefitEntitlement,
  entitlementOf,
  individualEntitlement,
  type Entitlement,
  type IndividualPlan,
} from "./entitlement.js";
import { saoPauloDate } from "./sao-paulo-date.js";
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
  individualPlan: (profileId: string) => Promise<IndividualPlan | null>;
  benefitPlan?: (
    profileId: string,
  ) => Promise<{ aiApplyDailyLimit: number; validUntil: string } | null>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  return new Elysia({ name: "offboard:talent-access" }).macro({
    talent: (mode: "signed-in" | "active") => ({
      async resolve({ request, set, status }) {
        set.headers["cache-control"] = "no-store";
        const isRead = request.method === "GET" || request.method === "HEAD";
        const crossOrigin = !isRead && request.headers.get("origin") !== deps.webOrigin;
        const collaborator = await deps.auth.resolveEmployee?.(request.headers);

        if (collaborator) {
          if (crossOrigin) return status(403, { error: "Forbidden" });

          const me = await deps.talent.ensureForCollaborator(collaborator, now());

          if (me === "email_taken") return status(403, { error: "Email already in use" });

          return { me, entitlement: collaboratorEntitlement };
        }

        const access = await deps.auth.resolvePrincipal(request.headers);

        if (access.kind === "anonymous") return status(401, { error: "Unauthorized" });

        if (crossOrigin) return status(403, { error: "Forbidden" });

        if (access.kind === "authenticated") return status(403, { error: "Forbidden" });

        if (access.kind === "forbidden") return status(401, { error: "Unauthorized" });

        const me = await deps.talent.findById(access.profile.id);

        if (!me) return status(403, { error: "Forbidden" });

        const at = now();

        const sponsored: Entitlement = entitlementOf({
          sponsoredUntil: me.sponsoredUntil,
          companyActive: await deps.companyActive(me.orgId),
          now: at,
        });

        const benefit: Entitlement =
          sponsored.kind === "lapsed" && deps.benefitPlan
            ? benefitEntitlement(await deps.benefitPlan(me.id), saoPauloDate(at))
            : sponsored;

        const entitlement: Entitlement =
          benefit.kind === "lapsed"
            ? individualEntitlement(await deps.individualPlan(me.id), at)
            : benefit;

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
