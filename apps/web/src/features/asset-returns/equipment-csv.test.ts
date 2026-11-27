import { describe, expect, it } from "vitest";
import {
  equipmentCsvTemplate,
  maxImportedEquipment,
  parseEquipmentCsv,
  withProblems,
} from "./equipment-csv";

const head = "pessoa;item;patrimônio;devolução";

describe("parseEquipmentCsv", () => {
  it("reads the template", async () => {
    expect(await parseEquipmentCsv(equipmentCsvTemplate)).toEqual({
      rows: [
        {
          record: 1,
          person: "ana@empresa.com",
          item: "Notebook Dell Latitude 5440",
          tag: "AUR-0412",
          kind: "valid",
          returnMethod: "pickup",
        },
        {
          record: 2,
          person: "Bruno Lima",
          item: "Monitor LG 27",
          tag: "AUR-0413",
          kind: "valid",
          returnMethod: "in_person",
        },
      ],
    });
  });

  it("accepts commas, accents and an empty return method", async () => {
    const result = await parseEquipmentCsv(
      "Pessoa,Item,Patrimônio,Devolução\nAna,Celular,AUR-1,\n",
    );

    expect(result.rows?.[0]).toMatchObject({ kind: "valid", returnMethod: "pickup" });
  });

  it("flags each invalid row with its reason", async () => {
    const lines = [
      head,
      "Ana;Notebook",
      "Ana;;AUR-1;coleta",
      `Ana;${"x".repeat(256)};AUR-2;coleta`,
      "Ana;Notebook;AUR 3;coleta",
      "Ana;Notebook;AUR-4;correio",
      "Ana;Notebook;AUR-5;Entrega no escritório",
      "Ana;Notebook;AUR-5;coleta",
    ];

    const { rows } = await parseEquipmentCsv(lines.join("\n"));

    expect(rows?.map((row) => (row.kind === "invalid" ? row.issue : row.kind))).toEqual([
      "Use as colunas pessoa, item, patrimonio e devolucao.",
      "Preencha pessoa, item e patrimônio.",
      "Use até 255 caracteres.",
      "O patrimônio não pode ter espaços.",
      "Na devolução, use coleta ou escritorio.",
      "valid",
      "Este patrimônio aparece mais de uma vez no arquivo.",
    ]);
  });

  it("rejects a file with another header", async () => {
    expect(await parseEquipmentCsv("nome;departamento\nAna;TI\n")).toEqual({
      error: "A primeira linha precisa ter as colunas pessoa, item, patrimonio e devolucao.",
    });
    expect((await parseEquipmentCsv("")).error).toContain("primeira linha");
  });

  it("rejects broken quoting", async () => {
    expect((await parseEquipmentCsv(`${head}\n"Ana;Notebook;AUR-1;coleta\n`)).error).toContain(
      "separadores",
    );
  });

  it("rejects a file without items", async () => {
    expect((await parseEquipmentCsv(`${head}\n\n`)).error).toBe(
      "Inclua ao menos um bem no arquivo.",
    );
  });

  it("rejects a file above the limit", async () => {
    const lines = Array.from(
      { length: maxImportedEquipment + 1 },
      (_, index) => `Ana;Notebook;T-${index};`,
    );

    expect((await parseEquipmentCsv([head, ...lines].join("\n"))).error).toContain("500 bens");
  });
});

describe("withProblems", () => {
  it("marks the rows the server refused", async () => {
    const { rows = [] } = await parseEquipmentCsv(equipmentCsvTemplate);

    expect(withProblems(rows, [{ record: 2, problem: "ambiguous-person" }])).toEqual([
      rows[0],
      {
        record: 2,
        person: "Bruno Lima",
        item: "Monitor LG 27",
        tag: "AUR-0413",
        kind: "invalid",
        issue: "Há mais de um desligamento com este nome. Use o e-mail da pessoa.",
      },
    ]);
  });
});
