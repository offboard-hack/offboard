import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import type { ExitSurveysRepository } from "./repository.js";

const answers = t.Record(t.String(), t.Any());

const surveyBase = {
  id: t.String(),
  caseId: t.String(),
  npsScore: t.Integer(),
  responses: answers,
  topics: t.Array(t.String()),
  submittedAt: t.String(),
};

const surveyRow = t.Object(surveyBase);

const surveyListRow = t.Object({ ...surveyBase, caseName: t.String() });

const labeledValue = t.Object({ label: t.String(), value: t.Integer() });

const ratingAverage = t.Object({
  key: t.String(),
  label: t.String(),
  average: t.Number(),
  responses: t.Integer(),
});

const comment = t.Object({
  comment: t.String(),
  month: t.String(),
  author: t.Nullable(t.Object({ name: t.String(), department: t.String() })),
});

const aggregates = t.Object({
  totalResponses: t.Integer(),
  averageNps: t.Number(),
  nps: t.Integer(),
  completionRate: t.Integer(),
  ratings: t.Array(ratingAverage),
  responsesByMonth: t.Array(labeledValue),
  topTopics: t.Array(labeledValue),
});

export function exitSurveysRoutes(repos: ExitSurveysRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get(
      "/exit-surveys",
      async ({ principal }) => {
        const rows = await repos.listSurveys(principal.orgId);

        return rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() }));
      },
      {
        permit: ["read", "ExitSurveys"],
        response: t.Array(surveyListRow),
      },
    )
    .get(
      "/exit-surveys/aggregates",
      ({ principal }) => repos.getSurveyAggregates(principal.orgId),
      {
        permit: ["read", "ExitSurveys"],
        response: aggregates,
      },
    )
    .get("/exit-surveys/comments", ({ principal }) => repos.listComments(principal.orgId), {
      permit: ["read", "ExitSurveys"],
      response: t.Array(comment),
    })
    .post(
      "/exit-surveys",
      async ({ body, principal, set, status }) => {
        const created = await repos.submitSurvey(
          principal.orgId,
          body.caseId,
          body.npsScore,
          body.responses,
          body.topics,
        );

        if (!created) return status(404, { error: "Case not found" });

        set.status = 201;

        return { ...created, submittedAt: created.submittedAt.toISOString() };
      },
      {
        permit: ["read", "Offboarding"],
        body: t.Object({
          caseId: t.String({ format: "uuid" }),
          npsScore: t.Integer({ minimum: 0, maximum: 10 }),
          responses: answers,
          topics: t.Array(t.String({ minLength: 1, maxLength: 255 }), { maxItems: 20 }),
        }),
        response: { 201: surveyRow, 404: errorResponse },
      },
    );
}
