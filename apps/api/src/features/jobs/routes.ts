import { Elysia, t } from "elysia";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
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
    fitsPreferences: t.Boolean(),
    aiApplyCapable: t.Boolean(),
    description: t.String(),
  }),
]);

const listResponse = t.Object({
  items: t.Array(talentJobResponse),
  page: t.Integer(),
  pageSize: t.Literal(pageSize),
  total: t.Integer(),
});

export function jobsRoutes(repos: JobsRepository, talentAccess: TalentAccessPlugin) {
  return new Elysia().use(talentAccess).get(
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
