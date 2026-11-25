import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import type { GenerateStructured } from "../../shared/ai.js";
import { errorResponse } from "../../shared/http.js";
import { jobShareFailures } from "../../shared/job-share.js";
import type { FetchPageResult } from "../../shared/page-text.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import type { JobsRepository } from "./repository.js";
import { shareJob } from "./share.js";

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
    onShared?: (jobId: string) => Promise<void>;
  },
) {
  return new Elysia()
    .use(access)
    .use(talentAccess)
    .post(
      "/jobs/share",
      async ({ body, set, status }) => {
        const outcome = await shareJob(
          { repos, generate: deps.generate, fetchPage: deps.fetchPage },
          { url: body.url, origin: "hr" },
        );

        if (outcome.kind === "existing") return outcome.job;

        if (outcome.kind === "created") {
          set.status = 201;
          await deps.onShared?.(outcome.job.id).catch(() => undefined);

          return outcome.job;
        }

        const failure = jobShareFailures[outcome.kind];

        return status(failure.status, { error: failure.error });
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
