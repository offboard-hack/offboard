import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import type { Entitlement } from "../../shared/entitlement.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import type { TalentProfile } from "../../shared/talent-profile.js";
import { aiApplyAccess, onTopPlan, type CompanyPlan } from "../../shared/ai-apply-access.js";
import type { TalentRepository } from "./repository.js";

const talentAccessResponse = t.Object({
  personalEmail: t.String(),
  sponsoredUntil: t.String(),
  signedIn: t.Boolean(),
});

const meResponse = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  termsAccepted: t.Boolean(),
  shareOutcomeWithHr: t.Boolean(),
  aiApply: t.Object({ eligible: t.Boolean(), consented: t.Boolean(), available: t.Boolean() }),
  entitlement: t.Object({
    kind: t.Union([t.Literal("sponsored"), t.Literal("lapsed")]),
    until: t.Union([t.String(), t.Null()]),
  }),
});

const caseParams = t.Object({ id: t.String({ format: "uuid" }) });
const personalEmail = t.String({ format: "email", maxLength: 255 });
const sponsoredUntil = t.String({ format: "date" });

function toTalentAccess(profile: TalentProfile) {
  return {
    personalEmail: profile.email,
    sponsoredUntil: profile.sponsoredUntil,
    signedIn: profile.firstSignedInAt !== null,
  };
}

type AiApply = {
  companyPlan: (orgId: string) => Promise<CompanyPlan | null>;
  configured: boolean;
};

async function toMe(profile: TalentProfile, entitlement: Entitlement, aiApply: AiApply) {
  const plan = await aiApply.companyPlan(profile.orgId);
  const access = aiApplyAccess(profile, plan);

  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    termsAccepted: profile.termsAcceptedAt !== null,
    shareOutcomeWithHr: profile.shareOutcomeWithHr,
    aiApply: {
      eligible: onTopPlan(plan),
      consented: profile.aiApplyConsentAt !== null,
      available: access === "allowed" && aiApply.configured,
    },
    entitlement,
  };
}

const conflicts = {
  already_enabled: "Talent access already enabled",
  email_taken: "Email already in use",
  email_locked: "Email cannot change after first sign-in",
} as const;

export function talentRoutes(
  repos: TalentRepository,
  access: PortalAccessPlugin,
  talentAccess: TalentAccessPlugin,
  sendWelcome: (profile: TalentProfile) => Promise<void>,
  aiApply: AiApply,
) {
  return new Elysia()
    .use(access)
    .use(talentAccess)
    .post(
      "/offboardings/:id/talent-access",
      async ({ principal, params, body, set, status }) => {
        const created = await repos.enable({
          orgId: principal.orgId,
          caseId: params.id,
          ...body,
        });

        if (created === "case_not_found") return status(404, { error: "Offboarding not found" });

        if (created === "already_enabled" || created === "email_taken") {
          return status(409, { error: conflicts[created] });
        }

        if (!(await repos.signsInAsCollaborator(params.id))) await sendWelcome(created);

        set.status = 201;

        return toTalentAccess(created);
      },
      {
        permit: ["update", "Offboarding"],
        params: caseParams,
        body: t.Object({ personalEmail, sponsoredUntil }),
        response: { 201: talentAccessResponse, 404: errorResponse, 409: errorResponse },
      },
    )
    .get(
      "/offboardings/:id/talent-access",
      async ({ principal, params, status }) => {
        const found = await repos.findByCase(principal.orgId, params.id);

        return found ? toTalentAccess(found) : status(404, { error: "Talent access not found" });
      },
      {
        permit: ["read", "Offboarding"],
        params: caseParams,
        response: { 200: talentAccessResponse, 404: errorResponse },
      },
    )
    .patch(
      "/offboardings/:id/talent-access",
      async ({ principal, params, body, status }) => {
        const updated = await repos.updateAccess(principal.orgId, params.id, body);

        if (updated === "not_found") return status(404, { error: "Talent access not found" });

        if (updated === "email_locked" || updated === "email_taken") {
          return status(409, { error: conflicts[updated] });
        }

        if (updated.firstSignedInAt === null) {
          await sendWelcome(updated);
        }

        return toTalentAccess(updated);
      },
      {
        permit: ["update", "Offboarding"],
        params: caseParams,
        body: t.Object(
          { personalEmail: t.Optional(personalEmail), sponsoredUntil: t.Optional(sponsoredUntil) },
          { minProperties: 1 },
        ),
        response: { 200: talentAccessResponse, 404: errorResponse, 409: errorResponse },
      },
    )
    .get("/me", ({ me, entitlement }) => toMe(me, entitlement, aiApply), {
      talent: "signed-in",
      response: { 200: meResponse },
    })
    .post(
      "/me/terms",
      async ({ me, entitlement }) => toMe(await repos.acceptTerms(me.id), entitlement, aiApply),
      {
        talent: "signed-in",
        response: { 200: meResponse },
      },
    )
    .put(
      "/me/consent",
      async ({ me, entitlement, body }) =>
        toMe(
          await repos.setConsent(me.id, body.shareOutcomeWithHr, new Date()),
          entitlement,
          aiApply,
        ),
      {
        talent: "signed-in",
        body: t.Object({ shareOutcomeWithHr: t.Boolean() }),
        response: { 200: meResponse },
      },
    )
    .put(
      "/me/ai-apply/consent",
      async ({ me, entitlement, body }) =>
        toMe(await repos.setAiApplyConsent(me.id, body.accept, new Date()), entitlement, aiApply),
      {
        talent: "signed-in",
        body: t.Object({ accept: t.Boolean() }),
        response: { 200: meResponse },
      },
    );
}
