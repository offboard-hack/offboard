import type { FormQuestion, ResumeContent } from "@offboard/db/schema";
import { Elysia, t } from "elysia";
import { aiApplyAccess } from "../../shared/ai-apply-access.js";
import type { AllowedBy } from "../../shared/career-pro.js";
import type { GenerateStructured } from "../../shared/ai.js";
import { logFailure, logFailureCode } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import type { UsageRepository } from "../../shared/llm-usage.js";
import type { ObjectStorage } from "../../shared/object-storage.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { confirmedAnswers, libraryEntries, needsCoverLetter, profileFills } from "./confirm.js";
import { draftAnswers } from "./draft.js";
import type { FormResult } from "./greenhouse.js";
import {
  draftBlock,
  type AiApplyRepository,
  type SaveAnswer,
  type SaveProfile,
} from "./repository.js";
import { attemptResponse } from "./view.js";

const params = t.Object({ jobId: t.String() });
const attemptParams = t.Object({ id: t.String() });

const confirmBody = t.Object({
  answers: t.Array(
    t.Object({
      questionId: t.String({ maxLength: 200 }),
      value: t.Union([
        t.String({ maxLength: 10_000 }),
        t.Array(t.String({ maxLength: 10_000 }), { maxItems: 50 }),
        t.Null(),
      ]),
    }),
    { maxItems: 200 },
  ),
  rehearsal: t.Optional(t.Boolean()),
});

