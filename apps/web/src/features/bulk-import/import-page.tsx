import { Button as BaseButton } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { Toggle } from "@base-ui/react/toggle";
import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useActor } from "@xstate/react";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../../shared/ui/button";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { bulkImport, maxImportedPeople } from "./import-machine";
import type { ImportRow } from "./import-machine";
import { importStyles as ui } from "./import.styles";

const stages = ["Arquivo", "Revisão", "Cadastro"];

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
    <span {...stylex.props(ui.issue)}>
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
          <span {...stylex.props(ui.mobileIssue)}>
            <RowIssue row={original} />
          </span>
        )}
      </>
    ),
  },
  { id: "role", accessorFn: ({ role }) => role || "—", header: "Cargo" },
  {
    id: "department",
    accessorFn: ({ department }) => department || "—",
    header: "Departamento",
    meta: { cellStyle: ui.department },
  },
  { id: "deadline", accessorFn: ({ deadline }) => deadline || "—", header: "Prazo" },
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
    <div {...stylex.props(ui.fileRow)}>
      <span {...stylex.props(ui.icon)}>
        <ImportMark kind="file" />
      </span>
      <span {...stylex.props(ui.fileText)}>
        <span {...stylex.props(ui.fullName)}>{file.name}</span>
        <span {...stylex.props(ui.detail)}>
          {file.size >= 1000 ? `${fileSize.format(file.size / 1000)} KB` : `${file.size} bytes`}
        </span>
      </span>
    </div>
  );
}

function ImportGuide() {
  return (
    <aside aria-labelledby="csv-guide-title" {...stylex.props(ui.guide)}>
      <h2 id="csv-guide-title" {...stylex.props(s.subheading)}>
        Estrutura do arquivo
      </h2>
      <p id="csv-format" {...stylex.props(ui.detail)}>
        Use um CSV UTF-8 de até 1 MB e {maxImportedPeople} pessoas. As colunas devem vir nesta
        ordem.
      </p>
      <pre {...stylex.props(ui.sample)}>
        <code>{"nome,cargo,departamento,prazo\nPessoa Exemplo,Analista,Marketing,2026-12-15"}</code>
      </pre>
      <a href="/modelo-desligamentos.csv" download {...stylex.props(s.button, s.secondaryButton)}>
        Baixar modelo CSV
      </a>
    </aside>
  );
}

