import { Elysia, t } from "elysia";
import { errorResponse } from "../../shared/http.js";
import type { GenerateStructured } from "../../shared/ai.js";
import type { ObjectStorage } from "../../shared/object-storage.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { resumeContentInputSchema, withNodeIds } from "./content.js";
import { readResumeFile } from "./document.js";
import { extractResume } from "./extract.js";
import type { ResumesRepository } from "./repository.js";
import { resumeContentBody, resumeResponse, suggestionResponse } from "./schema.js";
import type { SuggestionsRepository } from "./suggestions.js";

const maxBytes = 5_242_880;

const suggestionParams = t.Object({ id: t.String({ format: "uuid" }) });

const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function discard(storage: ObjectStorage, keys: string[]) {
  return storage.remove(keys).catch(() => undefined);
}

export function resumesRoutes(
  repos: ResumesRepository,
  talentAccess: TalentAccessPlugin,
  deps: {
    generate: GenerateStructured | undefined;
    storage: ObjectStorage | undefined;
    suggestions: SuggestionsRepository;
    rescore: (resumeId: string, profileId: string) => Promise<void>;
  },
) {
  return new Elysia()
    .use(talentAccess)
    .post(
      "/me/resume/upload",
      async ({ me, body, status }) => {
        const { generate, storage } = deps;

        if (!generate || !storage) {
          return status(503, { error: "Résumé upload not configured" });
        }

        const file = readResumeFile(new Uint8Array(await body.file.arrayBuffer()));

        if (file === "unsupported") return status(422, { error: "Unsupported file" });

        if (file === "too_large") return status(422, { error: "File too large" });

        const key = `resumes/${me.id}/${crypto.randomUUID()}.${file.kind}`;

        await storage.put(key, file.data, file.kind === "pdf" ? "application/pdf" : docxType);

        const content = await extractResume(generate, file).catch(() => undefined);

        if (content === undefined) {
          await discard(storage, [key]);

          return status(502, { error: "Could not read the résumé" });
        }

        if (content === "not_a_resume") {
          await discard(storage, [key]);

          return status(422, { error: "File is not a résumé" });
        }

        const saved = await repos.replaceBase(me.id, content, key).catch(async (error) => {
          await discard(storage, [key]);

          throw error;
        });

        if (saved.previousFileKey) await discard(storage, [saved.previousFileKey]);

        await deps.rescore(saved.resume.id, me.id);

        return saved.resume;
      },
      {
        talent: "active",
        body: t.Object({ file: t.File({ maxSize: maxBytes }) }),
        response: {
          200: resumeResponse,
          422: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    )
    .get(
      "/me/resume",
      async ({ me, status }) =>
        (await repos.getBase(me.id)) ?? status(404, { error: "Résumé not found" }),
      {
        talent: "active",
        response: { 200: resumeResponse, 404: errorResponse },
      },
    )
    .patch(
      "/me/resume",
      async ({ me, body, status }) => {
        const input = resumeContentInputSchema.safeParse(body.content);

        if (!input.success) return status(422, { error: "Invalid résumé content" });

        const content = withNodeIds(input.data);

        if (content === "duplicate_ids") return status(422, { error: "Duplicate node ids" });

        const saved = await repos.updateBaseContent(me.id, content);

        if (!saved) return status(404, { error: "Résumé not found" });

        await deps.rescore(saved.id, me.id);

        return saved;
      },
      {
        talent: "active",
        body: t.Object({ content: resumeContentBody }),
        response: { 200: resumeResponse, 404: errorResponse, 422: errorResponse },
        error: ({ code, status }) =>
          code === "VALIDATION" ? status(422, { error: "Invalid résumé content" }) : undefined,
      },
    )
    .get("/me/resume/suggestions", ({ me }) => deps.suggestions.listOpen(me.id), {
      talent: "active",
      response: t.Array(suggestionResponse),
    })
    .post(
      "/me/resume/suggestions/:id/apply",
      async ({ me, params, status }) => {
        const applied = await deps.suggestions.apply(me.id, params.id, new Date());

        if (applied === "not_found") return status(404, { error: "Suggestion not found" });

        if (applied === "stale") {
          return status(409, { error: "Résumé changed since this suggestion" });
        }

        await deps.rescore(applied.id, me.id);

        return applied;
      },
      {
        talent: "active",
        params: suggestionParams,
        response: { 200: resumeResponse, 404: errorResponse, 409: errorResponse },
      },
    )
    .post(
      "/me/resume/suggestions/:id/dismiss",
      async ({ me, params, status }) =>
        (await deps.suggestions.dismiss(me.id, params.id))
          ? new Response(null, { status: 204 })
          : status(404, { error: "Suggestion not found" }),
      {
        talent: "active",
        params: suggestionParams,
        response: { 204: t.Void(), 404: errorResponse },
      },
    );
}
