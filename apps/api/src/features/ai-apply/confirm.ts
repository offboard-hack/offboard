import { normalizeQuestion } from "@offboard/db/question";
import type { ConfirmedAnswer, DraftAnswer, FormQuestion } from "@offboard/db/schema";
import { sanitizeText } from "../../shared/storable-text.js";

export type GivenAnswer = { questionId: string; value: string | string[] | null };

const fileKinds = new Set<FormQuestion["kind"]>(["resume", "cover_letter", "document"]);

const textLimit = 2_000;
const labelLimit = 500;

export const isFileQuestion = (question: FormQuestion) => fileKinds.has(question.kind);

function clean(question: FormQuestion, value: string | string[] | null) {
  const [field] = question.fields;
  const options = new Set(field?.options.map((option) => option.value));

  if (field?.type === "multi_select") {
    if (value !== null && !Array.isArray(value)) return undefined;

    const chosen = [...new Set(value ?? [])];

    if (!chosen.every((item) => options.has(item))) return undefined;

    return chosen.length === 0 ? null : chosen;
  }

  if (Array.isArray(value)) return undefined;

  if (field?.type === "single_select") {
    if (value === null || value === "") return null;

    return options.has(value) ? value : undefined;
  }

  const text = sanitizeText(value ?? "").trim();

  if (text.length > textLimit) return undefined;

  return text === "" ? null : text;
}

export function confirmedAnswers(questions: FormQuestion[], given: GivenAnswer[]) {
  const asked = questions.filter((question) => !isFileQuestion(question));
  const byId = new Map(given.map((answer) => [answer.questionId, answer.value]));

  if (byId.size !== given.length || given.length !== asked.length) return undefined;

  const confirmed: ConfirmedAnswer[] = [];

  for (const question of asked) {
    const value = byId.get(question.id);

    if (value === undefined) return undefined;

    const cleaned = clean(question, value);

    if (cleaned === undefined || (cleaned === null && question.required)) return undefined;

    confirmed.push({ questionId: question.id, value: cleaned });
  }

  return confirmed;
}

export function needsCoverLetter(questions: FormQuestion[]) {
  return questions.some((question) => question.kind === "cover_letter" && question.required);
}

function labels(question: FormQuestion, value: string | string[]) {
  const options = question.fields[0]?.options ?? [];
  const label = (item: string) => options.find((option) => option.value === item)?.label ?? item;

  return Array.isArray(value) ? value.map(label).join("; ") : label(value);
}

export function libraryEntries(
  questions: FormQuestion[],
  confirmed: ConfirmedAnswer[],
  draft: DraftAnswer[],
) {
  const values = new Map(confirmed.map((answer) => [answer.questionId, answer.value]));

  const withheld = new Set(
    draft.flatMap((answer) => (answer.status === "not_shared" ? [answer.questionId] : [])),
  );

  return questions.flatMap((question) => {
    const value = values.get(question.id);
    const { label } = question;

    if (question.kind !== "custom" || value === null || value === undefined) return [];

    if (withheld.has(question.id) || label.length > labelLimit) return [];

    if (normalizeQuestion(label) === "") return [];

    const text = labels(question, value);

    return text === "" ? [] : [{ label, text, sensitive: question.sensitive }];
  });
}
