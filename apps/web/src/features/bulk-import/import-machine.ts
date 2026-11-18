import { assign, fromPromise, setup } from "xstate";

export type ImportRow = {
  record: number;
  name: string;
  department: string;
} & ({ kind: "valid" } | { kind: "invalid"; issue: string });

export const maxImportedPeople = 500;

type ImportContext = {
  file: File | null;
  rows: ImportRow[];
  error: string;
};

type ImportEvent =
  | { type: "select"; file: File }
  | { type: "review" }
  | { type: "remove" }
  | { type: "back" }
  | { type: "confirm" }
  | { type: "reset" };

const initialContext: ImportContext = { file: null, rows: [], error: "" };

const readPeople = fromPromise<ImportRow[], File | null>(async ({ input: file }) => {
  if (!file || !file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("Selecione um arquivo CSV.");
  }

  if (file.size > 1_000_000) {
    throw new Error("O arquivo deve ter até 1 MB.");
  }

  const content = await file
    .arrayBuffer()
    .then((bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    .catch(() => {
      throw new Error("Não foi possível ler o arquivo. Salve o CSV em UTF-8 e tente novamente.");
    });

  const [headerLine] = content.trimStart().split(/\r\n|\n|\r/, 1);
  const records: string[][] = [];
  let invalidCsv = false;

  const { default: Papa } = await import("papaparse");

  Papa.parse<string[]>(content, {
    delimiter: headerLine?.includes(";") ? ";" : ",",
    skipEmptyLines: true,
    step({ data, errors }, parser) {
      invalidCsv ||= errors.length > 0;

      if (data.length === 1 && data[0]?.trim() === "") {
        return;
      }

      records.push(data);

      if (records.length > maxImportedPeople + 1) {
        parser.abort();
      }
    },
  });

  const [header, ...rows] = records;
  const columns = header?.map((column) => column.trim().toLowerCase());

  if (columns?.length !== 2 || columns[0] !== "nome" || columns[1] !== "departamento") {
    throw new Error("A primeira linha do CSV precisa ter as colunas nome e departamento.");
  }

  if (rows.length > maxImportedPeople) {
    throw new Error(`Divida a planilha em arquivos de até ${maxImportedPeople} pessoas.`);
  }

  if (invalidCsv) {
    throw new Error("Não foi possível ler o CSV. Verifique os separadores e as aspas.");
  }

  if (rows.length === 0) {
    throw new Error("Inclua ao menos uma pessoa no arquivo.");
  }

  return rows.map<ImportRow>((row, index) => {
    const [name = "", department = ""] = row.map((cell) => cell.trim());
    const record = index + 1;

    if (row.length !== 2) {
      return {
        kind: "invalid",
        record,
        name,
        department,
        issue: "Use somente as colunas nome e departamento.",
      };
    }

    if (!name || !department) {
      const missing = [name ? "" : "o nome", department ? "" : "o departamento"].filter(Boolean);

      return {
        kind: "invalid",
        record,
        name,
        department,
        issue: `Preencha ${missing.join(" e ")}.`,
      };
    }

    return { kind: "valid", record, name, department };
  });
});

export const bulkImport = setup<ImportContext, ImportEvent, { readPeople: typeof readPeople }>({
  actors: { readPeople },
}).createMachine({
  initial: "select",
  context: initialContext,
  on: {
    select: {
      target: ".reading",
      reenter: true,
      actions: assign(({ event }) => ({ file: event.file, rows: [], error: "" })),
    },
  },
  states: {
    select: {
      on: {
        review: {
          guard: ({ context }) => context.rows.length > 0,
          target: "review",
        },
        remove: { actions: assign(initialContext) },
      },
    },
    reading: {
      on: {
        remove: { target: "select", actions: assign(initialContext) },
      },
      invoke: {
        src: "readPeople",
        input: ({ context }) => context.file,
        onDone: {
          target: "review",
          actions: assign({ rows: ({ event }) => event.output }),
        },
        onError: {
          target: "select",
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : "Não foi possível ler o arquivo. Selecione outro CSV.",
          }),
        },
      },
    },
    review: {
      on: {
        back: "select",
        confirm: {
          guard: ({ context }) =>
            context.rows.length > 0 && context.rows.every((row) => row.kind === "valid"),
          target: "complete",
        },
      },
    },
    complete: {
      on: {
        reset: {
          target: "select",
          actions: assign(initialContext),
        },
      },
    },
  },
});
