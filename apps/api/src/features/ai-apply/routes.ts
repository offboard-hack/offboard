import type { FormQuestion } from "@offboard/db/schema";
import { Elysia, t } from "elysia";
import { aiApplyAccess } from "../../shared/ai-apply-access.js";
import type { GenerateStructured } from "../../shared/ai.js";
import { logFailure } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import type { UsageRepository } from "../../shared/llm-usage.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { draftAnswers } from "./draft.js";
import type { FormResult } from "./greenhouse.js";
import type { AiApplyRepository } from "./repository.js";
import { attemptResponse } from "./view.js";

const params = t.Object({ jobId: t.String() });

export function aiApplyRoutes(
  repos: AiApplyRepository,
  talentAccess: TalentAccessPlugin,
  deps: {
    allowlist: string[];
    generate: GenerateStructured | undefined;
    takeLlmCall: UsageRepository["takeLlmCall"];
    readForm: (board: string, posting: string) => Promise<FormResult>;
    library: (profileId: string) => Promise<{ question: string; answer: string }[]>;
  },
) {
  const needsDocument = (questions: FormQuestion[]) =>
    questions.some((question) => question.kind === "document" && question.required);

  return new Elysia().use(talentAccess).post(
    "/me/jobs/:jobId/ai-apply",
    async ({ me, params, status }) => {
      const { generate } = deps;

      const access = aiApplyAccess(
        { personalEmail: me.email, aiApplyConsentAt: me.aiApplyConsentAt },
        deps.allowlist,
      );

      if (access !== "allowed") return status(403, { error: "AI Apply not available" });

      if (!generate) return status(503, { error: "AI not configured" });

      const job = await repos.openJob(params.jobId);

      if (!job) return status(404, { error: "Job not found" });

      const base = await repos.baseResume(me.id);

      if (!base) return status(409, { error: "Upload a résumé first" });

      if (await repos.hasApplied(me.id, job.id)) return status(409, { error: "Already applied" });

      if (await repos.isRejected(me.id, job.id)) return status(409, { error: "Job rejected" });

      const inProgress = { error: "Already in progress" };

      if (await repos.hasActive(me.id, job.id)) return status(409, inProgress);

      const form = await deps.readForm(job.board, job.posting);

      if ("error" in form) {
        return form.error === "not_found"
          ? status(404, { error: "Job not found" })
          : status(502, { error: "Could not read the application form" });
      }

      const assisted = needsDocument(form.questions);

      let limited = false;

      const capped: GenerateStructured = async (request) => {
        if ((await deps.takeLlmCall(me.id, new Date())) !== true) {
          limited = true;

          throw new Error("Daily AI limit reached");
        }

        return generate(request);
      };

      const answers = assisted
        ? []
        : await Promise.all([
            repos.profileFields(me.id),
            deps.library(me.id),
            repos.coverLetter(me.id, job.id),
          ])
            .then(([fields, library, coverLetter]) =>
              draftAnswers(capped, {
                questions: form.questions,
                account: { name: me.name, email: me.email },
                fields,
                library,
                resume: base.content,
                coverLetter,
              }),
            )
            .catch(logFailure("AI application draft failed"));

      if (limited) return status(429, { error: "Daily AI limit reached" });

      if (answers === undefined) return status(502, { error: "Could not prepare the application" });

      const attempt = await repos.createAttempt(
        me.id,
        job.id,
        {
          form: { questions: form.questions },
          draft: answers,
          state: assisted ? "assisted" : "draft",
          reason: assisted ? "document_required" : null,
          resumeId: base.id,
        },
        new Date(),
      );

      return attempt === "in_progress" ? status(409, inProgress) : status(201, { attempt });
    },
    {
      talent: "active",
      params,
      response: {
        201: t.Object({ attempt: attemptResponse }),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        429: errorResponse,
        502: errorResponse,
        503: errorResponse,
      },
    },
  );
}
