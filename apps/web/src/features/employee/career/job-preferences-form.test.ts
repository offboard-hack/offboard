import { describe, expect, it } from "vitest";
import { jobChanges, jobDraft, jobProblems, salaryCents } from "./job-preferences-form";

const empty = {
  targetTitles: [],
  jobPreferences: {
    workModels: [],
    locations: [],
    relocate: false,
    salaryFloorCents: null,
    seniorities: [],
    excludedCompanies: [],
  },
};

const stored = {
  targetTitles: ["Engenheiro de Software", "Platform Engineer"],
  jobPreferences: {
    workModels: ["hybrid", "remote"] satisfies ("remote" | "hybrid" | "onsite")[],
    locations: [
      { city: "Porto Alegre", state: "RS" },
      { city: null, state: "SC" },
    ],
    relocate: false,
    salaryFloorCents: 1_250_050,
    seniorities: [],
    excludedCompanies: ["Acme"],
  },
};

describe("drafts the job preferences", () => {
  it("shows lists one per line and the salary in reais", () => {
    expect(jobDraft(stored)).toEqual({
      titles: "Engenheiro de Software\nPlatform Engineer",
      workModels: ["hybrid", "remote"],
      places: [
        { state: "RS", city: "Porto Alegre" },
        { state: "SC", city: "" },
      ],
      relocate: false,
      salaryFloor: "12.500,50",
      excluded: "Acme",
    });
    expect(
      jobDraft({
        ...stored,
        jobPreferences: { ...stored.jobPreferences, salaryFloorCents: 800_000 },
      }).salaryFloor,
    ).toBe("8.000");
    expect(jobDraft(empty).salaryFloor).toBe("");
  });
});

describe("reads a salary", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["8000", 800_000],
    ["8.000", 800_000],
    ["R$ 12.500,5", 1_250_050],
    ["1.234.567,89", 123_456_789],
    ["8,000", undefined],
    ["oito mil", undefined],
    ["21.474.837", undefined],
  ])("%s → %s", (text, cents) => {
    expect(salaryCents(text)).toBe(cents);
  });
});

describe("sends only what changed", () => {
  it("sends nothing for an untouched draft, even with work models reordered", () => {
    const draft = { ...jobDraft(stored), workModels: ["remote" as const, "hybrid" as const] };

    expect(jobChanges(stored, draft)).toEqual({});
    expect(jobChanges(empty, jobDraft(empty))).toEqual({});
  });

  it("sends each edited part normalized", () => {
    const draft = {
      titles: "Platform Engineer\n\n  SRE \nsre",
      workModels: ["onsite" as const, "remote" as const],
      places: [
        { state: "rs", city: " Campo Bom " },
        { state: " ", city: "" },
      ],
      relocate: true,
      salaryFloor: "",
      excluded: "Acme\n Beta \nacme",
    };

    expect(jobChanges(stored, draft)).toEqual({
      targetTitles: ["Platform Engineer", "SRE"],
      jobPreferences: {
        workModels: ["remote", "onsite"],
        locations: [{ city: "Campo Bom", state: "RS" }],
        relocate: true,
        salaryFloorCents: null,
        excludedCompanies: ["Acme", "Beta"],
      },
    });
  });

  it("sends the titles alone when only they changed", () => {
    expect(jobChanges(empty, { ...jobDraft(empty), titles: "SRE" })).toEqual({
      targetTitles: ["SRE"],
    });
  });
});

describe("checks the fields like the server does", () => {
  const ok = { titles: undefined, places: undefined, salaryFloor: undefined, excluded: undefined };

  it("accepts a valid draft", () => {
    expect(jobProblems(jobDraft(stored))).toEqual(ok);
  });

  it("limits titles, places and companies", () => {
    const many = (count: number, text: string) =>
      Array.from({ length: count }, (_, index) => `${text} ${index}`).join("\n");

    const places = Array.from({ length: 21 }, () => ({ state: "SP", city: "" }));

    expect(
      jobProblems({
        ...jobDraft(empty),
        titles: many(21, "Cargo"),
        places,
        salaryFloor: "muito",
        excluded: many(51, "Empresa"),
      }),
    ).toEqual({
      titles: "Use até 20 cargos.",
      places: "Use até 20 locais.",
      salaryFloor: "Use um valor como 8.000.",
      excluded: "Use até 50 empresas.",
    });
  });

  it("checks each title, place and company", () => {
    expect(
      jobProblems({
        ...jobDraft(empty),
        titles: "X",
        places: [{ state: "XX", city: "" }],
        excluded: "E".repeat(201),
      }),
    ).toEqual({
      ...ok,
      titles: "Cada cargo deve ter de 2 a 100 caracteres.",
      places: "Use a sigla do estado, como RS.",
      excluded: "O nome da empresa está longo demais.",
    });
    expect(
      jobProblems({ ...jobDraft(empty), places: [{ state: "SP", city: "C".repeat(101) }] }).places,
    ).toBe("O nome da cidade está longo demais.");
    expect(jobProblems({ ...jobDraft(empty), titles: "T".repeat(101) }).titles).toBe(
      "Cada cargo deve ter de 2 a 100 caracteres.",
    );
  });
});
