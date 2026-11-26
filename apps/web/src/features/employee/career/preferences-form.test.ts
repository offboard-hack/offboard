import { describe, expect, it } from "vitest";
import type { CareerPreferences } from "@/entities/career";
import {
  addressProblem,
  answerProblem,
  isValidCpf,
  profileChanges,
  profileDraft,
  textProblem,
} from "./preferences-form";

type Fields = CareerPreferences["profileFields"];

const blank = { value: null, share: false };

const empty: Fields = {
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
};

const address = {
  cep: "93700000",
  street: "Rua A",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Campo Bom",
  state: "RS",
};

const stored: Fields = {
  ...empty,
  phone: { value: "(51) 99999-0000", share: true },
  cpf: { value: "52998224725", share: false },
  birthDate: { value: "1990-03-07", share: false },
  address: { value: address, share: true },
};

const today = "2026-11-26";

describe("drafts the profile for editing", () => {
  it("shows stored values in the formats people type", () => {
    const draft = profileDraft(stored);

    expect(draft.phone).toEqual({ value: "(51) 99999-0000", share: true });
    expect(draft.cpf).toEqual({ value: "529.982.247-25", share: false });
    expect(draft.birthDate).toEqual({ value: "07/03/1990", share: false });
    expect(draft.address).toMatchObject({ cep: "93700-000", complement: "", share: true });
  });

  it("starts empty fields shared so a new value reaches the forms", () => {
    const draft = profileDraft(empty);

    expect(draft.city).toEqual({ value: "", share: true });
    expect(draft.address).toEqual({
      cep: "",
      street: "",
      number: "",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
      share: true,
    });
  });
});

describe("sends only what changed", () => {
  it("sends nothing for an untouched draft", () => {
    expect(profileChanges(stored, profileDraft(stored))).toEqual({});
    expect(profileChanges(empty, profileDraft(empty))).toEqual({});
  });

  it("sends a new value, a cleared value and a share change", () => {
    const draft = profileDraft(stored);

    draft.city = { value: " Campo Bom, RS ", share: true };
    draft.phone = { value: "", share: true };
    draft.cpf = { value: "529.982.247-25", share: true };
    draft.birthDate = { value: "08/03/1990", share: false };

    expect(profileChanges(stored, draft)).toEqual({
      city: { value: "Campo Bom, RS", share: true },
      phone: { value: null, share: true },
      cpf: { value: "52998224725", share: true },
      birthDate: { value: "1990-03-08", share: false },
    });
  });

  it("ignores the share switch of a field that stays empty", () => {
    const draft = profileDraft(empty);

    draft.linkedin.share = false;
    draft.address.share = false;

    expect(profileChanges(empty, draft)).toEqual({});
  });

  it("sends the address normalized, cleared or with a new share", () => {
    const edited = profileDraft(stored);

    edited.address = {
      ...edited.address,
      cep: "93700-001",
      complement: " Ap 4 ",
      state: "rs",
    };

    expect(profileChanges(stored, edited).address).toEqual({
      value: { ...address, cep: "93700001", complement: "Ap 4" },
      share: true,
    });

    const cleared = profileDraft(stored);

    cleared.address = { ...profileDraft(empty).address, share: true };

    expect(profileChanges(stored, cleared).address).toEqual({ value: null, share: true });

    const hidden = profileDraft(stored);

    hidden.address.share = false;

    expect(profileChanges(stored, hidden).address).toEqual({ value: address, share: false });
  });
});

describe("checks the fields like the server does", () => {
  it("accepts empty fields and plain text", () => {
    expect(textProblem("city", "  ", today)).toBeUndefined();
    expect(textProblem("availability", "Imediata", today)).toBeUndefined();
    expect(textProblem("availability", "x".repeat(501), today)).toBe("Use até 500 caracteres.");
  });

  it("wants a Brazilian phone with the area code", () => {
    expect(textProblem("phone", "(51) 99999-0000", today)).toBeUndefined();
    expect(textProblem("phone", "+55 51 3333-0000", today)).toBeUndefined();
    expect(textProblem("phone", "+351 912 345 678", today)).toBe("Use um número do Brasil.");
    expect(textProblem("phone", "99999-0000", today)).toBe("Informe o DDD e o número.");
  });

  it("validates the CPF check digits", () => {
    expect(textProblem("cpf", "529.982.247-25", today)).toBeUndefined();
    expect(textProblem("cpf", "529.982.247-24", today)).toBe("CPF inválido.");
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
    expect(isValidCpf("12345678909")).toBe(true);
    expect(isValidCpf("10000000108")).toBe(true);
  });

  it("wants a real birth date of someone at least 14", () => {
    expect(textProblem("birthDate", "07/03/1990", today)).toBeUndefined();
    expect(textProblem("birthDate", "26/11/2012", today)).toBeUndefined();
    expect(textProblem("birthDate", "1990-03-07", today)).toBe("Use o formato DD/MM/AAAA.");
    expect(textProblem("birthDate", "31/02/1990", today)).toBe("Use o formato DD/MM/AAAA.");
    expect(textProblem("birthDate", "01/01/1899", today)).toBe("Use o formato DD/MM/AAAA.");
    expect(textProblem("birthDate", "27/11/2012", today)).toBe("Confira a data de nascimento.");
  });

  it("wants the whole address or none of it", () => {
    const draft = profileDraft(stored).address;
    const none = profileDraft(empty).address;

    expect(addressProblem(draft)).toBeUndefined();
    expect(addressProblem(none)).toBeUndefined();
    expect(addressProblem({ ...none, complement: "Ap 4" })).toBe(
      "Preencha cep ou apague o endereço.",
    );
    expect(addressProblem({ ...draft, number: " " })).toBe("Preencha número ou apague o endereço.");
    expect(addressProblem({ ...draft, number: "1".repeat(21) })).toBe("Número está longo demais.");
    expect(addressProblem({ ...draft, cep: "9370-000" })).toBe("Use o CEP no formato 00000-000.");
    expect(addressProblem({ ...draft, state: "XX" })).toBe("Use a sigla do estado, como RS.");
    expect(addressProblem({ ...draft, state: "sp" })).toBeUndefined();
  });

  it("limits a saved answer to 2,000 characters", () => {
    expect(answerProblem("Sim")).toBeUndefined();
    expect(answerProblem("x".repeat(2_001))).toBe("Use até 2.000 caracteres.");
  });
});
