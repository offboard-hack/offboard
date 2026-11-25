import { Elysia, t } from "elysia";
import { z } from "zod";
import { errorResponse } from "../../shared/http.js";
import { sanitizeText } from "../../shared/storable-text.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { noteLimit, type RejectionsRepository } from "./rejections.js";

const invalid = { error: "Invalid rejection" };

const reason = t.Union([
  t.Literal("salary"),
  t.Literal("location"),
  t.Literal("company"),
  t.Literal("seniority"),
  t.Literal("work_model"),
  t.Literal("not_interested"),
  t.Literal("other"),
]);

const note = z
  .string()
  .overwrite(sanitizeText)
  .trim()
  .max(noteLimit)
  .transform((value) => (value === "" ? null : value));

const nullable = t.Union([t.String(), t.Null()]);

const listResponse = t.Object({
  items: t.Array(
    t.Object({
      job: t.Object({ id: t.String(), title: t.String(), company: t.String() }),
      reason,
      note: nullable,
      createdAt: nullable,
    }),
  ),
  reasons: t.Array(t.Object({ reason, count: t.Integer() })),
});

export function rejectionsRoutes(repos: RejectionsRepository, talentAccess: TalentAccessPlugin) {
  return new Elysia()
    .use(talentAccess)
    .post(
      "/me/jobs/:jobId/reject",
      async ({ me, params, body, status }) => {
        const parsed = note.safeParse(body.note ?? "");

        if (!parsed.success) return status(422, invalid);

        const rejected = await repos.reject(
          me.id,
          params.jobId,
          { reason: body.reason, note: parsed.data },
          new Date(),
        );

        return rejected
          ? new Response(null, { status: 204 })
          : status(404, { error: "Job not found" });
      },
      {
        talent: "active",
        params: t.Object({ jobId: t.String() }),
        body: t.Object({ reason, note: t.Optional(t.Union([t.String(), t.Null()])) }),
        response: { 204: t.Void(), 404: errorResponse, 422: errorResponse },
        error: ({ code, status }) => (code === "VALIDATION" ? status(422, invalid) : undefined),
      },
    )
    .delete(
      "/me/jobs/:jobId/reject",
      async ({ me, params }) => {
        await repos.unreject(me.id, params.jobId);

        return new Response(null, { status: 204 });
      },
      {
        talent: "active",
        params: t.Object({ jobId: t.String() }),
        response: { 204: t.Void() },
      },
    )
    .get("/me/rejections", ({ me }) => repos.list(me.id), {
      talent: "active",
      response: listResponse,
    });
}
