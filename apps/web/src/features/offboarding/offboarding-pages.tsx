import { getRouteApi } from "@tanstack/react-router";
import { listPagination } from "@/shared/lib/list-pagination";
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  LaptopIcon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ListPage } from "@/shared/ui/list-page";
import type { ListMetric } from "@/shared/ui/list-page";
import { Card, CardContent, CardHeader } from "@/shared/ui/shadcn/card";
import { Avatar, AvatarFallback } from "@/shared/ui/shadcn/avatar";
import { Empty, EmptyDescription } from "@/shared/ui/shadcn/empty";
import { Badge } from "@/shared/ui/shadcn/badge";
import { classProps } from "../../shared/lib/class-props";
import { Button } from "../../shared/ui/button";
import { Input } from "@/shared/ui/shadcn/input";
import { useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import {
  caseStatusLabels,
  getCaseStatus,
  formatDeadline,
  formatExactDate,
  formatShortDeadline,
  todayAtWorkspace,
} from "../../entities/offboarding";
import type { CaseSummary, OffboardingCase, Task } from "../../entities/offboarding";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { ProgressBar } from "../../shared/ui/progress";
import { PortalFilter } from "../../shared/ui/select";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { offboardingStyles as local } from "./offboarding.styles";

import {
  equipmentStatus,
  getEquipmentStatus,
  type EquipmentReturn,
} from "@/entities/equipment-returns";

const caseStatusVariant = {
  overdue: "status-danger",
  today: "status-warning",
  upcoming: "status-success",
  complete: "status-success",
} satisfies Record<keyof typeof caseStatusLabels, ComponentProps<typeof Badge>["variant"]>;

const taskStatusStyle = {
  done: local.taskStatusDone,
  in_progress: local.taskStatusInProgress,
  todo: null,
};

const assetStatusVariant = {
  withPerson: "secondary",
  scheduled: "status-warning",
  received: "status-success",
  inventory: "status-success",
  transit: "secondary",
  failed: "status-danger",
} satisfies Record<keyof typeof equipmentStatus, ComponentProps<typeof Badge>["variant"]>;

const statusLabel = {
  done: "Concluída",
  in_progress: "Em andamento",
  todo: "A fazer",
} satisfies { [Status in Task["status"]]: string };

function searchKey(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

const route = getRouteApi("/_portal/desligamentos");

export function CasesPage({
  cases,
  department,
  status,
  team,
  onStatusChange,
  onTeamChange,
  onResetFilters,
  onNameSearchChange,
  onDepartmentChange,
  renderCaseLink,
  actions,
  breadcrumb,
  onOpenCase,
}: {
  cases: OffboardingCase[];
  department: string;
  status: string;
  team: string;
  onStatusChange: (status: string) => void;
  onTeamChange: (team: string) => void;
  onResetFilters: () => void;
  onNameSearchChange: () => void;
  onDepartmentChange: (department: string) => void;
  renderCaseLink: (offboardingCase: CaseSummary) => ReactNode;
  actions: ReactNode;
  breadcrumb: ReactNode;
  onOpenCase: (record: CaseSummary) => void;
}) {
  const navigate = route.useNavigate();

  const urlPagination = listPagination(
    route.useSearch(),
    (patch) =>
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        resetScroll: false,
      }),
  );

  const [search, setSearch] = useState("");
  const [today] = useState(todayAtWorkspace);
  const searchInput = useRef<HTMLInputElement>(null);

  const departments = [...new Set(cases.map((item) => item.department))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  const teams = [
    ...new Set([
      ...(team ? [team] : []),
      ...cases.flatMap(({ tasks }) =>
        tasks.filter(({ status }) => status !== "done").map(({ team }) => team),
      ),
    ]),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const overview: ListMetric[] = [
    {
      label: "Desligamentos",
      value: cases.length,
      icon: UserGroupIcon,
      tone: "primary",
    },
    {
      label: "Em atraso",
      value: cases.filter((item) => getCaseStatus(item, today) === "overdue").length,
      icon: Alert02Icon,
      tone: "danger",
    },
    {
      label: "No prazo",
      value: cases.filter((item) => {
        const s = getCaseStatus(item, today);

        return s === "upcoming" || s === "today";
      }).length,
      icon: Tick02Icon,
      tone: "success",
    },
  ];

  const filters = [
    {
      label: "Área",
      name: "Área do desligamento",
      value: department,
      onChange: onDepartmentChange,
      all: "Todas as áreas",
      items: departments.map((area) => ({ value: area, label: area })),
    },
    {
      label: "Situação",
      name: "Situação do desligamento",
      value: status,
      onChange: onStatusChange,
      all: "Todas as situações",
      items: Object.entries(caseStatusLabels).map(([value, label]) => ({ value, label })),
    },
    {
      label: "Pendente em",
      name: "Equipe com pendências",
      value: team,
      onChange: onTeamChange,
      all: "Todas as equipes",
      items: teams.map((team) => ({ value: team, label: team })),
    },
  ];

  const term = searchKey(search.trim());

  const matching = useMemo(
    () =>
      cases.filter(
        (item) =>
          (!department || item.department === department) &&
          (!status || getCaseStatus(item, today) === status) &&
          (!team || item.tasks.some((task) => task.team === team && task.status !== "done")) &&
          (!term || searchKey(item.name).includes(term)),
      ),
    [cases, department, status, team, term, today],
  );

  const columns = useMemo<TableColumn<OffboardingCase>[]>(
    () => [
      {
        id: "name",
        accessorFn: ({ name }) => name,
        header: "Pessoa",
        enableSorting: true,
        sortFn: "portugueseText",
        meta: { cellStyle: s.tableHeading },
        cell: ({ row }) => (
          <div className="flex min-w-36 items-center gap-2.5">
            <Avatar aria-hidden="true">
              <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                {row.original.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <div className="text-left leading-tight">
              {renderCaseLink(row.original)}
              <span className="block text-xs font-normal text-muted-foreground">
                {row.original.role}
              </span>
            </div>
          </div>
        ),
      },
      {
        id: "department",
        accessorFn: ({ department }) => department,
        header: "Área",
      },
      {
        id: "deadline",
        header: "Data de encerramento",
        cell: ({ row }) => (
          <time dateTime={row.original.deadline} title={formatDeadline(row.original.deadline)}>
            {formatShortDeadline(row.original.deadline)}
          </time>
        ),
      },
      {
        id: "progress",
        header: "Progresso",
        cell: ({ row }) => (
          <TaskProgress completed={row.original.completed} total={row.original.total} />
        ),
      },
      {
        id: "pendingTeams",
        header: "Pendente em",
        cell: ({ row }) => {
          const teams = [
            ...new Set(
              row.original.tasks.filter((task) => task.status !== "done").map((task) => task.team),
            ),
          ];

          const extraTeams = teams.slice(2);

          return teams.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              {teams.slice(0, 2).join(" · ")}
              {extraTeams.length > 0 && (
                <Badge variant="secondary" title={extraTeams.join(", ")}>
                  <span aria-hidden="true">+{extraTeams.length}</span>
                  <span className="sr-only">
                    Mais {extraTeams.length} {extraTeams.length === 1 ? "equipe" : "equipes"}:{" "}
                    {extraTeams.join(", ")}
                  </span>
                </Badge>
              )}
            </span>
          ) : (
            <span>
              <span aria-hidden="true">—</span>
              <span className="sr-only">Sem pendências</span>
            </span>
          );
        },
      },
      {
        id: "status",
        header: "Situação",
        cell: ({ row }) => {
          const status = getCaseStatus(row.original, today);

          return <Badge variant={caseStatusVariant[status]}>{caseStatusLabels[status]}</Badge>;
        },
      },
    ],
    [renderCaseLink, today],
  );

  return (
    <ListPage title="Desligamentos" breadcrumb={breadcrumb} metrics={overview}>
      <section className="min-w-0" aria-labelledby="case-list-title">
        <h2 id="case-list-title" className="sr-only">
          Pessoas em desligamento
        </h2>
        <span className="sr-only" role="status">
          {matching.length} {matching.length === 1 ? "pessoa" : "pessoas"}
        </span>
        <DataTable
          urlPagination={urlPagination}
          toolbar={
            <>
              <Input
                type="search"
                aria-label="Buscar desligamentos por nome"
                placeholder="Buscar por nome"
                value={search}
                ref={searchInput}
                onChange={(event) => {
                  setSearch(event.currentTarget.value);
                  onNameSearchChange();
                }}
                className="h-9 w-full sm:w-64"
              />
              {(search || department || status || team) && (
                <Button
                  className="h-9"
                  onClick={() => {
                    setSearch("");
                    onResetFilters();
                    searchInput.current?.focus();
                  }}
                >
                  Limpar filtros
                </Button>
              )}
            </>
          }
          toolbarEnd={actions}
          filters={filters.map(({ label, name, value, onChange, all, items }) => ({
            caption: label,
            label: name,
            value,
            onChange,
            items: [{ value: "", label: all }, ...items],
          }))}
          onRowClick={onOpenCase}
          data={matching}
          emptyText={
            cases.length
              ? "Nenhum desligamento corresponde aos filtros."
              : "Nenhum desligamento cadastrado."
          }
          columns={columns}
          labelledBy="case-list-title"
          scrollLabel="Tabela de desligamentos"
          getRowId={(record) => record.id}
          tableStyle="min-w-[44rem]"
        />
      </section>
    </ListPage>
  );
}

export function CasePage({
  offboardingCase,
  taskFilter,
  taskWritePending,
  taskWriteError,
  onTaskFilterChange,
  onTaskStatusChange,
  onSubtaskToggle,
  breadcrumb,
  employeeAccess,
  equipment,
  checklistAction,
}: {
  offboardingCase: OffboardingCase;
  taskFilter: "pending" | "done" | "";
  taskWritePending: boolean;
  taskWriteError: boolean;
  onTaskFilterChange: (filter: "pending" | "done" | "") => void;
  onTaskStatusChange?: (taskId: string, status: Task["status"]) => void;
  onSubtaskToggle?: (subtaskId: string) => void;
  breadcrumb: ReactNode;
  employeeAccess?: ReactNode;
  equipment?: EquipmentReturn[];
  checklistAction?: ReactNode;
}) {
  const { name, role, department, deadline, completed, total, tasks } = offboardingCase;
  const [today] = useState(todayAtWorkspace);
  const caseStatus = getCaseStatus(offboardingCase, today);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  function toggleExpand(taskId: string) {
    setExpandedTasks((previous) => {
      const next = new Set(previous);

      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }

      return next;
    });
  }

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
    <div className="mx-auto grid w-full max-w-[100rem] gap-5 px-3 py-4 sm:px-6 sm:py-6">
      {breadcrumb}
      <div className="grid min-w-0 items-start gap-5 md:grid-cols-[minmax(15rem,1fr)_minmax(0,2.4fr)]">
        <section aria-labelledby="titulo-pagina" className="min-w-0">
          <Card size="sm">
            <CardHeader className="justify-items-center gap-2 pb-1 text-center">
              <Avatar size="lg" className="size-16 data-[size=lg]:size-16" aria-hidden="true">
                <AvatarFallback className="bg-primary/15 text-xl font-semibold text-primary">
                  {name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <h1 id="titulo-pagina" tabIndex={-1} className="text-xl font-semibold wrap-anywhere">
                {name}
              </h1>
              <p className="text-sm text-muted-foreground">{role}</p>
            </CardHeader>
            <CardContent className="grid gap-5">
              <dl className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border bg-muted/45 p-3">
                  <dt className="text-xs text-muted-foreground">Concluídas</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{completed}</dd>
                </div>
                <div className="rounded-xl border bg-muted/45 p-3">
                  <dt className="text-xs text-muted-foreground">Pendentes</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">{total - completed}</dd>
                </div>
              </dl>
              <div className="grid gap-3">
                <h2 className="border-b pb-2 text-sm font-semibold">Dados do desligamento</h2>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">Área</dt>
                  <dd className="text-right wrap-anywhere">{department}</dd>
                  <dt className="text-muted-foreground">Data de encerramento</dt>
                  <dd className="text-right">
                    <time dateTime={deadline}>{formatDeadline(deadline)}</time>
                  </dd>
                  <dt className="text-muted-foreground">Situação</dt>
                  <dd className="text-right">
                    <Badge variant={caseStatusVariant[caseStatus]}>
                      {caseStatusLabels[caseStatus]}
                    </Badge>
                  </dd>
                </dl>
              </div>
            </CardContent>
          </Card>
          {employeeAccess}
          {equipment && equipment.length > 0 && (
            <Card size="sm">
              <CardContent className="grid gap-3">
                <h2 className="border-b pb-2 text-sm font-semibold">
                  <HugeiconsIcon
                    icon={LaptopIcon}
                    className="mr-1.5 inline-block size-4 align-text-bottom"
                    aria-hidden="true"
                  />
                  Bens vinculados
                </h2>
                <ul className="grid gap-2">
                  {equipment.map((asset) => {
                    const status = getEquipmentStatus(asset);

                    return (
                      <li
                        key={asset.code}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{asset.title}</p>
                          <p className="text-xs text-muted-foreground">{asset.code}</p>
                        </div>
                        <Badge variant={assetStatusVariant[status]} className="shrink-0 text-xs">
                          {equipmentStatus[status]}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="grid min-w-0 gap-3" aria-labelledby="checklist-title">
          {taskWriteError && (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível atualizar a tarefa. Tente novamente.
            </p>
          )}
          <p role="status" className="sr-only">
            {taskWritePending ? "Atualizando tarefa…" : ""}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border bg-muted/45 p-3 sm:px-4">
            <div className="grid gap-1">
              <h2 id="checklist-title" className="text-base font-semibold">
                Checklist de desligamento
              </h2>
              <TaskProgress completed={completed} total={total} />
            </div>
            {checklistAction}
            {tasks.length > 0 && (
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
            )}
          </div>
          <span className="sr-only" role="status">
            {visibleTasks.length}{" "}
            {visibleTasks.length === 1 ? "tarefa exibida" : "tarefas exibidas"}
          </span>
          {visibleTasks.length === 0 && (
            <Empty className="border">
              <EmptyDescription>
                {tasks.length === 0
                  ? "Nenhuma tarefa para este desligamento."
                  : "Nenhuma tarefa neste status."}
              </EmptyDescription>
            </Empty>
          )}
          {[...tasksByTeam].map(([team, teamTasks]) => (
            <section
              className="overflow-hidden rounded-2xl border bg-card"
              key={team}
              aria-label={team}
            >
              <div className="flex items-center justify-between gap-2 border-b bg-muted/35 px-4 py-3">
                <h3 className="text-sm font-semibold">{team}</h3>
                <span className="text-xs text-muted-foreground">
                  {teamTasks.length} {teamTasks.length === 1 ? "tarefa" : "tarefas"}
                </span>
              </div>
              <ul role="list" className="divide-y">
                {teamTasks.map((task) => {
                  const hasDetails = task.subtasks.length > 0 || task.description;

                  const expanded = expandedTasks.has(task.id);

                  const overdue = task.status !== "done" && !!task.dueDate && task.dueDate < today;

                  return (
                    <li key={task.id}>
                      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-2 text-left"
                          onClick={() => hasDetails && toggleExpand(task.id)}
                          aria-expanded={hasDetails ? expanded : undefined}
                        >
                          {hasDetails && (
                            <HugeiconsIcon
                              icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <span className="grid min-w-0 gap-0.5">
                            <span className="wrap-anywhere">{task.title}</span>
                            {task.dueDate && (
                              <time
                                dateTime={task.dueDate}
                                className={`text-xs ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                              >
                                {overdue ? "Atrasada · " : ""}
                                {formatExactDate(task.dueDate)}
                              </time>
                            )}
                          </span>
                        </button>
                        {onTaskStatusChange ? (
                          <button
                            type="button"
                            disabled={taskWritePending}
                            onClick={() => onTaskStatusChange(task.id, task.status)}
                            {...classProps(local.taskStatusButton)}
                          >
                            <Badge
                              variant="secondary"
                              {...classProps(local.taskStatus, taskStatusStyle[task.status])}
                              data-status={task.status}
                            >
                              {statusLabel[task.status]}
                            </Badge>
                          </button>
                        ) : (
                          <Badge
                            variant="secondary"
                            {...classProps(local.taskStatus, taskStatusStyle[task.status])}
                            data-status={task.status}
                          >
                            {statusLabel[task.status]}
                          </Badge>
                        )}
                      </div>
                      {hasDetails && expanded && (
                        <div className="border-t bg-muted/20 px-4 py-3 pl-10">
                          {task.subtasks.length > 0 && (
                            <ul className="grid gap-1.5">
                              {task.subtasks.map((sub) => (
                                <li key={sub.id} className="flex items-center gap-2 text-sm">
                                  {onSubtaskToggle ? (
                                    <button
                                      type="button"
                                      aria-label={`${sub.done ? "Desmarcar" : "Marcar"}: ${sub.title}`}
                                      className="flex items-center gap-2 text-left"
                                      disabled={taskWritePending}
                                      onClick={() => onSubtaskToggle(sub.id)}
                                    >
                                      <SubtaskLabel subtask={sub} />
                                    </button>
                                  ) : (
                                    <span className="flex items-center gap-2">
                                      <SubtaskLabel subtask={sub} />
                                      <span className="sr-only">
                                        {sub.done ? "Concluída" : "Pendente"}
                                      </span>
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {task.description && (
                            <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>
      </div>
    </div>
  );
}

function SubtaskLabel({ subtask: sub }: { subtask: Task["subtasks"][number] }) {
  return (
    <>
      <span
        className={`inline-block size-3.5 shrink-0 rounded-sm border ${sub.done ? "border-primary bg-primary" : "border-muted-foreground/40"}`}
        aria-hidden="true"
      >
        {sub.done && (
          <HugeiconsIcon icon={Tick02Icon} className="size-3.5 text-primary-foreground" />
        )}
      </span>
      <span className={sub.done ? "text-muted-foreground line-through" : ""}>{sub.title}</span>
    </>
  );
}

function TaskProgress({ completed, total }: { completed: number; total: number }) {
  return (
    <div {...classProps(local.taskProgress)}>
      {total > 0 && (
        <ProgressBar
          xstyle={local.progressBar}
          label="Tarefas concluídas"
          value={completed}
          max={total}
        />
      )}
      <span className="text-muted-foreground" aria-hidden={total > 0}>
        {completed}/{total}
      </span>
    </div>
  );
}
