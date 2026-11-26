import type { Database } from "@offboard/db/client";
import { answerQuestions, talentAnswers } from "@offboard/db/schema";
import { normalizeQuestion } from "@offboard/db/question";
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { z } from "zod";
import { sanitizeText } from "../../shared/storable-text.js";

export const answerLimit = 2_000;
export const questionLimit = 500;

export type AnswersExecutor = Pick<Database, "select" | "insert" | "delete">;

export function createAnswersRepository(db: AnswersExecutor) {
  async function library(profileId: string) {
    const questions = await db
      .select({
        id: answerQuestions.id,
        text: answerQuestions.text,
        common: answerQuestions.common,
        sensitive: answerQuestions.sensitive,
        answer: talentAnswers.answer,
      })
      .from(answerQuestions)
      .leftJoin(
        talentAnswers,
        and(
          eq(talentAnswers.questionId, answerQuestions.id),
          eq(talentAnswers.profileId, profileId),
        ),
      )
      .where(or(eq(answerQuestions.common, true), isNotNull(talentAnswers.profileId)))
      .orderBy(desc(answerQuestions.common), asc(answerQuestions.text), asc(answerQuestions.id));

    return {
      questions,
      unanswered: questions.filter((item) => item.common && item.answer === null).length,
    };
  }

  async function answer(profileId: string, questionId: string, text: string, now: Date) {
    if (!z.uuid().safeParse(questionId).success) return false;

    const [question] = await db
      .select({ id: answerQuestions.id })
      .from(answerQuestions)
      .where(eq(answerQuestions.id, questionId));

    if (!question) return false;

    const cleaned = sanitizeText(text).trim();

    if (cleaned === "") {
      await db
        .delete(talentAnswers)
        .where(
          and(eq(talentAnswers.profileId, profileId), eq(talentAnswers.questionId, questionId)),
        );

      return true;
    }

    await db
      .insert(talentAnswers)
      .values({ profileId, questionId, answer: cleaned, updatedAt: now })
      .onConflictDoUpdate({
        target: [talentAnswers.profileId, talentAnswers.questionId],
        set: { answer: cleaned, updatedAt: now },
      });

    return true;
  }

  async function ensureQuestion(
    text: string,
    now: Date,
    { sensitive = false }: { sensitive?: boolean } = {},
  ) {
    const trimmed = sanitizeText(text).trim();
    const normalized = normalizeQuestion(trimmed);

    if (normalized === "" || trimmed.length > questionLimit) throw new Error("Invalid question");

    const insert = db
      .insert(answerQuestions)
      .values({ normalized, text: trimmed, common: false, sensitive, createdAt: now });

    await (sensitive
      ? insert.onConflictDoUpdate({ target: answerQuestions.normalized, set: { sensitive: true } })
      : insert.onConflictDoNothing({ target: answerQuestions.normalized }));

    const [row] = await db
      .select({ id: answerQuestions.id })
      .from(answerQuestions)
      .where(eq(answerQuestions.normalized, normalized));

    return row.id;
  }

  return { library, answer, ensureQuestion };
}

export type AnswersRepository = ReturnType<typeof createAnswersRepository>;
