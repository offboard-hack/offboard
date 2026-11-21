import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FileUploadIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert, AlertDescription } from "@/shared/ui/shadcn/alert";
import { offboardingsQuery } from "@/entities/offboarding";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { Empty, EmptyDescription } from "@/shared/ui/shadcn/empty";
import { classProps } from "../../shared/lib/class-props";
import { Dropzone } from "@/shared/ui/shadcn/dropzone";
import { Input } from "@/shared/ui/shadcn/input";
import { Toggle } from "@/shared/ui/shadcn/toggle";
import { useActor } from "@xstate/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../../shared/ui/button";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { bulkImport, maxImportBytes, maxImportedPeople } from "./import-machine";
import type { ImportRow } from "./import-machine";
import { importStyles as ui } from "./import.styles";

const stages = ["Arquivo", "Revisão", "Conclusão"];

const fileSelectionErrors = new Map([
  ["too-many-files", "Selecione um arquivo CSV por vez."],
  ["file-too-large", "O arquivo deve ter até 1 MB."],
  ["file-invalid-type", "Selecione um arquivo CSV."],
]);

function ImportMark({ kind }: { kind: "file" | "ready" | "upload" }) {
  const paths = {
    file: "M5 3h8l4 4v14H5zM13 3v5h4M8 12h6m-6 4h6",
    ready: "m5 12 4 4L19 6",
    upload: "M4 15v5h16v-5M12 16V4m-4 4 4-4 4 4",
  };

  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d={paths[kind]}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RowIssue({ row }: { row: Extract<ImportRow, { kind: "invalid" }> }) {
  return (
    <span {...classProps(ui.issue)}>
      Registro {row.record} · {row.issue}
    </span>
  );
}

const previewColumns: TableColumn<ImportRow>[] = [
  {
    id: "name",
    header: "Nome",
    meta: { cellStyle: s.tableHeading },
    cell: ({ row: { original } }) => (
      <>
        {original.name || "—"}
        {original.kind === "invalid" && (
          <span {...classProps(ui.mobileIssue)}>
            <RowIssue row={original} />
          </span>
        )}
      </>
    ),
  },
  {
    id: "department",
    accessorFn: ({ department }) => department || "—",
    header: "Departamento",
    meta: { cellStyle: ui.department },
  },
];

const columnsWithIssues: TableColumn<ImportRow>[] = [
  ...previewColumns,
  {
    id: "validation",
    header: "Validação",
    meta: { cellStyle: ui.desktopIssue },
    cell: ({ row: { original } }) =>
      original.kind === "invalid" ? <RowIssue row={original} /> : "Válido",
  },
];

const fileSize = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function FileIdentity({ file }: { file: File }) {
  return (
    <div {...classProps(ui.fileRow)}>
      <span {...classProps(ui.icon)}>
        <ImportMark kind="file" />
      </span>
      <span {...classProps(ui.fileText)}>
        <span {...classProps(ui.fullName)}>{file.name}</span>
        <span {...classProps(ui.detail)}>
          {file.size >= 1000 ? `${fileSize.format(file.size / 1000)} KB` : `${file.size} bytes`}
        </span>
      </span>
    </div>
  );
}

function ImportGuide({ modal }: { modal: boolean }) {
  const download = (
    <a href="/modelo-desligamentos.csv" download {...classProps(s.secondaryButton, s.button)}>
      Baixar modelo CSV
    </a>
  );

  if (modal) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p id="csv-format" className="text-sm text-muted-foreground">
          CSV em UTF-8, até {maxImportedPeople} pessoas e 1 MB.
        </p>
        {download}
      </div>
    );
  }

  return (
    <aside aria-labelledby="csv-guide-title" {...classProps(ui.guide)}>
      <h2 id="csv-guide-title" {...classProps(s.subheading)}>
        Modelo de planilha
      </h2>
      <p id="csv-format" {...classProps(ui.detail)}>
        Salve como CSV em UTF-8, com até {maxImportedPeople} pessoas e 1 MB. Use os cabeçalhos
        abaixo.
      </p>
      <pre {...classProps(ui.sample)}>
        <code>{"nome,departamento\nPessoa Exemplo,Marketing"}</code>
      </pre>
      {download}
    </aside>
  );
}

