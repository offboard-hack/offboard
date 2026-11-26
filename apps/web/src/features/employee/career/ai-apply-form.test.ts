import { describe, expect, it } from "vitest";
import type { AiAttempt } from "@/entities/career";
import {
  answerControl,
  answerNote,
  answerOptions,
  answerProblem,
  askedQuestions,
  confirmAnswers,
  draftFor,
  fileQuestionLabel,
  fileQuestions,
  initialAnswer,
  reviewAnswer,
  savesToProfile,
} from "./ai-apply-form";

type Question = AiAttempt["questions"][number];

type FieldType = Question["fields"][number]["type"];

const options = [
  { label: "Sim", value: "yes" },
  { label: "Não", value: "no" },
];

function question(
  id: string,
  type: FieldType | null,
  extra: Partial<Pick<Question, "kind" | "required" | "sensitive">> = {},
) {
  return {
    id,
    label: `Pergunta ${id}`,
    required: extra.required ?? false,
    section: "questions",
    fields:
      type === null ? [] : [{ name: id, type, options: type.endsWith("select") ? options : [] }],
    kind: extra.kind ?? "custom",
    sensitive: extra.sensitive ?? false,
  } satisfies Question;
}

const text = question("text", "text", { required: true });
const long = question("long", "textarea");
const single = question("single", "single_select");
const multi = question("multi", "multi_select");
const hidden = question("hidden", "hidden");
const resume = question("resume", "file", { kind: "resume" });
const letter = question("letter", "file", { kind: "cover_letter" });
const document = question("document", "file", { kind: "document" });
const bare = question("bare", null);

const all = [text, long, single, multi, hidden, resume, letter, document, bare];

describe("AI application form", () => {
  it("asks only the questions the person answers", () => {
    expect(askedQuestions(all).map(({ id }) => id)).toEqual([
      "text",
      "long",
      "single",
      "multi",
      "bare",
    ]);
    expect(fileQuestions(all).map(fileQuestionLabel)).toEqual([
      "Currículo",
      "Carta de apresentação",
      "Documento",
    ]);
    expect(fileQuestionLabel(text)).toBeUndefined();
  });

  it("picks a control from the field type", () => {
    expect([text, long, single, multi, bare].map(answerControl)).toEqual([
      "text",
      "textarea",
      "single",
      "multi",
      "text",
    ]);
    expect(answerOptions(single)).toEqual(options);
    expect(answerOptions(bare)).toEqual([]);
  });

  it("starts from the draft's own value only", () => {
    const attempt = {
      answers: [
        {
          questionId: "text",
          value: "Ana",
          source: "account",
          inferred: false,
          status: "filled",
        },
        {
          questionId: "single",
          value: null,
          source: null,
          inferred: false,
          status: "sensitive",
        },
      ],
    } satisfies Pick<AiAttempt, "answers">;

    expect(initialAnswer(text, draftFor(attempt, text))).toBe("Ana");
    expect(initialAnswer(single, draftFor(attempt, single))).toBe("");
    expect(initialAnswer(long, draftFor(attempt, long))).toBe("");
  });

  it("starts a re-review from the confirmed answers, falling back to the draft", () => {
    const drafted = (questionId: string, value: string) => ({
      questionId,
      value,
      source: "resume" as const,
      inferred: true,
      status: "filled" as const,
    });

    const answers = [drafted("text", "Ana"), drafted("single", "yes"), drafted("long", "Rascunho")];

    expect(reviewAnswer({ answers, confirmed: null }, text)).toBe("Ana");

    const attempt = {
      answers,
      confirmed: [
        { questionId: "text", value: "Ana Souza" },
        { questionId: "single", value: null },
      ],
    } satisfies Pick<AiAttempt, "answers" | "confirmed">;

    expect(reviewAnswer(attempt, text)).toBe("Ana Souza");
    expect(reviewAnswer(attempt, single)).toBe("");
    expect(reviewAnswer(attempt, long)).toBe("Rascunho");
    expect(reviewAnswer(attempt, multi)).toEqual([]);
  });

  it("keeps only known options in select answers", () => {
    const draft = (value: string | string[] | null) => ({
      questionId: "x",
      value,
      source: "library" as const,
      inferred: true,
      status: "filled" as const,
    });

    expect(initialAnswer(single, draft("yes"))).toBe("yes");
    expect(initialAnswer(single, draft("maybe"))).toBe("");
    expect(initialAnswer(multi, draft(["yes", "maybe"]))).toEqual(["yes"]);
    expect(initialAnswer(multi, draft("no"))).toEqual(["no"]);
    expect(initialAnswer(multi, draft(null))).toEqual([]);
    expect(initialAnswer(text, draft(["yes"]))).toBe("");
  });

  it("explains where each answer came from", () => {
    expect(
      answerNote({
        questionId: "x",
        value: "x",
        source: "resume",
        inferred: true,
        status: "filled",
      }),
    ).toEqual({ source: "Do currículo", inferred: true, attention: null });
    expect(
      answerNote({
        questionId: "x",
        value: null,
        source: null,
        inferred: false,
        status: "not_shared",
      }),
    ).toEqual({
      source: null,
      inferred: false,
      attention: "Você escolheu não compartilhar esta resposta. Responda só se quiser.",
    });
    expect(answerNote(undefined)).toEqual({
      source: null,
      inferred: false,
      attention: "A IA não encontrou esta resposta. Complete você.",
    });
  });

  it("validates required and long answers", () => {
    expect(answerProblem(text, "  ")).toBe("Responda esta pergunta.");
    expect(answerProblem(long, "")).toBeUndefined();
    expect(answerProblem(long, "a".repeat(2_001))).toBe("Use até 2.000 caracteres.");
    expect(answerProblem(multi, ["yes"])).toBeUndefined();
    expect(answerProblem(text, "Ana")).toBeUndefined();
  });

  it("sends one trimmed answer per asked question", () => {
    expect(
      confirmAnswers([text, long, single, multi, bare], [" Ana ", "", "no", ["yes", "yes"]]),
    ).toEqual([
      { questionId: "text", value: "Ana" },
      { questionId: "long", value: null },
      { questionId: "single", value: "no" },
      { questionId: "multi", value: ["yes"] },
      { questionId: "bare", value: null },
    ]);
    expect(confirmAnswers([multi], [[]])).toEqual([{ questionId: "multi", value: null }]);
  });

  it("tells when a typed answer will be saved to the profile", () => {
    const draft = (status: AiAttempt["answers"][number]["status"]) => ({
      questionId: "x",
      value: null,
      source: null,
      inferred: false,
      status,
    });

    for (const kind of ["phone", "linkedin", "website", "city", "cpf"] as const) {
      expect(savesToProfile(question(kind, "text", { kind }), draft("blank"), " x ")).toBe(true);
    }

    const phone = question("phone", "text", { kind: "phone" });

    expect(savesToProfile(phone, draft("blank"), "  ")).toBe(false);
    expect(savesToProfile(phone, draft("blank"), ["x"])).toBe(false);
    expect(savesToProfile(phone, draft("not_shared"), "11 9999")).toBe(false);
    expect(savesToProfile(phone, draft("filled"), "11 9999")).toBe(false);
    expect(savesToProfile(phone, undefined, "11 9999")).toBe(false);

    for (const kind of ["address", "birth_date", "cep", "custom"] as const) {
      expect(savesToProfile(question(kind, "text", { kind }), draft("blank"), "x")).toBe(false);
    }
  });
});
