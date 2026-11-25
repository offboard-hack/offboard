import type { FormQuestion } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { confirmedAnswers, isFileQuestion, libraryEntries } from "./confirm.js";

const question = (partial: Partial<FormQuestion>) =>
  ({
    id: "q",
    label: "Pergunta",
    required: false,
    section: "questions",
    fields: [{ name: "q", type: "text", options: [] }],
    kind: "custom",
    sensitive: false,
    ...partial,
  }) satisfies FormQuestion;

describe("confirmedAnswers", () => {
  it("treats a question without fields as free text", () => {
    const bare = question({ fields: [] });

    expect(confirmedAnswers([bare], [{ questionId: "q", value: " oi " }])).toEqual([
      { questionId: "q", value: "oi" },
    ]);
    expect(confirmedAnswers([bare], [{ questionId: "q", value: ["oi"] }])).toBeUndefined();
  });

  it("reads a missing multi-select value as blank", () => {
    const multi = question({
      fields: [{ name: "q", type: "multi_select", options: [{ label: "A", value: "1" }] }],
    });

    expect(confirmedAnswers([multi], [{ questionId: "q", value: null }])).toEqual([
      { questionId: "q", value: null },
    ]);
  });

  it("ignores file questions", () => {
    const file = question({ id: "cv", kind: "resume", fields: [] });

    expect(isFileQuestion(file)).toBe(true);
    expect(confirmedAnswers([file], [])).toEqual([]);
  });
});

describe("libraryEntries", () => {
  it("keeps the raw value when the option is unknown and skips unanswered questions", () => {
    const multi = question({
      fields: [{ name: "q", type: "multi_select", options: [{ label: "A", value: "1" }] }],
    });

    const noFields = question({ id: "n", label: "Livre", fields: [] });

    expect(
      libraryEntries(
        [multi, noFields, question({ id: "x" })],
        [
          { questionId: "q", value: ["1", "9"] },
          { questionId: "n", value: "texto" },
        ],
      ),
    ).toEqual([
      { label: "Pergunta", text: "A; 9", sensitive: false },
      { label: "Livre", text: "texto", sensitive: false },
    ]);
  });

  it("skips empty selections", () => {
    const multi = question({
      fields: [{ name: "q", type: "multi_select", options: [{ label: "", value: "1" }] }],
    });

    expect(libraryEntries([multi], [{ questionId: "q", value: [] }])).toEqual([]);
  });
});
