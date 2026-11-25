import { describe, expect, it } from "vitest";
import { brazilState, parseLocation, workModelFrom } from "./normalize.js";

describe("brazilState", () => {
  it.each([
    ["Sao Paulo", "SP"],
    ["São Paulo", "SP"],
    ["  SÃO PAULO ", "SP"],
    ["SP", "SP"],
    ["Rio de Janeiro", "RJ"],
    ["rio de janeiro", "RJ"],
    ["RJ", "RJ"],
    ["Mato Grosso", "MT"],
    ["Mato Grosso do Sul", "MS"],
    ["Espirito Santo", "ES"],
    ["Distrito Federal", "DF"],
    ["Paraná", "PR"],
    ["Pará", "PA"],
    ["Tocantins", "TO"],
  ])("maps %s to %s", (text, uf) => {
    expect(brazilState(text)).toBe(uf);
  });

  it.each([["Springfield"], ["NY"], ["sp"], ["São Paulo Area"], [""]])(
    "returns null for %s",
    (text) => {
      expect(brazilState(text)).toBeNull();
    },
  );

  it("knows all 27 federative units", () => {
    const ufs =
      "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

    expect(ufs.map((uf) => brazilState(uf))).toEqual(ufs);
  });
});

describe("parseLocation", () => {
  it.each([
    ["Sao Paulo, Sao Paulo, Brasil", { city: "Sao Paulo", state: "SP", inBrazil: true }],
    ["Brasil", { city: null, state: null, inBrazil: true }],
    ["Remote - Brazil", { city: null, state: null, inBrazil: true }],
    ["Remote to Brazil", { city: null, state: null, inBrazil: true }],
    ["São Paulo, Brasil", { city: null, state: "SP", inBrazil: true }],
    ["Bahia", { city: null, state: "BA", inBrazil: true }],
    ["Campinas - SP", { city: "Campinas", state: "SP", inBrazil: true }],
    ["Curitiba, PR, Brazil", { city: "Curitiba", state: "PR", inBrazil: true }],
    ["Curitiba/PR - Brasil", { city: "Curitiba", state: "PR", inBrazil: true }],
    ["Brasília, DF", { city: "Brasília", state: "DF", inBrazil: true }],
    ["Rio de Janeiro - Brazil", { city: null, state: "RJ", inBrazil: true }],
    ["Campo Grande, Mato Grosso do Sul", { city: "Campo Grande", state: "MS", inBrazil: true }],
    [
      "Belo Horizonte, Minas Gerais, Brazil",
      { city: "Belo Horizonte", state: "MG", inBrazil: true },
    ],
    ["Remote - São Paulo", { city: null, state: "SP", inBrazil: true }],
    ["SP, Brazil", { city: null, state: "SP", inBrazil: true }],
    [
      "Florianópolis (Hybrid), Santa Catarina",
      { city: "Florianópolis", state: "SC", inBrazil: true },
    ],
  ])("parses %s", (text, expected) => {
    expect(parseLocation(text)).toEqual(expected);
  });

  it.each([
    ["New York, NY"],
    ["Philadelphia, PA"],
    ["Atlanta, GA"],
    ["Remote to anywhere"],
    ["Madrid, ES"],
    ["Lisbon, Portugal"],
    ["Remote"],
    [""],
  ])("does not place %s in Brazil", (text) => {
    expect(parseLocation(text)).toEqual({ city: null, state: null, inBrazil: false });
  });

  it("only trusts a lowercase or unguarded UF when nothing else says Brazil", () => {
    expect(parseLocation("Campinas, SP")).toEqual({ city: null, state: null, inBrazil: false });
    expect(parseLocation("Campinas - sp")).toEqual({ city: null, state: null, inBrazil: false });
  });
});

describe("workModelFrom", () => {
  it.each([
    ["Engenheiro de Software (Remoto)", "remote"],
    ["Vaga remota", "remote"],
    ["Senior Engineer - Remote", "remote"],
    ["Analista Híbrido", "hybrid"],
    ["Analista hibrido - São Paulo", "hybrid"],
    ["Hybrid, São Paulo", "hybrid"],
    ["Híbrido, 2 dias remoto", "hybrid"],
    ["Remote or hybrid", "hybrid"],
    ["Backend Engineer", null],
    ["Remoteness expert", null],
    ["Presencial", null],
  ])("reads %s as %s", (text, model) => {
    expect(workModelFrom(text)).toBe(model);
  });
});
