import { Elysia, t } from "elysia";
import { z } from "zod";
import { errorResponse } from "../../shared/http.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import { sanitizeText } from "../../shared/storable-text.js";
import { answerLimit, type AnswersRepository } from "./answers.js";

const invalid = { error: "Invalid answer" };

const answerInput = z.object({
  answer: z.string().overwrite(sanitizeText).trim().max(answerLimit),
});

const library = t.Object({
  questions: t.Array(
    t.Object({
      id: t.String(),
      text: t.String(),
      common: t.Boolean(),
      answer: t.Union([t.String(), t.Null()]),
    }),
  ),
  unanswered: t.Integer(),
});

export function answersRoutes(repos: AnswersRepository, talentAccess: TalentAccessPlugin) {
  return new Elysia()
    .use(talentAccess)
    .get("/me/answers", ({ me }) => repos.library(me.id), {
      talent: "active",
      response: library,
    })
    .put(
      "/me/answers/:questionId",
      async ({ me, params, body, status }) => {
        const input = answerInput.safeParse(body);

        if (!input.success) return status(422, invalid);

        const found = await repos.answer(me.id, params.questionId, input.data.answer, new Date());

        if (!found) return status(404, { error: "Question not found" });

        return repos.library(me.id);
      },
      {
        talent: "active",
        params: t.Object({ questionId: t.String() }),
        body: t.Object({ answer: t.String() }),
        response: { 200: library, 404: errorResponse, 422: errorResponse },
        error: ({ code, status }) => (code === "VALIDATION" ? status(422, invalid) : undefined),
      },
    );
}