function FileSelection({
  file,
  error,
  canReview,
  stageHeading,
  onFile,
  onBrowse,
  onRemove,
  onReview,
}: {
  file: File | null;
  error: string;
  canReview: boolean;
  stageHeading: (node: HTMLHeadingElement | null) => void;
  onFile: (file: File) => void;
  onBrowse: () => void;
  onRemove: () => void;
  onReview: () => void;
}) {
  const filePicker = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const notice = dropError || error;

  function choose(file: File) {
    setDropError("");
    onFile(file);
  }

  return (
    <section aria-labelledby="import-title" {...stylex.props(s.workSurface, ui.body)}>
      <div {...stylex.props(ui.lead)}>
        <h2 id="import-title" ref={stageHeading} tabIndex={-1} {...stylex.props(s.workHeading)}>
          Selecione uma planilha
        </h2>
        <p {...stylex.props(ui.detail)}>A validação começa assim que você escolher o CSV.</p>
      </div>
      <div
        {...stylex.props(ui.dropZone, dragging && ui.dropActive)}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);

          if (dragDepth.current === 0) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          const dropped = event.dataTransfer.files[0];

          if (dropped && event.dataTransfer.files.length === 1) {
            choose(dropped);
          } else if (event.dataTransfer.files.length > 1) {
            setDropError(
              file
                ? "Selecione um arquivo CSV por vez. O arquivo anterior continua selecionado."
                : "Selecione um arquivo CSV por vez.",
            );
          }
        }}
      >
        {file && <FileIdentity file={file} />}
        <BaseButton
          ref={filePicker}
          type="button"
          aria-describedby={notice ? "csv-format import-error" : "csv-format"}
          {...stylex.props(ui.dropTarget, file && ui.replaceTarget)}
          onClick={onBrowse}
        >
          {!file && (
            <span {...stylex.props(ui.icon, dragging && ui.activeIcon)}>
              <ImportMark kind="upload" />
            </span>
          )}
          <span {...stylex.props(ui.pickText, !file && ui.pickPrimary)}>
            {dragging ? "Solte o CSV aqui" : file ? "Trocar arquivo" : "Escolher arquivo"}
          </span>
        </BaseButton>
        {!file && !dragging && (
          <span {...stylex.props(ui.dragCopy)}>ou arraste um CSV para cá</span>
        )}
      </div>
      {notice && (
        <p id="import-error" role="alert" {...stylex.props(ui.error)}>
          {notice}
        </p>
      )}
      {file && (
        <div {...stylex.props(ui.actions)}>
          <Button
            onClick={() => {
              setDropError("");
              onRemove();
              filePicker.current?.focus();
            }}
          >
            Remover arquivo
          </Button>
          {canReview && (
            <Button variant="primary" onClick={onReview}>
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
    <section aria-labelledby="review-title" {...stylex.props(s.workSurface)}>
      <div {...stylex.props(ui.body)}>
        <div {...stylex.props(ui.lead)}>
          <h2 id="review-title" ref={stageHeading} tabIndex={-1} {...stylex.props(s.workHeading)}>
            Revise a planilha
          </h2>
          <p {...stylex.props(ui.detail)}>{file.name}</p>
        </div>
        <div {...stylex.props(ui.validateSummary)}>
          <span>
            {accepted} {accepted === 1 ? "registro válido" : "registros válidos"}
          </span>
          {invalid > 0 && (
            <span {...stylex.props(ui.issueCount)}>
              {invalid} {invalid === 1 ? "com erro" : "com erros"}
            </span>
          )}
        </div>
        {invalid > 0 && (
          <div {...stylex.props(ui.error, ui.blockingError)}>
            <p id="review-blocker">
              Corrija os registros sinalizados na planilha e selecione o CSV atualizado para
              concluir a revisão.
            </p>
            <Button onClick={onBrowse}>Trocar planilha</Button>
          </div>
        )}
        <div {...stylex.props(ui.reviewToolbar)}>
          <Input
            type="search"
            aria-label="Buscar nome ou departamento"
            placeholder="Nome ou departamento"
            value={query}
            onValueChange={setQuery}
            {...stylex.props(s.filterInput, ui.search)}
          />
          {invalid > 0 && (
            <Toggle
              pressed={onlyIssues}
              onPressedChange={setOnlyIssues}
              {...stylex.props(s.button, ui.issueToggle)}
            >
              Só com erros
            </Toggle>
          )}
          <span role="status" {...stylex.props(ui.detail)}>
            {visible.length} de {rows.length} registros
          </span>
        </div>
      </div>
      {visible.length > 0 ? (
        <div
          role="region"
          aria-label="Registros da planilha"
          tabIndex={0}
          {...stylex.props(ui.preview)}
        >
          <DataTable
            data={visible}
            columns={invalid ? columnsWithIssues : previewColumns}
            labelledBy="review-title"
            headStyle={ui.stickyHead}
            tableStyle={ui.reviewTable}
            getRowId={(row) => String(row.record)}
          />
        </div>
      ) : (
        <p {...stylex.props(ui.empty)}>Nenhum registro corresponde à busca.</p>
      )}
      {error && (
        <p role="alert" {...stylex.props(ui.error)}>
          {error}
        </p>
      )}
      <div {...stylex.props(ui.reviewFooter, ui.actions)}>
        {!invalid && <Button onClick={onBack}>Voltar ao arquivo</Button>}
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={invalid > 0}
          aria-describedby={invalid ? "review-blocker" : undefined}
        >
          Confirmar cadastro
        </Button>
      </div>
    </section>
  );
}

export function ImportPage({ returnLink }: { returnLink: ReactNode }) {
  const queryClient = useQueryClient();

  const [machine] = useState(() =>
    bulkImport.provide({
      actions: {
        invalidateOffboardings: () => {
          void queryClient.invalidateQueries({ queryKey: ["offboardings"] });
        },
      },
    }),
  );

  const [state, send] = useActor(machine);
  const { file, rows, error } = state.context;
  const step = state.value;
  const stageIndex = step === "complete" || step === "submitting" ? 2 : step === "review" ? 1 : 0;
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
      <div {...stylex.props(s.backLinkRow)}>{returnLink}</div>
      <header {...stylex.props(s.pageHeader, ui.header)}>
        <div>
          <h1 id="titulo-pagina" tabIndex={-1} {...stylex.props(s.heading)}>
            Cadastro em massa
          </h1>
          <p {...stylex.props(s.description)}>Valide um CSV e confira os registros na prévia.</p>
        </div>
      </header>
      <ol aria-label="Etapas do cadastro em massa" role="list" {...stylex.props(ui.steps)}>
        {stages.map((label, index) => (
          <li
            key={label}
            aria-current={index === stageIndex ? "step" : undefined}
            {...stylex.props(ui.step, index === stageIndex && ui.currentStep)}
          >
            <span
              aria-hidden="true"
              {...stylex.props(
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
      {step === "select" && (
        <div {...stylex.props(ui.flow)}>
          <FileSelection
            file={file}
            error={error}
            canReview={rows.length > 0}
            stageHeading={stageHeading}
            onBrowse={openFilePicker}
            onFile={(selected) => send({ type: "select", file: selected })}
            onRemove={() => send({ type: "remove" })}
            onReview={() => send({ type: "review" })}
          />
          <ImportGuide />
        </div>
      )}
      {step === "reading" && (
        <section aria-labelledby="reading-title" {...stylex.props(s.workSurface, ui.body)}>
          <div role="status" {...stylex.props(ui.lead)}>
            <h2
              id="reading-title"
              ref={stageHeading}
              tabIndex={-1}
              {...stylex.props(s.workHeading)}
            >
              Validando a planilha
            </h2>
            {file && <p {...stylex.props(ui.detail)}>{file.name}</p>}
          </div>
          <div {...stylex.props(ui.actions)}>
            <Button onClick={() => send({ type: "remove" })}>Cancelar leitura</Button>
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
          onConfirm={() => send({ type: "confirm" })}
        />
      )}
      {step === "submitting" && (
        <section aria-labelledby="submitting-title" {...stylex.props(s.workSurface, ui.body)}>
          <div role="status" {...stylex.props(ui.lead)}>
            <h2
              id="submitting-title"
              ref={stageHeading}
              tabIndex={-1}
              {...stylex.props(s.workHeading)}
            >
              Cadastrando...
            </h2>
            <p {...stylex.props(ui.detail)}>
              {rows.length === 1
                ? "1 pessoa sendo cadastrada."
                : `${rows.length} pessoas sendo cadastradas.`}
            </p>
          </div>
        </section>
      )}
      {step === "complete" && (
        <section aria-labelledby="complete-title" {...stylex.props(s.workSurface, ui.body)}>
          <div role="status" {...stylex.props(ui.lead)}>
            <span {...stylex.props(ui.icon, ui.success)}>
              <ImportMark kind="ready" />
            </span>
            <h2
              id="complete-title"
              ref={stageHeading}
              tabIndex={-1}
              {...stylex.props(s.workHeading)}
            >
              Cadastro concluído
            </h2>
            <p {...stylex.props(ui.detail)}>
              {rows.length === 1 ? "1 pessoa cadastrada." : `${rows.length} pessoas cadastradas.`}
            </p>
          </div>
          <div {...stylex.props(ui.actions)}>
            <Button onClick={() => send({ type: "reset" })}>Importar outro arquivo</Button>
          </div>
        </section>
      )}
    </>
  );
}
