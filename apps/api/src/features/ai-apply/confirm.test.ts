import type { DraftAnswer, FormQuestion } from "@offboard/db/schema";
import { describe, expect, it } from "vitest";
import { confirmedAnswers, isFileQuestion, libraryEntries, profileFills } from "./confirm.js";

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

  it("ignores hidden-only questions and never turns them into library entries", () => {
    const hidden = question({
      id: "lat",
      required: true,
      fields: [{ name: "lat", type: "hidden", options: [] }],
    });

    const asked = question({ id: "q" });
    const given = [{ questionId: "q", value: "oi" }];

    expect(confirmedAnswers([hidden, asked], given)).toEqual([{ questionId: "q", value: "oi" }]);
    expect(
      confirmedAnswers([hidden, asked], [...given, { questionId: "lat", value: "1" }]),
    ).toBeUndefined();
    expect(
      libraryEntries([hidden, asked], [{ questionId: "q", value: "oi" }], []).map(
        (entry) => entry.label,
      ),
    ).toEqual(["Pergunta"]);
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
        [],
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

    expect(libraryEntries([multi], [{ questionId: "q", value: [] }], [])).toEqual([]);
  });
});

describe("profileFills", () => {
  const kinds = [
    ["phone", "phone"],
    ["linkedin", "linkedin"],
    ["website", "website"],
    ["city", "city"],
    ["cpf", "cpf"],
    ["address", "address"],
    ["birth_date", "birth_date"],
    ["cep", "cep"],
    ["custom", "custom"],
  ] as const;

  const questions = kinds.map(([id, kind]) => question({ id, kind, label: id }));

  const typed = {
    phone: "11 99999-8888",
    linkedin: "linkedin.com/in/rafael",
    website: "https://rafael.dev",
    city: "São Paulo, SP",
    cpf: "529.982.247-25",
    address: "Rua Teste, 123",
    birth_date: "17/05/1990",
    cep: "05422-000",
    custom: "Outro",
  };

  const confirmed = kinds.map(([id]) => ({ questionId: id, value: typed[id] }));

  const drafted = (status: DraftAnswer["status"]) =>
    kinds.map(([id]) => ({ questionId: id, value: null, source: null, inferred: false, status }));

  it("keeps what the person typed for blank profile questions, CPF as digits", () => {
    expect(profileFills(questions, confirmed, drafted("blank"))).toEqual({
      phone: "11 99999-8888",
      linkedin: "linkedin.com/in/rafael",
      portfolio: "https://rafael.dev",
      city: "São Paulo, SP",
      cpf: "52998224725",
    });
  });

  it("never fills from questions that were filled, not shared or sensitive", () => {
    for (const status of ["filled", "not_shared", "sensitive"] as const) {
      expect(profileFills(questions, confirmed, drafted(status))).toEqual({});
    }
  });

  it("skips an invalid CPF, an empty or a list answer, long text and repeats of a field", () => {
    const repeat = question({ id: "phone2", kind: "phone", label: "Celular" });
    const draft = [...drafted("blank"), { ...drafted("blank")[0], questionId: "phone2" }];

    expect(
      profileFills(
        [...questions, repeat],
        [
          { questionId: "phone", value: null },
          { questionId: "phone2", value: "11 3333-4444" },
          { questionId: "linkedin", value: ["linkedin.com/in/x"] },
          { questionId: "website", value: "x".repeat(501) },
          { questionId: "city", value: "Campinas" },
          { questionId: "cpf", value: "111.111.111-11" },
        ],
        draft,
      ),
    ).toEqual({ phone: "11 3333-4444", city: "Campinas" });

    expect(
      profileFills(
        [question({ id: "a", kind: "city" }), question({ id: "b", kind: "city" })],
        [
          { questionId: "a", value: "Santos" },
          { questionId: "b", value: "Campinas" },
        ],
        ["a", "b"].map((questionId) => ({ ...drafted("blank")[0], questionId })),
      ),
    ).toEqual({ city: "Santos" });
  });
});
