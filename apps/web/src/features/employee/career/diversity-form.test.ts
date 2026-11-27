import { describe, expect, it } from "vitest";
import type { CareerPreferences } from "@/entities/career";
import { diversityChanges, diversityDraft, diversityFields, toggled } from "./diversity-form";

type Fields = CareerPreferences["profileFields"];

const blank = { value: null, share: false };

const fields: Fields = {
  phone: blank,
  city: blank,
  linkedin: blank,
  portfolio: blank,
  workAuthorization: blank,
  availability: blank,
  noticePeriod: blank,
  salaryExpectation: blank,
  cpf: blank,
  birthDate: blank,
  address: blank,
  gender: { value: "female;cis", share: true },
  race: { value: "brown", share: false },
  orientation: blank,
  disability: blank,
  pronoun: blank,
};

describe("drafts the diversity data", () => {
  it("splits stored values and starts empty fields shared", () => {
    expect(diversityDraft(fields)).toEqual({
      gender: { values: ["female", "cis"], share: true },
      race: { values: ["brown"], share: false },
      orientation: { values: [], share: true },
      disability: { values: [], share: true },
      pronoun: { values: [], share: true },
    });
  });

  it("offers a decline option in every field", () => {
    for (const field of diversityFields) {
      expect(field.options.at(-1)).toEqual({ value: "decline", label: "Prefiro não informar" });
    }
  });
});

describe("toggles choices", () => {
  it("replaces the choice of a single-choice field and clears it", () => {
    expect(toggled(false, ["white"], "brown", true)).toEqual(["brown"]);
    expect(toggled(false, ["brown"], "brown", false)).toEqual([]);
  });

  it("adds and removes choices of a multiple-choice field", () => {
    expect(toggled(true, ["female"], "cis", true)).toEqual(["female", "cis"]);
    expect(toggled(true, ["female", "cis"], "female", false)).toEqual(["cis"]);
  });

  it("keeps decline and no deficiency exclusive", () => {
    expect(toggled(true, ["female", "cis"], "decline", true)).toEqual(["decline"]);
    expect(toggled(true, ["decline"], "female", true)).toEqual(["female"]);
    expect(toggled(true, ["visual"], "no", true)).toEqual(["no"]);
    expect(toggled(true, ["no"], "visual", true)).toEqual(["visual"]);
  });
});

describe("sends only what changed", () => {
  it("sends nothing for an untouched draft", () => {
    expect(diversityChanges(fields, diversityDraft(fields))).toEqual({});
  });

  it("stores choices in the field's order and clears an emptied field", () => {
    const draft = diversityDraft(fields);

    draft.gender.values = ["cis", "female"];
    draft.disability.values = ["hearing", "visual"];
    draft.race.values = [];
    draft.pronoun.share = false;

    expect(diversityChanges(fields, draft)).toEqual({
      disability: { value: "visual;hearing", share: true },
      race: { value: null, share: false },
    });
  });

  it("sends a share change of a filled field", () => {
    const draft = diversityDraft(fields);

    draft.race.share = true;

    expect(diversityChanges(fields, draft)).toEqual({ race: { value: "brown", share: true } });
  });
});
