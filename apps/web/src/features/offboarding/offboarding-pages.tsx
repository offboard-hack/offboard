import * as stylex from "@stylexjs/stylex";
import { Button } from "../../shared/ui/button";
import { Input } from "@base-ui/react/input";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { formatDeadline } from "../../entities/offboarding";
import type { CaseSummary, OffboardingCase, Task } from "../../entities/offboarding";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { ProgressBar } from "../../shared/ui/progress";
import { PortalFilter } from "../../shared/ui/select";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { offboardingStyles as local } from "./offboarding.styles";

const taskStatusStyle = {
  done: local.taskStatusDone,
  inProgress: local.taskStatusInProgress,
  todo: null,
};

const statusLabel = {
  done: "Concluída",
  inProgress: "Em andamento",
  todo: "A fazer",
} satisfies { [Status in Task["status"]]: string };

function searchKey(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

export function CasesPage({
  cases,
  department,
  onDepartmentChange,
  renderCaseLink,
  importLink,
}: {
  cases: CaseSummary[];
  department: string;
  onDepartmentChange: (department: string) => void;
  renderCaseLink: (offboardingCase: CaseSummary) => ReactNode;
  importLink: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);

  const departments = [...new Set(cases.map((item) => item.department))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  const term = searchKey(search.trim());

  const matching = useMemo(
    () =>
      cases.filter(
        (item) =>
          (!department || item.department === department) &&
          (!term || searchKey(item.name).includes(term)),
      ),
    [cases, department, term],
  );

  const columns = useMemo<TableColumn<CaseSummary>[]>(
    () => [
      {
        id: "name",
        accessorFn: ({ name }) => name,
        header: "Pessoa",
        enableSorting: true,
        sortFn: "portugueseText",
        meta: { cellStyle: s.tableHeading },
        cell: ({ row }) => (
          <>
            {renderCaseLink(row.original)}
            <span {...stylex.props(s.secondaryText)}>{row.original.role}</span>
            <span {...stylex.props(s.secondaryText, local.departmentMobile)}>
              {row.original.department}
            </span>
          </>
        ),
      },
      {
        id: "department",
        accessorFn: ({ department }) => department,
        header: "Área",
        meta: { cellStyle: local.departmentColumn },
      },
      {
        id: "deadline",
        header: "Prazo",
        cell: ({ row }) => (
          <time dateTime={row.original.deadline}>{formatDeadline(row.original.deadline)}</time>
        ),
      },
      {
        id: "progress",
        header: "Tarefas",
        cell: ({ row }) => (
          <TaskProgress completed={row.original.completed} total={row.original.total} />
        ),
      },
    ],
    [renderCaseLink],
  );

  return (
    <>
      <header {...stylex.props(s.pageHeader)}>
        <div>
          <h1 {...stylex.props(s.heading)} id="titulo-pagina" tabIndex={-1}>
            Desligamentos
          </h1>
          <p {...stylex.props(s.description)}>
            Acompanhe os prazos e as tarefas de cada desligamento.
          </p>
        </div>
        {importLink}
      </header>

      <section {...stylex.props(s.panel)} aria-labelledby="case-list-title">
        <div {...stylex.props(s.panelHeader)}>
          <h2 {...stylex.props(s.subheading)} id="case-list-title">
            Pessoas em desligamento
          </h2>
          <span {...stylex.props(s.resultCount)} role="status">
            {matching.length} {matching.length === 1 ? "pessoa" : "pessoas"}
          </span>
        </div>
        {cases.length > 0 && (
          <div {...stylex.props(s.filterBar)}>
            <Input
              type="search"
              aria-label="Buscar desligamentos por nome"
              placeholder="Buscar por nome"
              value={search}
              ref={searchInput}
              onValueChange={setSearch}
              {...stylex.props(s.filterInput)}
            />
            <PortalFilter
              label="Área do desligamento"
              value={department}
              onChange={onDepartmentChange}
              items={[
                { value: "", label: "Todas as áreas" },
                ...departments.map((area) => ({ value: area, label: area })),
              ]}
            />
            {(search || department) && (
              <Button
                onClick={() => {
                  setSearch("");
                  onDepartmentChange("");
                  searchInput.current?.focus();
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>
        )}
        {cases.length === 0 ? (
          <p {...stylex.props(s.panelEmpty)}>Nenhum desligamento cadastrado.</p>
        ) : (
          <DataTable
            data={matching}
            emptyText="Nenhum desligamento corresponde aos filtros."
            columns={columns}
            labelledBy="case-list-title"
            scrollLabel="Tabela de desligamentos"
            getRowId={(record) => record.id}
            cellStyle={local.caseCell}
            rowStyle={local.caseRow}
          />
        )}
      </section>
    </>
  );
}

export function CasePage({
  offboardingCase,
  taskFilter,
  onTaskFilterChange,
  backLink,
}: {
  offboardingCase: OffboardingCase;
  taskFilter: "pending" | "done" | "";
  onTaskFilterChange: (filter: "pending" | "done" | "") => void;
  backLink: ReactNode;
}) {
  const { name, role, department, deadline, completed, total, tasks } = offboardingCase;

  const visibleTasks = tasks.filter(
    (task) =>
      taskFilter === "" ||
      (taskFilter === "done" ? task.status === "done" : task.status !== "done"),
  );

  const tasksByTeam = new Map<string, Task[]>();

  for (const task of visibleTasks) {
    const teamTasks = tasksByTeam.get(task.team);

    if (teamTasks) {
      teamTasks.push(task);
    } else {
      tasksByTeam.set(task.team, [task]);
    }
  }

  return (
    <>
      <div {...stylex.props(s.backLinkRow)}>{backLink}</div>
      <header {...stylex.props(s.pageHeader)}>
        <div>
          <h1 {...stylex.props(s.heading)} id="titulo-pagina" tabIndex={-1}>
            {name}
          </h1>
          <p {...stylex.props(s.description)}>
            {role} · {department}
          </p>
        </div>
        <dl {...stylex.props(local.deadline)}>
          <dt {...stylex.props(local.deadlineLabel)}>Prazo do desligamento</dt>
          <dd {...stylex.props(local.deadlineValue)}>
            <time dateTime={deadline}>{formatDeadline(deadline)}</time>
          </dd>
        </dl>
      </header>

      <section {...stylex.props(s.panel)} aria-labelledby="checklist-title">
        <div {...stylex.props(s.panelHeader)}>
          <h2 {...stylex.props(s.subheading)} id="checklist-title">
            Checklist de desligamento
          </h2>
          <TaskProgress completed={completed} total={total} />
        </div>
        {tasks.length > 0 && (
          <div {...stylex.props(s.filterBar)}>
            <PortalFilter
              label="Status das tarefas"
              value={taskFilter}
              onChange={(next) =>
                onTaskFilterChange(next === "pending" || next === "done" ? next : "")
              }
              items={[
                { value: "", label: `Todas as tarefas (${total})` },
                { value: "pending", label: `Pendentes (${total - completed})` },
                { value: "done", label: `Concluídas (${completed})` },
              ]}
            />
            <span {...stylex.props(s.resultCount)} role="status">
              {visibleTasks.length} {visibleTasks.length === 1 ? "tarefa" : "tarefas"}
            </span>
          </div>
        )}
        {visibleTasks.length === 0 && (
          <p {...stylex.props(s.panelEmpty)}>
            {tasks.length === 0
              ? "Nenhuma tarefa para este desligamento."
              : "Nenhuma tarefa neste status."}
          </p>
        )}
        {[...tasksByTeam].map(([team, teamTasks]) => (
          <section {...stylex.props(local.taskGroup)} key={team}>
            <h3 {...stylex.props(local.taskGroupHeading)}>{team}</h3>
            <ul {...stylex.props(local.taskList)}>
              {teamTasks.map((task) => (
                <li {...stylex.props(local.taskRow)} key={task.id}>
                  <span>{task.title}</span>
                  <span
                    {...stylex.props(local.taskStatus, taskStatusStyle[task.status])}
                    data-status={task.status}
                  >
                    {statusLabel[task.status]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </>
  );
}

function TaskProgress({ completed, total }: { completed: number; total: number }) {
  return (
    <div {...stylex.props(local.taskProgress)}>
      <span>
        {completed} de {total}
      </span>
      {total > 0 && (
        <ProgressBar
          xstyle={local.progressBar}
          label="Tarefas concluídas"
          value={completed}
          max={total}
        />
      )}
    </div>
  );
}
