import { describe, expect, it } from "vitest";
import { resolveImport } from "./import.ts";

const cases = [
  { id: "c1", name: "Ana Souza", email: "ana@empresa.com" },
  { id: "c2", name: "Bruno Lima", email: null },
  { id: "c3", name: "Bruno Lima", email: "bruno.l@empresa.com" },
];

function row(person: string, tag: string) {
  return { person, tag, item: "Notebook", returnMethod: "pickup" as const };
}

describe("resolveImport", () => {
  it("matches a person by e-mail or by name, ignoring case and spaces", () => {
    expect(
      resolveImport([row(" ANA@empresa.com", "T1"), row("ana souza ", "T2")], cases, new Set()),
    ).toEqual({
      problems: [],
      values: [
        { caseId: "c1", tag: "T1", item: "Notebook", returnMethod: "pickup" },
        { caseId: "c1", tag: "T2", item: "Notebook", returnMethod: "pickup" },
      ],
    });
  });

  it("reports every problem by record", () => {
    const rows = [
      row("ninguém", "T1"),
      row("Bruno Lima", "T2"),
      row("bruno.l@empresa.com", "USED"),
      row("Ana Souza", "T4"),
      row("Ana Souza", "T4"),
    ];

    expect(resolveImport(rows, cases, new Set(["USED"])).problems).toEqual([
      { record: 1, problem: "unknown-person" },
      { record: 2, problem: "ambiguous-person" },
      { record: 3, problem: "tag-in-use" },
      { record: 5, problem: "repeated-tag" },
    ]);
  });
});