export function aiApplyRoutes(
  repos: AiApplyRepository,
  talentAccess: TalentAccessPlugin,
  deps: {
    allowedBy: (profileId: string, now: Date) => Promise<AllowedBy>;
    generate: GenerateStructured | undefined;
    runnerConfigured: boolean;
    takeLlmCall: UsageRepository["takeLlmCall"];
    readForm: (board: string, posting: string) => Promise<FormResult>;
    library: (
      profileId: string,
    ) => Promise<{ question: string; answer: string; sensitive: boolean }[]>;
    saveAnswer: SaveAnswer;
    saveProfile: SaveProfile;
    enqueueRun: (attemptId: string) => Promise<void>;
    runNow: (attemptId: string) => Promise<boolean>;
    storage: ObjectStorage | undefined;
  },
) {
  const needsDocument = (questions: FormQuestion[]) =>
    questions.some((question) => question.kind === "document" && question.required);

  async function draftInputs(
    me: { id: string; name: string; email: string },
    jobId: string,
    questions: FormQuestion[],
    resume: ResumeContent,
  ) {
    const [fields, library, coverLetter] = await Promise.all([
      repos.profileFields(me.id),
      deps.library(me.id),
      repos.coverLetter(me.id, jobId),
    ]);

    return {
      questions,
      account: { name: me.name, email: me.email },
      fields,
      library,
      resume,
      coverLetter,
    };
  }

  const gate = async (me: { id: string; aiApplyConsentAt: string | null }) => {
    const access = aiApplyAccess(me, await deps.allowedBy(me.id, new Date()));

    if (access !== "allowed") {
      return {
        refused: { code: 403 as const, error: "AI Apply not available" },
        generate: undefined,
      };
    }

    return deps.generate === undefined
      ? { refused: { code: 503 as const, error: "AI not configured" }, generate: undefined }
      : { refused: undefined, generate: deps.generate };
  };

  const conflicts = {
    in_progress: "Already in progress",
    expired: "Draft expired",
    applied: "Already applied",
  };

  const notFound = { error: "Attempt not found" };

  const noScreenshot = { error: "Screenshot not found" };

  return new Elysia()
    .use(talentAccess)
    .post(
      "/me/jobs/:jobId/ai-apply",
      async ({ me, params, status }) => {
        const open = await gate(me);

        if (open.refused) return status(open.refused.code, { error: open.refused.error });

        const { generate } = open;

        const job = await repos.openJob(params.jobId);

        if (!job) return status(404, { error: "Job not found" });

        const base = await repos.baseResume(me.id);

        if (!base) return status(409, { error: "Upload a résumé first" });

        if (await repos.hasApplied(me.id, job.id)) return status(409, { error: "Already applied" });

        if (await repos.isRejected(me.id, job.id)) return status(409, { error: "Job rejected" });

        const inProgress = { error: "Already in progress" };

        if (await repos.hasActive(me.id, job.id, new Date())) return status(409, inProgress);

        const existing = await repos.assistedAttempt(me.id, job.id);

        if (existing) return status(200, { attempt: existing });

        const form = await deps.readForm(job.board, job.posting);

        if ("error" in form) {
          return form.error === "not_found"
            ? status(404, { error: "Job not found" })
            : status(502, { error: "Could not read the application form" });
        }

        const assisted = needsDocument(form.questions);

        const stops: ("limited" | "failed")[] = [];

        const capped: GenerateStructured = async (request) => {
          if ((await deps.takeLlmCall(me.id, new Date())) !== true) {
            stops.push("limited");

            throw new Error("Daily AI limit reached");
          }

          return generate(request).catch((cause) => {
            stops.push("failed");
            logFailure("AI application draft failed")(cause);

            throw cause;
          });
        };

        const drafted = assisted
          ? []
          : await draftInputs(me, job.id, form.questions, base.content).then((input) =>
              draftAnswers(capped, input).catch((cause) => {
                if (stops.length === 0) throw cause;
              }),
            );

        if (stops.includes("limited")) return status(429, { error: "Daily AI limit reached" });

        if (drafted === undefined)
          return status(502, { error: "Could not prepare the application" });

        const attempt = await repos.createAttempt(
          me.id,
          job.id,
          {
            form: { questions: form.questions },
            draft: drafted,
            state: assisted ? "assisted" : "draft",
            reason: assisted ? "document_required" : null,
            resumeId: base.id,
          },
          new Date(),
        );

        if (attempt === "no_consent") return status(403, { error: "AI Apply not available" });

        return attempt === "in_progress" ? status(409, inProgress) : status(201, { attempt });
      },
      {
        talent: "active",
        params,
        response: {
          200: t.Object({ attempt: attemptResponse }),
          201: t.Object({ attempt: attemptResponse }),
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          429: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .get("/me/ai-applications", async ({ me }) => ({ items: await repos.list(me.id) }), {
      talent: "active",
      response: {
        200: t.Object({ items: t.Array(attemptResponse) }),
      },
    })
    .get(
      "/me/ai-applications/:id",
      async ({ me, params, status }) =>
        (await repos.get(me.id, params.id)) ?? status(404, notFound),
      {
        talent: "active",
        params: attemptParams,
        response: {
          200: attemptResponse,
          404: errorResponse,
        },
      },
    )
    .post(
      "/me/ai-applications/:id/confirm",
      async ({ me, params, body, status }) => {
        const open = await gate(me);

        if (open.refused) return status(open.refused.code, { error: open.refused.error });

        if (!deps.runnerConfigured) return status(503, { error: "AI Apply not configured" });

        const found = await repos.attempt(me.id, params.id);

        if (!found) return status(404, notFound);

        const now = new Date();
        const blocked = draftBlock(found.attempt, now);

        if (blocked !== undefined) return status(409, { error: conflicts[blocked] });

        const { questions } = found.attempt.form;
        const confirmed = confirmedAnswers(questions, body.answers);

        if (confirmed === undefined) return status(422, { error: "Invalid answers" });

        if (
          needsCoverLetter(questions) &&
          (await repos.coverLetter(me.id, found.job.id)) === null
        ) {
          return status(409, { error: "Generate a cover letter first" });
        }

        const { draft } = found.attempt;

        const result = await repos.confirm(
          me.id,
          params.id,
          {
            confirmed,
            rehearsal: body.rehearsal ?? false,
            entries: libraryEntries(questions, confirmed, draft),
            profile: profileFills(questions, confirmed, draft),
          },
          now,
          { answer: deps.saveAnswer, profile: deps.saveProfile },
        );

        if (result === "job_closed") return status(404, { error: "Job not found" });

        if (result === "daily_limit") {
          return status(429, { error: "Daily AI application limit reached" });
        }

        if (result === "in_progress" || result === "expired" || result === "applied") {
          return status(409, { error: conflicts[result] });
        }

        const stale = found.attempt.screenshotKey;

        if (stale !== null) {
          await deps.storage
            ?.remove([stale])
            .catch(logFailureCode("AI application screenshot not removed"));
        }

        await deps.enqueueRun(result.id).catch(logFailure("AI application enqueue failed"));

        return result;
      },
      {
        talent: "active",
        params: attemptParams,
        body: confirmBody,
        response: {
          200: attemptResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
          429: errorResponse,
          503: errorResponse,
        },
      },
    )
    .post(
      "/me/ai-applications/:id/run",
      async ({ me, params, status }) => {
        const open = await gate(me);

        if (open.refused) return status(open.refused.code, { error: open.refused.error });

        if (!deps.runnerConfigured) return status(503, { error: "AI Apply not configured" });

        const current = await repos.get(me.id, params.id);

        if (!current) return status(404, notFound);

        if (current.state !== "queued") return status(202, current);

        const ran = await deps.runNow(current.id);
        const after = await repos.get(me.id, current.id);

        if (!after) return status(404, notFound);

        return ran ? after : status(202, after);
      },
      {
        talent: "active",
        params: attemptParams,
        response: {
          200: attemptResponse,
          202: attemptResponse,
          403: errorResponse,
          404: errorResponse,
          503: errorResponse,
        },
      },
    )
    .get(
      "/me/ai-applications/:id/screenshot",
      async ({ me, params, status }) => {
        const key = (await repos.attempt(me.id, params.id))?.attempt.screenshotKey;
        const bytes = key && deps.storage ? await deps.storage.get(key) : null;

        if (bytes === null || bytes === undefined) return status(404, noScreenshot);

        return new Response(new Uint8Array(bytes), {
          headers: { "content-type": "image/png", "cache-control": "private, no-store" },
        });
      },
      {
        talent: "active",
        params: attemptParams,
        response: { 404: errorResponse },
      },
    )
    .post(
      "/me/ai-applications/:id/check",
      async ({ me, params, body, status }) => {
        const result = await repos.check(me.id, params.id, body.sent, new Date());

        if (result === "not_found") return status(404, notFound);

        return result === "nothing_to_check" ? status(409, { error: "Nothing to check" }) : result;
      },
      {
        talent: "active",
        params: attemptParams,
        body: t.Object({ sent: t.Boolean() }),
        response: { 200: attemptResponse, 404: errorResponse, 409: errorResponse },
      },
    )
    .post(
      "/me/ai-applications/:id/cancel",
      async ({ me, params, status }) => {
        const result = await repos.cancel(me.id, params.id, new Date());

        if (result === "not_found") return status(404, notFound);

        return result === "not_cancellable" ? status(409, { error: "Cannot cancel" }) : result;
      },
      {
        talent: "active",
        params: attemptParams,
        response: {
          200: attemptResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    );
}
