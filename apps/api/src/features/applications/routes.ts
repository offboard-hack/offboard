import { Elysia, t } from "elysia";
import { errorResponse } from "../../shared/http.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { saoPauloDayRange } from "./funnel.js";
import type { ApplicationsRepository } from "./repository.js";

const id = t.String({ format: "uuid" });

const status = t.Union([
  t.Literal("sent"),
  t.Literal("in_review"),
  t.Literal("interview"),
  t.Literal("offer"),
  t.Literal("closed"),
]);

const closedReason = t.Union([t.Literal("rejected"), t.Literal("withdrawn"), t.Literal("hired")]);

const applicationResponse = t.Object({
  id: t.String(),
  status,
  closedReason: t.Union([closedReason, t.Null()]),
  appliedAt: t.String(),
  statusChangedAt: t.String(),
  job: t.Object({
    id: t.String(),
    title: t.String(),
    company: t.String(),
    workModel: t.Union([t.Literal("remote"), t.Literal("hybrid"), t.Literal("onsite"), t.Null()]),
    city: t.Union([t.String(), t.Null()]),
    state: t.Union([t.String(), t.Null()]),
  }),
});

const interviewResponse = t.Object({
  id: t.String(),
  applicationId: t.String(),
  startsAt: t.String(),
  mode: t.Union([t.Literal("video"), t.Literal("in_person"), t.Literal("phone")]),
  with: t.String(),
  notes: t.String(),
  job: t.Object({ title: t.String(), company: t.String() }),
});

export function applicationsRoutes(
  repos: ApplicationsRepository,
  talentAccess: TalentAccessPlugin,
) {
  return new Elysia()
    .use(talentAccess)
    .post(
      "/me/jobs/:jobId/apply",
      async ({ me, params, status }) => {
        const result = await repos.apply(me.id, params.jobId);

        if (result === "job_not_found") return status(404, { error: "Job not found" });

        if (result === "already_applied") return status(409, { error: "Already applied" });

        return status(201, result);
      },
      {
        talent: "active",
        params: t.Object({ jobId: id }),
        response: {
          201: t.Object({ applicationId: t.String(), jobUrl: t.String() }),
          404: errorResponse,
          409: errorResponse,
        },
      },
    )
    .get("/me/applications", ({ me }) => repos.list(me.id), {
      talent: "active",
      response: { 200: t.Array(applicationResponse) },
    })
    .get("/me/applications/summary", ({ me }) => repos.summary(me.id), {
      talent: "active",
      response: {
        200: t.Object({
          sent: t.Integer(),
          responded: t.Integer(),
          interviews: t.Integer(),
          offers: t.Integer(),
        }),
      },
    })
    .patch(
      "/me/applications/:id",
      async ({ me, params, body, status }) => {
        const result = await repos.changeStatus(me.id, params.id, body);

        if (result === "not_found") return status(404, { error: "Application not found" });

        if (result === "invalid_transition") {
          return status(409, { error: "Invalid status transition" });
        }

        return result;
      },
      {
        talent: "active",
        params: t.Object({ id }),
        body: t.Object({ status, closedReason: t.Optional(closedReason) }),
        response: { 200: applicationResponse, 404: errorResponse, 409: errorResponse },
      },
    )
    .post(
      "/me/applications/:id/interviews",
      async ({ me, params, body, status }) => {
        const result = await repos.addInterview(me.id, params.id, {
          ...body,
          startsAt: new Date(body.startsAt),
        });

        if (result === "not_found") return status(404, { error: "Application not found" });

        if (result === "application_closed") {
          return status(409, { error: "Application is closed" });
        }

        return status(201, result);
      },
      {
        talent: "active",
        params: t.Object({ id }),
        body: t.Object({
          startsAt: t.String({ format: "date-time" }),
          mode: t.Union([t.Literal("video"), t.Literal("in_person"), t.Literal("phone")]),
          with: t.String({ minLength: 1, maxLength: 255 }),
          notes: t.Optional(t.String({ maxLength: 2000 })),
        }),
        response: { 201: interviewResponse, 404: errorResponse, 409: errorResponse },
      },
    )
    .delete(
      "/me/interviews/:id",
      async ({ me, params, status }) =>
        (await repos.removeInterview(me.id, params.id))
          ? new Response(null, { status: 204 })
          : status(404, { error: "Interview not found" }),
      {
        talent: "active",
        params: t.Object({ id }),
        response: { 204: t.Void(), 404: errorResponse },
      },
    )
    .get(
      "/me/interviews",
      async ({ me, query, status }) => {
        const range = saoPauloDayRange(query.from, query.to);

        if (range === "invalid_range") return status(422, { error: "Invalid date range" });

        return repos.interviewsBetween(me.id, range.start, range.end);
      },
      {
        talent: "active",
        query: t.Object({
          from: t.String({ format: "date" }),
          to: t.String({ format: "date" }),
        }),
        response: { 200: t.Array(interviewResponse), 422: errorResponse },
      },
    );
}
