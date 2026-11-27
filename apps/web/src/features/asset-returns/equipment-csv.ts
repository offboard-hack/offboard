export const maxImportedEquipment = 500;

export const equipmentCsvTemplate =
  "pessoa;item;patrimonio;devolucao\nana@empresa.com;Notebook Dell Latitude 5440;AUR-0412;correios\nBruno Lima;Monitor LG 27;AUR-0413;correios\n";

type ParsedFields = { record: number; person: string; item: string; tag: string };

export type EquipmentCsvRow = ParsedFields &
  ({ kind: "valid"; returnMethod: "pickup" } | { kind: "invalid"; issue: string });

export type ImportProblem = "unknown-person" | "ambiguous-person" | "tag-in-use" | "repeated-tag";

const header = ["pessoa", "item", "patrimonio", "devolucao"];

function plain(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function checkRow(cells: string[], record: number, seen: Set<string>) {
  const cell = (index: number) => cells[index]?.trim() ?? "";
  const [person, item, tag] = [0, 1, 2].map(cell);
  const fields = { record, person, item, tag };

  const invalid = (issue: string) =>
    ({ ...fields, kind: "invalid", issue }) satisfies EquipmentCsvRow;

  if (cells.length !== header.length)
    return invalid("Use as colunas pessoa, item, patrimonio e devolucao.");

  if (!person || !item || !tag) return invalid("Preencha pessoa, item e patrimônio.");

  if ([person, item, tag].some((value) => value.length > 255))
    return invalid("Use até 255 caracteres.");

  if (/\s/.test(tag)) return invalid("O patrimônio não pode ter espaços.");

  if (seen.has(tag)) return invalid("Este patrimônio aparece mais de uma vez no arquivo.");

  seen.add(tag);

  return { ...fields, kind: "valid", returnMethod: "pickup" } satisfies EquipmentCsvRow;
}

export async function parseEquipmentCsv(content: string) {
  const [headerLine = ""] = content.trimStart().split(/\r\n|\n|\r/, 1);
  const { default: Papa } = await import("papaparse");

  const { data, errors } = Papa.parse<string[]>(content, {
    delimiter: headerLine.includes(";") ? ";" : ",",
    skipEmptyLines: "greedy",
  });

  const [columns = [], ...records] = data;

  if (columns.map(plain).join() !== header.join()) {
    return {
      error: "A primeira linha precisa ter as colunas pessoa, item, patrimonio e devolucao.",
    };
  }

  if (errors.length)
    return { error: "Não foi possível ler o CSV. Verifique os separadores e as aspas." };

  if (!records.length) return { error: "Inclua ao menos um bem no arquivo." };

  if (records.length > maxImportedEquipment) {
    return { error: `Divida a planilha em arquivos de até ${maxImportedEquipment} bens.` };
  }

  const seen = new Set<string>();

  return { rows: records.map((cells, index) => checkRow(cells, index + 1, seen)) };
}

const problems = {
  "unknown-person": "Nenhum desligamento com este nome ou e-mail.",
  "ambiguous-person": "Há mais de um desligamento com este nome. Use o e-mail da pessoa.",
  "tag-in-use": "Este patrimônio já está cadastrado em outro bem.",
  "repeated-tag": "Este patrimônio aparece mais de uma vez no arquivo.",
} satisfies Record<ImportProblem, string>;

export function withProblems(
  rows: EquipmentCsvRow[],
  found: { record: number; problem: ImportProblem }[],
) {
  const byRecord = new Map(found.map(({ record, problem }) => [record, problems[problem]]));

  return rows.map<EquipmentCsvRow>((row) => {
    const issue = byRecord.get(row.record);

    return issue
      ? {
          record: row.record,
          person: row.person,
          item: row.item,
          tag: row.tag,
          kind: "invalid",
          issue,
        }
      : row;
  });
}
