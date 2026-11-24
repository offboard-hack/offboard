import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import type { Entitlement } from "./entitlement.js";
import type { TalentAccessPlugin } from "./access.js";
import type { TalentProfile, TalentRepository } from "./repository.js";

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

function toMe(profile: TalentProfile, entitlement: Entitlement) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    termsAccepted: profile.termsAcceptedAt !== null,
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
  inviteTalent: (email: string) => Promise<void>,
) {
  return new Elysia()
    .use(access)
    .use(talentAccess)
    .post(
      "/offboardings/:id/talent-access",
      async ({ params, body, set, status }) => {
        const created = await repos.enable({ caseId: params.id, ...body });

        if (created === "case_not_found") return status(404, { error: "Offboarding not found" });

        if (created === "already_enabled" || created === "email_taken") {
          return status(409, { error: conflicts[created] });
        }

        await inviteTalent(created.email);
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
      async ({ params, status }) => {
        const found = await repos.findByCase(params.id);

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
      async ({ params, body, status }) => {
        const before = await repos.findByCase(params.id);
        const updated = await repos.updateAccess(params.id, body);

        if (updated === "not_found") return status(404, { error: "Talent access not found" });

        if (updated === "email_locked" || updated === "email_taken") {
          return status(409, { error: conflicts[updated] });
        }

        if (before && before.email.toLowerCase() !== updated.email.toLowerCase()) {
          await inviteTalent(updated.email);
        }

        return toTalentAccess(updated);
      },
      {
        permit: ["update", "Offboarding"],
        params: caseParams,
        body: t.Object({
          personalEmail: t.Optional(personalEmail),
          sponsoredUntil: t.Optional(sponsoredUntil),
        }),
        response: { 200: talentAccessResponse, 404: errorResponse, 409: errorResponse },
      },
    )
    .get("/me", ({ me, entitlement }) => toMe(me, entitlement), {
      talent: "signed-in",
      response: { 200: meResponse },
    })
    .post(
      "/me/terms",
      async ({ me, entitlement }) => toMe(await repos.acceptTerms(me.id), entitlement),
      {
        talent: "signed-in",
        response: { 200: meResponse },
      },
    );
}
