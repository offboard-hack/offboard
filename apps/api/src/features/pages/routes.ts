import { Elysia, t } from "elysia";
import { entitlementOf, individualEntitlement } from "../../shared/entitlement.js";
import { logFailure } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import type { PortalAuth } from "../../shared/portal-auth.js";
import { pdfAttachment, renderResumePdf } from "../../shared/resume-pdf.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { toPublicResume } from "./public-view.js";
import type { PageSettings, PagesRepository } from "./repository.js";

const maxTokenLength = 64;

const notFound = { error: "Page not found" };

const nullableString = t.Union([t.String(), t.Null()]);

const publicResumeResponse = t.Object({
  name: t.String(),
  headline: t.String(),
  summary: t.String(),
  experiences: t.Array(
    t.Object({
      company: t.String(),
      role: t.String(),
      start: t.String(),
      end: nullableString,
      bullets: t.Array(t.String()),
    }),
  ),
  education: t.Array(
    t.Object({
      institution: t.String(),
      degree: t.String(),
      start: nullableString,
      end: nullableString,
    }),
  ),
  skills: t.Array(t.String()),
  languages: t.Array(t.Object({ name: t.String(), level: nullableString })),
  contact: t.Object({ email: nullableString, links: t.Array(t.String()) }),
});

const pageResponse = t.Object({
  slug: t.String(),
  enabled: t.Boolean(),
  resumeId: nullableString,
  url: t.String(),
  week: t.Object({
    days: t.Array(t.Object({ day: t.String(), visits: t.Integer(), recruiterVisits: t.Integer() })),
    visits: t.Integer(),
    recruiterVisits: t.Integer(),
  }),
});

const slugParams = t.Object({ slug: t.String() });

export function pagesRoutes(
  repos: PagesRepository,
  talentAccess: TalentAccessPlugin,
  deps: { auth: PortalAuth; companyActive: (orgId: string) => Promise<boolean>; origin: string },
) {
  async function published(slug: string, now: Date) {
    const page = await repos.publicPage(slug);

    if (!page) return undefined;

    if (page.collaborator) return page;

    const companyActive = await deps.companyActive(page.orgId);

    const entitlement = entitlementOf({ sponsoredUntil: page.sponsoredUntil, companyActive, now });

    if (entitlement.kind !== "lapsed") return page;

    return individualEntitlement(page.individual, now).kind === "lapsed" ? undefined : page;
  }

  async function owns(headers: Headers, profileId: string) {
    const viewer = await deps.auth
      .resolvePrincipal(headers)
      .catch(logFailure("public page viewer lookup failed"));

    return viewer?.kind === "talent" && viewer.profile.id === profileId;
  }

  async function settingsView(profileId: string, settings: PageSettings, now: Date) {
    return {
      slug: settings.slug,
      enabled: settings.enabled,
      resumeId: settings.resumeId,
      url: `${deps.origin}/p/${settings.slug}`,
      week: await repos.week(profileId, now),
    };
  }

  return new Elysia()
    .use(talentAccess)
    .get(
      "/public/pages/:slug",
      async ({ params, query, request, set, status }) => {
        const now = new Date();
        const page = await published(params.slug, now);

        if (!page) {
          set.headers["cache-control"] = "no-store";

          return status(404, notFound);
        }

        if (!(await owns(request.headers, page.profileId))) {
          const token = query.a !== undefined && query.a.length <= maxTokenLength ? query.a : null;

          await repos
            .recordVisit(page.profileId, token, now)
            .catch(logFailure("public page visit failed"));
        }

        set.headers["cache-control"] = "private, max-age=60";

        return toPublicResume(page.name, page.content);
      },
      {
        params: slugParams,
        query: t.Object({ a: t.Optional(t.String()) }),
        response: { 200: publicResumeResponse, 404: errorResponse },
      },
    )
    .get(
      "/public/pages/:slug/pdf",
      async ({ params, set, status }) => {
        const page = await published(params.slug, new Date());

        if (!page) {
          set.headers["cache-control"] = "no-store";

          return status(404, notFound);
        }

        return pdfAttachment(
          await renderResumePdf(toPublicResume(page.name, page.content)),
          params.slug,
          "private, max-age=300",
        );
      },
      { params: slugParams, response: { 404: errorResponse } },
    )
    .get(
      "/me/page",
      async ({ me }) => {
        const now = new Date();

        return settingsView(me.id, await repos.settings(me.id), now);
      },
      { talent: "active", response: pageResponse },
    )
    .patch(
      "/me/page",
      async ({ me, body, status }) => {
        const now = new Date();
        const saved = await repos.save(me.id, body, now);

        if (saved === "invalid_slug") return status(422, { error: "Invalid slug" });

        if (saved === "slug_taken") return status(409, { error: "Slug taken" });

        if (saved === "resume_not_ready") return status(422, { error: "Résumé not ready" });

        return settingsView(me.id, saved, now);
      },
      {
        talent: "active",
        body: t.Object(
          {
            enabled: t.Optional(t.Boolean()),
            slug: t.Optional(t.String()),
            resumeId: t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()])),
          },
          { minProperties: 1 },
        ),
        response: { 200: pageResponse, 409: errorResponse, 422: errorResponse },
      },
    );
}