function FileSelection({
  modal,
  file,
  error,
  canReview,
  stageHeading,
  onFile,
  onRemove,
  onReview,
}: {
  modal: boolean;
  file: File | null;
  error: string;
  canReview: boolean;
  stageHeading: (node: HTMLHeadingElement | null) => void;
  onFile: (file: File) => void;
  onRemove: () => void;
  onReview: () => void;
}) {
  const filePicker = useRef<HTMLButtonElement>(null);
  const [dropError, setDropError] = useState("");
  const notice = dropError || error;

  function choose(file: File) {
    setDropError("");
    onFile(file);
  }

  return (
    <section aria-labelledby="import-title" {...classProps(s.workSurface, ui.body, "gap-4 py-0")}>
      <div className={modal ? "sr-only" : ui.lead}>
        <h2 id="import-title" ref={stageHeading} tabIndex={-1} {...classProps(s.workHeading)}>
          Arquivo CSV
        </h2>
      </div>
      {file && <FileIdentity file={file} />}
      <Dropzone
        accept={{ "text/csv": [".csv"] }}
        maxSize={maxImportBytes}
        label={file ? "Trocar arquivo" : "Escolher arquivo"}
        buttonRef={filePicker}
        describedBy={notice ? "csv-format import-error" : "csv-format"}
        onFile={choose}
        onReject={(rejections) => {
          const code = rejections[0]?.errors[0]?.code;

          setDropError(
            fileSelectionErrors.get(code ?? "") ?? "Não foi possível selecionar o arquivo.",
          );
        }}
      >
        <span className="grid size-9 place-items-center text-muted-foreground">
          <ImportMark kind="upload" />
        </span>
        <span className="text-base font-medium">Solte o CSV aqui</span>
      </Dropzone>
      {notice && (
        <Alert id="import-error" variant="destructive">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {file && (
        <div {...classProps(ui.actions)}>
          <Button
            onClick={() => {
              setDropError("");
              onRemove();
              filePicker.current?.focus();
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" aria-hidden="true" />
            Remover arquivo
          </Button>
          {canReview && (
            <Button variant="primary" onClick={onReview}>
              <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-start" aria-hidden="true" />
              Revisar arquivo
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function normalized(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function FileReview({
  file,
  rows,
  error,
  stageHeading,
  onBack,
  onBrowse,
  onConfirm,
}: {
  file: File;
  rows: ImportRow[];
  error: string;
  stageHeading: (node: HTMLHeadingElement | null) => void;
  onBack: () => void;
  onBrowse: () => void;
  onConfirm: () => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const term = normalized(query.trim());
  const invalid = rows.filter((row) => row.kind === "invalid").length;
  const accepted = rows.length - invalid;

  const visible = rows.filter(
    (row) =>
      (!onlyIssues || row.kind === "invalid") &&
      (!term || normalized(row.name).includes(term) || normalized(row.department).includes(term)),
  );

  return (
    <section aria-labelledby="review-title" {...classProps(s.workSurface)}>
      <div {...classProps(ui.body, "gap-4 pb-4")}>
        <div {...classProps(ui.lead)}>
          <h2 id="review-title" ref={stageHeading} tabIndex={-1} {...classProps(s.workHeading)}>
            Revise a planilha
          </h2>
          <p {...classProps(ui.detail)}>{file.name}</p>
        </div>
        <div {...classProps(ui.validateSummary)}>
          <span>
            {accepted} {accepted === 1 ? "registro válido" : "registros válidos"}
          </span>
          {invalid > 0 && (
            <span {...classProps(ui.issueCount)}>
              {invalid} {invalid === 1 ? "com erro" : "com erros"}
            </span>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {invalid > 0 && (
          <div {...classProps(ui.error, ui.blockingError)}>
            <p id="review-blocker">Corrija as linhas marcadas e envie o arquivo de novo.</p>
            <Button onClick={onBrowse}>
              <HugeiconsIcon icon={FileUploadIcon} data-icon="inline-start" aria-hidden="true" />
              Trocar planilha
            </Button>
          </div>
        )}
        <div {...classProps(ui.reviewToolbar)}>
          <Input
            type="search"
            aria-label="Buscar nome ou departamento"
            placeholder="Nome ou departamento"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            {...classProps(s.filterInput, ui.search)}
          />
          {invalid > 0 && (
            <Toggle
              pressed={onlyIssues}
              onPressedChange={setOnlyIssues}
              {...classProps(s.button, ui.issueToggle)}
            >
              Só com erros
            </Toggle>
          )}
          <span role="status" {...classProps(ui.detail)}>
            {visible.length} de {rows.length} registros
          </span>
        </div>
      </div>
      {visible.length > 0 ? (
        <DataTable
          appearance="embedded"
          data={visible}
          columns={invalid ? columnsWithIssues : previewColumns}
          labelledBy="review-title"
          headStyle={ui.stickyHead}
          tableStyle={ui.reviewTable}
          scrollLabel="Registros da planilha"
          scrollClassName={`${ui.preview} rounded-xl border [&_th]:bg-popover [&_td]:py-3`}
          getRowId={(row) => String(row.record)}
        />
      ) : (
        <Empty>
          <EmptyDescription>Nenhuma linha encontrada.</EmptyDescription>
        </Empty>
      )}
      <div {...classProps(ui.reviewFooter, ui.actions)}>
        {!invalid && (
          <Button onClick={onBack}>
            <HugeiconsIcon icon={ArrowLeft01Icon} data-icon="inline-start" aria-hidden="true" />
            Voltar
          </Button>
        )}
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={invalid > 0}
          aria-describedby={invalid ? "review-blocker" : undefined}
        >
          <HugeiconsIcon icon={Tick02Icon} data-icon="inline-start" aria-hidden="true" />
          Concluir revisão
        </Button>
      </div>
    </section>
  );
}

export function ImportPage({
  returnLink,
  modal = false,
}: {
  returnLink?: ReactNode;
  modal?: boolean;
}) {
  const queryClient = useQueryClient();
  const [state, send] = useActor(bulkImport);
  const { file, rows, error } = state.context;
  const step = state.value;
  const stageIndex = step === "complete" ? 2 : step === "review" ? 1 : 0;
  const previousStep = useRef(step);
  const fileInput = useRef<HTMLInputElement>(null);

  function openFilePicker() {
    fileInput.current?.click();
  }

  const stageHeading = useCallback(
    (heading: HTMLHeadingElement | null) => {
      if (heading && previousStep.current !== step) {
        previousStep.current = step;
        heading.focus();
      }
    },
    [step],
  );

  return (
    <>
      {!modal && (
        <>
          <div {...classProps(s.backLinkRow)}>{returnLink}</div>
          <header {...classProps(s.pageHeader, ui.header)}>
            <div>
              <h1 id="titulo-pagina" tabIndex={-1} {...classProps(s.heading)}>
                Cadastro em massa
              </h1>
              <p {...classProps(s.description)}>Valide um CSV e confira os registros na prévia.</p>
            </div>
          </header>
        </>
      )}
      {!modal && (
        <ol aria-label="Etapas do cadastro em massa" role="list" {...classProps(ui.steps)}>
          {stages.map((label, index) => (
            <li
              key={label}
              aria-current={index === stageIndex ? "step" : undefined}
              {...classProps(ui.step, index === stageIndex && ui.currentStep)}
            >
              <span
                aria-hidden="true"
                {...classProps(
                  ui.stepNumber,
                  index === stageIndex && ui.currentNumber,
                  index < stageIndex && ui.completedNumber,
                )}
              >
                {index < stageIndex ? <ImportMark kind="ready" /> : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      )}
      {step === "review" && (
        <input
          hidden
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            event.currentTarget.value = "";

            if (selected) {
              send({ type: "select", file: selected });
            }
          }}
        />
      )}
      {step === "select" && (
        <div {...classProps(ui.flow, modal && "gap-3 xl:grid-cols-1")}>
          <FileSelection
            modal={modal}
            file={file}
            error={error}
            canReview={rows.length > 0}
            stageHeading={stageHeading}
            onFile={(selected) => send({ type: "select", file: selected })}
            onRemove={() => send({ type: "remove" })}
            onReview={() => send({ type: "review" })}
          />
          <ImportGuide modal={modal} />
        </div>
      )}
      {step === "reading" && (
        <section aria-labelledby="reading-title" {...classProps(s.workSurface, ui.body)}>
          <div role="status" {...classProps(ui.lead)}>
            <Spinner aria-hidden="true" />
            <h2 id="reading-title" ref={stageHeading} tabIndex={-1} {...classProps(s.workHeading)}>
              Lendo o CSV…
            </h2>
            {file && <p {...classProps(ui.detail)}>{file.name}</p>}
          </div>
          <div {...classProps(ui.actions)}>
            <Button onClick={() => send({ type: "remove" })}>
              <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" aria-hidden="true" />
              Cancelar leitura
            </Button>
          </div>
        </section>
      )}
      {step === "submitting" && (
        <section aria-labelledby="submitting-title" {...classProps(s.workSurface, ui.body)}>
          <div role="status" {...classProps(ui.lead)}>
            <Spinner aria-hidden="true" />
            <h2
              id="submitting-title"
              ref={stageHeading}
              tabIndex={-1}
              {...classProps(s.workHeading)}
            >
              Importando pessoas…
            </h2>
          </div>
        </section>
      )}
      {step === "review" && file && (
        <FileReview
          file={file}
          rows={rows}
          error={error}
          stageHeading={stageHeading}
          onBack={() => send({ type: "back" })}
          onBrowse={openFilePicker}
          onConfirm={() =>
            send({
              type: "confirm",
              onImported: () =>
                void queryClient.invalidateQueries({ queryKey: offboardingsQuery.queryKey }),
            })
          }
        />
      )}
      {step === "complete" && (
        <section aria-labelledby="complete-title" {...classProps(s.workSurface, ui.body)}>
          <div role="status" {...classProps(ui.lead)}>
            <span {...classProps(ui.icon, ui.success)}>
              <ImportMark kind="ready" />
            </span>
            <h2 id="complete-title" ref={stageHeading} tabIndex={-1} {...classProps(s.workHeading)}>
              Prévia concluída
            </h2>
            <p {...classProps(ui.detail)}>
              {rows.length === 1 ? "1 pessoa revisada." : `${rows.length} pessoas revisadas.`}
            </p>
          </div>
          <div {...classProps(ui.actions)}>
            <Button onClick={() => send({ type: "reset" })}>
              <HugeiconsIcon icon={FileUploadIcon} data-icon="inline-start" aria-hidden="true" />
              Escolher outro CSV
            </Button>
          </div>
        </section>
      )}
      {!modal && (
        <p {...classProps(ui.privacy)}>Os desligamentos não são cadastrados nesta revisão.</p>
      )}
    </>
  );
}
