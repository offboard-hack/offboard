import type { AiAttempt, ConfirmAnswers } from "@/entities/career";

type Question = AiAttempt["questions"][number];

type DraftAnswer = AiAttempt["answers"][number];

export type AnswerValue = string | string[];

const textLimit = 2_000;

const fileLabels = new Map<Question["kind"], string>([
  ["resume", "Currículo"],
  ["cover_letter", "Carta de apresentação"],
  ["document", "Documento"],
]);

const sources = {
  account: "Da sua conta",
  profile: "Do seu perfil",
  library: "Das suas respostas salvas",
  resume: "Do currículo",
  cover_letter: "Da carta de apresentação",
} as const;

const attention = {
  filled: null,
  suggested: "Sugerida a partir de uma resposta sua em outra vaga. Confira antes de enviar.",
  blank: "A IA não encontrou esta resposta. Complete você.",
  not_shared: "Você escolheu não compartilhar esta resposta. Responda só se quiser.",
  sensitive: "Pergunta sensível. A IA não responde por você.",
} as const;

const profileKinds = new Set<Question["kind"]>(["phone", "linkedin", "website", "city", "cpf"]);

export function savesToProfile(
  question: Question,
  draft: DraftAnswer | undefined,
  value: AnswerValue,
) {
  return (
    profileKinds.has(question.kind) &&
    draft?.status === "blank" &&
    !Array.isArray(value) &&
    value.trim() !== ""
  );
}

export function fileQuestionLabel(question: Question) {
  return fileLabels.get(question.kind);
}

function isHidden(question: Question) {
  return question.fields.length > 0 && question.fields.every((field) => field.type === "hidden");
}

export function askedQuestions(questions: Question[]) {
  return questions.filter((question) => !fileLabels.has(question.kind) && !isHidden(question));
}

export function fileQuestions(questions: Question[]) {
  return questions.filter((question) => fileLabels.has(question.kind));
}

export function answerControl(question: Question) {
  switch (question.fields[0]?.type) {
    case "multi_select":
      return "multi" as const;
    case "single_select":
      return "single" as const;
    case "textarea":
      return "textarea" as const;
    default:
      return "text" as const;
  }
}

export function answerOptions(question: Question) {
  return question.fields[0]?.options ?? [];
}

export function draftFor(attempt: Pick<AiAttempt, "answers">, question: Question) {
  return attempt.answers.find((answer) => answer.questionId === question.id);
}

export function initialAnswer(question: Question, draft: Pick<DraftAnswer, "value"> | undefined) {
  const value = draft?.value ?? null;
  const control = answerControl(question);
  const options = new Set(answerOptions(question).map((option) => option.value));

  if (control === "multi") {
    const chosen = value === null ? [] : Array.isArray(value) ? value : [value];

    return chosen.filter((item) => options.has(item));
  }

  if (value === null || Array.isArray(value)) return "";

  return control === "single" && !options.has(value) ? "" : value;
}

export function reviewAnswer(
  attempt: Pick<AiAttempt, "answers" | "confirmed">,
  question: Question,
) {
  const confirmed = attempt.confirmed?.find((answer) => answer.questionId === question.id);

  return initialAnswer(question, confirmed ?? draftFor(attempt, question));
}

export function answerNote(draft: DraftAnswer | undefined) {
  return {
    source: draft?.source ? sources[draft.source] : null,
    inferred: draft?.inferred ?? false,
    attention: attention[draft?.status ?? "blank"],
  };
}

function normalized(value: AnswerValue | undefined) {
  if (value === undefined) return null;

  if (Array.isArray(value)) {
    const chosen = [...new Set(value)];

    return chosen.length === 0 ? null : chosen;
  }

  const text = value.trim();

  return text === "" ? null : text;
}

export function answerProblem(question: Question, value: AnswerValue) {
  const answer = normalized(value);

  if (answer === null) return question.required ? "Responda esta pergunta." : undefined;

  return !Array.isArray(answer) && answer.length > textLimit
    ? "Use até 2.000 caracteres."
    : undefined;
}

export function confirmAnswers(asked: Question[], values: AnswerValue[]) {
  return asked.map((question, index) => ({
    questionId: question.id,
    value: normalized(values[index]),
  })) satisfies ConfirmAnswers;
}
