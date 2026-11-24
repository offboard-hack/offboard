import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import type { GenerateStructured } from "../../shared/ai.js";
import { errorResponse } from "../../shared/http.js";
import { parsePublicUrl, type FetchPageResult } from "../../shared/page-text.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { extractJob, normalizeJobUrl } from "./extract.js";
import type { JobsRepository } from "./repository.js";

const pageSize = 20;

const workModel = t.Union([t.Literal("remote"), t.Literal("hybrid"), t.Literal("onsite")]);

const jobResponse = t.Object({
  id: t.String(),
  origin: t.Union([t.Literal("external"), t.Literal("hr"), t.Literal("recruiter")]),
  title: t.String(),
  company: t.String(),
  workModel: t.Union([workModel, t.Null()]),
  city: t.Union([t.String(), t.Null()]),
  state: t.Union([t.String(), t.Null()]),
  salaryMinCents: t.Union([t.Integer(), t.Null()]),
  salaryMaxCents: t.Union([t.Integer(), t.Null()]),
  url: t.String(),
  postedAt: t.Union([t.String(), t.Null()]),
});

const talentJobResponse = t.Composite([
  jobResponse,
  t.Object({
    match: t.Union([t.Object({ score: t.Integer(), reasons: t.Array(t.String()) }), t.Null()]),
    applied: t.Boolean(),
  }),
]);

const listResponse = t.Object({
  items: t.Array(talentJobResponse),
  page: t.Integer(),
  pageSize: t.Literal(pageSize),
  total: t.Integer(),
});

export function jobsRoutes(
  repos: JobsRepository,
  access: PortalAccessPlugin,
  talentAccess: TalentAccessPlugin,
  deps: {
    generate: GenerateStructured | undefined;
    fetchPage: (url: URL) => Promise<FetchPageResult>;
  },
) {
  return new Elysia()
    .use(access)
    .use(talentAccess)
    .post(
      "/jobs/share",
      async ({ body, set, status }) => {
        const parsed = parsePublicUrl(body.url);

        if (parsed === "invalid_url") return status(422, { error: "Invalid job url" });

        const sourceKey = normalizeJobUrl(parsed);

        if (sourceKey.length > 2048) return status(422, { error: "Invalid job url" });

        const existing = await repos.findBySource("hr-link", sourceKey);

        if (existing) return existing;

        if (!deps.generate) return status(503, { error: "AI not configured" });

        const page = await deps.fetchPage(parsed);

        if (page === "invalid_url") return status(422, { error: "Invalid job url" });

        if (page === "unreachable" || page === "not_html" || page === "too_large") {
          return status(502, { error: "Could not read the job page" });
        }

        let draft;

        try {
          draft = await extractJob(deps.generate, page);
        } catch (error) {
          console.error("job extraction failed", error);

          return status(502, { error: "Could not extract the job" });
        }

        if (draft === "not_a_job") return status(422, { error: "Page is not a job posting" });

        const { job, created } = await repos.createShared({ ...draft, url: sourceKey, sourceKey });

        set.status = created ? 201 : 200;

        return job;
      },
      {
        permit: ["create", "Offboarding"],
        body: t.Object({ url: t.String({ maxLength: 2048 }) }),
        response: {
          200: jobResponse,
          201: jobResponse,
          422: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .get(
      "/me/jobs",
      async ({ query, me }) => {
        const page = query.page ?? 1;

        const { items, total } = await repos.listForTalent(me.id, {
          workModel: query.workModel,
          page,
          pageSize,
        });

        return { items, page, pageSize, total } as const;
      },
      {
        talent: "active",
        query: t.Object({
          workModel: t.Optional(workModel),
          page: t.Optional(t.Numeric({ minimum: 1, maximum: 10_000, multipleOf: 1 })),
        }),
        response: { 200: listResponse },
      },
    );
}
