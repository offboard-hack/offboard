import { describe, expect, it } from "vitest";
import { brazilState, mentionsBrazil, parseLocation, workModelFrom } from "./normalize.js";

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

  it("reads the first Brazilian place of a multi-location text", () => {
    expect(parseLocation("Lisbon, Portugal; São Paulo, Brazil")).toEqual({
      city: null,
      state: "SP",
      inBrazil: true,
    });
    expect(parseLocation("Lisbon, Portugal | Recife, Pernambuco")).toEqual({
      city: "Recife",
      state: "PE",
      inBrazil: true,
    });
    expect(parseLocation("Lisbon, Portugal; Austin, TX")).toEqual({
      city: null,
      state: null,
      inBrazil: false,
    });
  });

  it.each([
    ["Remoto"],
    ["remota"],
    ["Híbrido"],
    ["HIBRIDO"],
    ["Presencial"],
    [" - Remoto. "],
    ["(híbrido)"],
  ])("counts the work-model location %s as Brazil", (text) => {
    expect(parseLocation(text)).toEqual({ city: null, state: null, inBrazil: true });
  });

  it.each([["Remote"], ["Hybrid"], ["Remoto, Lisboa, Portugal"], ["Remotos"]])(
    "does not count %s as a Brazilian work-model location",
    (text) => {
      expect(parseLocation(text)).toEqual({ city: null, state: null, inBrazil: false });
    },
  );

  it("trusts a UF code only next to a Brazilian city or a mention of Brazil", () => {
    expect(parseLocation("Campinas, SP")).toEqual({
      city: "Campinas",
      state: "SP",
      inBrazil: true,
    });
    expect(parseLocation("Belém - PA")).toEqual({ city: "Belém", state: "PA", inBrazil: true });
    expect(parseLocation("Joinville, SC")).toEqual({
      city: "Joinville",
      state: "SC",
      inBrazil: true,
    });
    expect(parseLocation("PA, Brasil")).toEqual({ city: null, state: "PA", inBrazil: true });
    expect(parseLocation("Remote - SC, BR")).toEqual({ city: null, state: "SC", inBrazil: true });
    expect(parseLocation("Campinas - sp")).toEqual({ city: null, state: "SP", inBrazil: true });
  });

  it.each([
    ["Remote - PA"],
    ["Remote - SC"],
    ["Remote - MA"],
    ["Remote - AL"],
    ["Remote - MT"],
    ["Remote - CA"],
    ["PA"],
    ["Remote, PA"],
    ["Remote - United States"],
    ["Anywhere"],
    ["Global"],
    ["Remote - Global"],
    ["LATAM"],
    ["Latin America"],
    ["Remote - LATAM"],
    ["Remote, Latin America"],
    ["Mexico City, Mexico"],
  ])("rejects %s", (text) => {
    expect(parseLocation(text)).toEqual({ city: null, state: null, inBrazil: false });
  });

  it.each([
    ["Remote - LATAM, Brazil"],
    ["Latin America (Brasil)"],
    ["Remote - BR"],
    ["BR"],
    ["Curitiba, br"],
  ])("accepts %s because Brazil is named", (text) => {
    expect(parseLocation(text).inBrazil).toBe(true);
  });

  it.each([
    ["Salvador", "BA"],
    ["Goiânia", "GO"],
    ["Santo André", "SP"],
    ["Joao Pessoa", "PB"],
    ["Palmas", "TO"],
    ["Boa Vista", "RR"],
    ["Natal", "RN"],
  ])("places the Brazilian city %s in %s", (text, state) => {
    expect(parseLocation(text)).toEqual({ city: null, state, inBrazil: true });
  });

  it("does not take a Brazilian city name inside a foreign place", () => {
    expect(parseLocation("San Salvador, El Salvador")).toEqual({
      city: null,
      state: null,
      inBrazil: false,
    });
  });

  it.each([["Home office"], ["HOME OFFICE"], ["(home office)"]])(
    "counts %s as a Portuguese work-model location",
    (text) => {
      expect(parseLocation(text)).toEqual({ city: null, state: null, inBrazil: true });
    },
  );
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

describe("mentionsBrazil", () => {
  it.each([["Brazil"], ["BRASIL"], ["São Paulo, BR"], ["Remote - BR"]])("detects %s", (text) => {
    expect(mentionsBrazil(text)).toBe(true);
  });

  it.each([["Bruges"], ["br"], ["Remote"], ["Brno"]])("ignores %s", (text) => {
    expect(mentionsBrazil(text)).toBe(false);
  });
});
