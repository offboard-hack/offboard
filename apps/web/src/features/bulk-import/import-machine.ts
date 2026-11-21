import { assign, fromPromise, setup } from "xstate";
import { bulkCreateOffboardings } from "../../shared/api";

export type ImportRow = {
  record: number;
  name: string;
  role: string;
  department: string;
  deadline: string;
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

  if (
    columns?.length !== 4 ||
    columns[0] !== "nome" ||
    columns[1] !== "cargo" ||
    columns[2] !== "departamento" ||
    columns[3] !== "prazo"
  ) {
    throw new Error(
      "A primeira linha do CSV precisa ter as colunas nome, cargo, departamento e prazo.",
    );
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
    const [name = "", role = "", department = "", deadline = ""] = row.map((cell) => cell.trim());
    const record = index + 1;
    const fields = { record, name, role, department, deadline };

    if (row.length !== 4) {
      return {
        kind: "invalid",
        ...fields,
        issue: "Use somente as colunas nome, cargo, departamento e prazo.",
      };
    }

    const missing = [
      name ? "" : "o nome",
      role ? "" : "o cargo",
      department ? "" : "o departamento",
      deadline ? "" : "o prazo",
    ].filter(Boolean);

    if (missing.length > 0) {
      return {
        kind: "invalid",
        ...fields,
        issue: `Preencha ${missing.join(", ").replace(/, ([^,]*)$/, " e $1")}.`,
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      return { kind: "invalid", ...fields, issue: "O prazo deve estar no formato AAAA-MM-DD." };
    }

    return { kind: "valid", ...fields };
  });
});

const submitPeople = fromPromise<
  { id: string }[],
  Array<{ name: string; role: string; department: string; deadline: string }>
>(async ({ input }) => bulkCreateOffboardings(input));

export const bulkImport = setup<
  ImportContext,
  ImportEvent,
  { readPeople: typeof readPeople; submitPeople: typeof submitPeople },
  {},
  { invalidateOffboardings: undefined }
>({
  actors: { readPeople, submitPeople },
  actions: { invalidateOffboardings: () => {} },
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
          target: "submitting",
          actions: assign({ error: "" }),
        },
      },
    },
    submitting: {
      invoke: {
        src: "submitPeople",
        input: ({ context }) =>
          context.rows
            .filter((row) => row.kind === "valid")
            .map(({ name, role, department, deadline }) => ({ name, role, department, deadline })),
        onDone: "complete",
        onError: {
          target: "review",
          actions: assign({
            error: ({ event }) =>
              event.error instanceof Error
                ? event.error.message
                : "Não foi possível cadastrar. Tente novamente.",
          }),
        },
      },
    },
    complete: {
      entry: "invalidateOffboardings",
      on: {
        reset: {
          target: "select",
          actions: assign(initialContext),
        },
      },
    },
  },
});
