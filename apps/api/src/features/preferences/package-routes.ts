import { Elysia, t } from "elysia";
import type { GenerateStructured } from "../../shared/ai.js";
import { logFailure } from "../../shared/error-summary.js";
import { errorResponse } from "../../shared/http.js";
import type { UsageRepository } from "../../shared/llm-usage.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { writeCoverLetter } from "./cover-letter.js";
import type { PackagesRepository } from "./package.js";

const notFound = { error: "Job not found" };

const params = t.Object({ jobId: t.String() });

const packageResponse = t.Object({
  job: t.Object({ title: t.String(), company: t.String(), url: t.String() }),
  resume: t.Union([
    t.Object({ id: t.String(), kind: t.Union([t.Literal("base"), t.Literal("tailored")]) }),
    t.Null(),
  ]),
  coverLetter: t.Union([t.String(), t.Null()]),
  profile: t.Array(t.Object({ field: t.String(), value: t.String() })),
  answers: t.Array(t.Object({ question: t.String(), answer: t.String() })),
});

export function packageRoutes(
  repos: PackagesRepository,
  talentAccess: TalentAccessPlugin,
  deps: {
    generate: GenerateStructured | undefined;
    takeLlmCall: UsageRepository["takeLlmCall"];
  },
) {
  return new Elysia()
    .use(talentAccess)
    .post(
      "/me/jobs/:jobId/cover-letter",
      async ({ me, params, status }) => {
        const job = await repos.openJob(params.jobId);

        if (!job) return status(404, notFound);

        const resume = await repos.resumeFor(me.id, job.id);

        if (!resume) return status(409, { error: "Upload a résumé first" });

        const { generate } = deps;

        if (!generate) return status(503, { error: "AI not configured" });

        if ((await deps.takeLlmCall(me.id, new Date())) !== true) {
          return status(429, { error: "Daily AI limit reached" });
        }

        const failed = { error: "Could not write the cover letter" };

        const coverLetter = await writeCoverLetter(generate, resume.content, job).catch(
          logFailure("cover letter failed"),
        );

        if (coverLetter === undefined || coverLetter === "invented_numbers") {
          return status(502, failed);
        }

        await repos.saveCoverLetter(me.id, job.id, coverLetter, new Date());

        return { coverLetter };
      },
      {
        talent: "active",
        params,
        response: {
          200: t.Object({ coverLetter: t.String() }),
          404: errorResponse,
          409: errorResponse,
          429: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .get(
      "/me/jobs/:jobId/package",
      async ({ me, params, status }) => {
        const job = await repos.openJob(params.jobId);

        if (!job) return status(404, notFound);

        const resume = await repos.resumeFor(me.id, job.id);

        return {
          job: { title: job.title, company: job.company, url: job.url },
          resume: resume ? { id: resume.id, kind: resume.kind } : null,
          ...(await repos.assemble(me.id, job.id)),
        };
      },
      {
        talent: "active",
        params,
        response: { 200: packageResponse, 404: errorResponse },
      },
    );
}
