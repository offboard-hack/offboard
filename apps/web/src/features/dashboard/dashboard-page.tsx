import { Bar, BarChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer } from "@/shared/ui/shadcn/chart";
import { Card } from "@/shared/ui/shadcn/card";
import { ListPage } from "@/shared/ui/list-page";
import { classProps } from "../../shared/lib/class-props";
import { Toggle } from "@/shared/ui/shadcn/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/shadcn/toggle-group";
import { useState } from "react";
import type { ReactNode } from "react";
import { formatDeadline, todayAtWorkspace } from "../../entities/offboarding";
import { caseBreakdown } from "./case-breakdown";
import type { OffboardingCase } from "../../entities/offboarding";
import { PortalFilter } from "../../shared/ui/select";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { deadlineGroups, deadlineLabels } from "./deadline";
import type { DeadlineGroup } from "./deadline";

const styles = {
  layout: "grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
  muted: "text-sm text-muted-foreground",
  queueHeader: "grid gap-1 px-4 pt-4 pb-3 sm:px-5 sm:pt-5",
  queueTitle: "pb-1",
  filters: "flex flex-wrap items-center gap-3 pt-3",
  group: "grid w-full min-w-0 grid-cols-2 gap-1 sm:flex sm:w-auto sm:flex-wrap",
  filter:
    "min-h-10 justify-between gap-2 rounded-md px-2 text-xs text-muted-foreground data-pressed:bg-accent data-pressed:text-accent-foreground",
  filterCount: "tabular-nums",
  queueGroup:
    "flex items-center gap-2 border-y bg-muted/45 px-4 py-2.5 text-sm font-semibold text-muted-foreground",
  overdue: "text-destructive",
  today: "text-foreground",
  deadlineDot: "size-1.5 rounded-full bg-current",
  row: "border-b last:border-b-0",
  link: "grid min-h-16 grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-2 gap-y-1 px-4 py-3 hover:bg-muted/45 focus-visible:outline-offset-[-2px] md:grid-cols-[minmax(0,1fr)_7rem_6rem_1rem]",
  person: "col-start-1 grid min-w-0 gap-1",
  name: "text-sm font-medium wrap-anywhere",
  deadline: "col-start-1 row-start-2 md:col-start-2 md:row-start-1",
  pending: "col-start-2 row-start-1 text-right text-xs font-medium tabular-nums md:col-start-3",
  arrow: "col-start-3 row-start-1 text-primary md:col-start-4",
  empty: "px-4 py-8",
  summary: "grid min-w-0 gap-5 sm:grid-cols-2",
  railSection: "grid gap-3 p-4 sm:p-5",
  team: "grid h-11 w-full grid-cols-[minmax(0,1fr)_1fr_2ch] items-center gap-2 px-2 text-left text-sm hover:bg-primary/5 data-pressed:bg-primary/10",
};

type DeadlineFilter = DeadlineGroup | "all";

const filters: DeadlineFilter[] = ["all", ...deadlineGroups];

export function DashboardPage({
  cases,
  areaFilter,
  deadlineFilter,
  onAreaChange,
  onDeadlineChange,
  renderCaseLink,
  emptyAction,
}: {
  cases: OffboardingCase[];
  areaFilter: string;
  deadlineFilter: DeadlineFilter;
  onAreaChange: (area: string) => void;
  onDeadlineChange: (deadline: DeadlineFilter) => void;
  renderCaseLink: (id: string, content: ReactNode, xstyle: string) => ReactNode;
  emptyAction?: ReactNode;
}) {
  const [today] = useState(todayAtWorkspace);
  const tasks = cases.flatMap((item) => item.tasks);
  const pending = tasks.filter((task) => task.status !== "done");
  const areaCounts = new Map<string, number>();

  for (const task of pending) {
    areaCounts.set(task.team, (areaCounts.get(task.team) ?? 0) + 1);
  }

  const areas = [...areaCounts].sort((left, right) => right[1] - left[1]);
  const areaSeries = areas.map(([area, count]) => ({ area, count }));

  const teams = [
    ...new Set([...(areaFilter ? [areaFilter] : []), ...pending.map((task) => task.team)]),
  ].sort((left, right) => left.localeCompare(right, "pt-BR"));

  const queue = cases
    .map((item) => ({
      item,
      count: item.tasks.filter(
        (task) => task.status !== "done" && (!areaFilter || task.team === areaFilter),
      ).length,
    }))
    .filter(({ count }) => count > 0)
    .sort(
      (left, right) =>
        left.item.deadline.localeCompare(right.item.deadline) || right.count - left.count,
    );

  const visibleGroups = {
    overdue: queue.filter(({ item }) => item.deadline < today),
    today: queue.filter(({ item }) => item.deadline === today),
    upcoming: queue.filter(({ item }) => item.deadline > today),
  };

  const displayedGroups = deadlineFilter === "all" ? deadlineGroups : [deadlineFilter];

  const displayedCount =
    deadlineFilter === "all" ? queue.length : visibleGroups[deadlineFilter].length;

  const completed = tasks.length - pending.length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  const breakdown = caseBreakdown(cases, today);

  const caseSeries = [
    { name: "Em atraso", count: breakdown.overdue, fill: "var(--chart-2)" },
    { name: "No prazo", count: breakdown.onTrack, fill: "var(--chart-1)" },
    { name: "Concluídos", count: breakdown.complete, fill: "var(--chart-3)" },
  ];

  const progressSeries = [
    { name: "Concluídas", count: completed, fill: "var(--chart-2)" },
    { name: "Pendentes", count: pending.length, fill: "var(--chart-1)" },
  ];

  return (
    <ListPage title="Painel de desligamentos">
      <div {...classProps(styles.summary)}>
        <SummaryChart
          id="cases-summary-title"
          title="Desligamentos"
          value={cases.length}
          series={caseSeries}
        />
        <SummaryChart
          id="progress-title"
          title="Progresso das tarefas"
          value={`${progress}%`}
          series={progressSeries}
        />
      </div>
      <div {...classProps(styles.layout)}>
        <Card
          size="sm"
          className="min-w-0 gap-0 py-0"
          role="region"
          aria-labelledby="attention-title"
        >
          <div {...classProps(styles.queueHeader)}>
            <h2 id="attention-title" {...classProps(s.workHeading, styles.queueTitle)}>
              Fila de desligamentos
            </h2>
            <p role="status" {...classProps(styles.muted)}>
              {displayedCount} {displayedCount === 1 ? "desligamento" : "desligamentos"}
              {areaFilter ? ` em ${areaFilter}` : ""}
            </p>
            <div {...classProps(styles.filters)}>
              <ToggleGroup
                value={[deadlineFilter]}
                onValueChange={([next]) => {
                  if (
                    next === "all" ||
                    next === "overdue" ||
                    next === "today" ||
                    next === "upcoming"
                  ) {
                    onDeadlineChange(next);
                  }
                }}
                aria-label="Data de encerramento"
                {...classProps(styles.group)}
              >
                {filters.map((filter) => (
                  <ToggleGroupItem value={filter} key={filter} {...classProps(styles.filter)}>
                    {filter === "all" ? "Todos" : deadlineLabels[filter]}
                    <span {...classProps(styles.filterCount)}>
                      {filter === "all" ? queue.length : visibleGroups[filter].length}
                    </span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <PortalFilter
                label="Área responsável"
                className="min-h-10"
                value={areaFilter}
                onChange={onAreaChange}
                items={[
                  { value: "", label: "Todas as áreas" },
                  ...teams.map((area) => ({ value: area, label: area })),
                ]}
              />
            </div>
          </div>
          {displayedGroups.map((group) => {
            const records = visibleGroups[group];

            return (
              records.length > 0 && (
                <div key={group}>
                  <h3
                    {...classProps(
                      styles.queueGroup,
                      group === "overdue" && styles.overdue,
                      group === "today" && styles.today,
                    )}
                  >
                    <span aria-hidden="true" {...classProps(styles.deadlineDot)} />
                    {deadlineLabels[group]}
                  </h3>
                  <ul role="list">
                    {records.map(({ item, count }) => (
                      <li key={item.id} {...classProps(styles.row)}>
                        {renderCaseLink(
                          item.id,
                          <>
                            <span {...classProps(styles.person)}>
                              <span {...classProps(styles.name)}>{item.name}</span>
                              <span {...classProps(styles.muted)}>{item.department}</span>
                            </span>
                            <time
                              dateTime={item.deadline}
                              {...classProps(styles.deadline, styles.muted)}
                            >
                              {formatDeadline(item.deadline)}
                            </time>
                            <span {...classProps(styles.pending)}>
                              {count} {count === 1 ? "pendência" : "pendências"}
                            </span>
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden="true"
                              {...classProps(styles.arrow)}
                            >
                              <path
                                d="m6 4 4 4-4 4"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                            </svg>
                          </>,
                          styles.link,
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            );
          })}
          {displayedCount === 0 && (
            <p {...classProps(styles.empty, styles.muted)}>
              {areaFilter || deadlineFilter !== "all"
                ? "Nenhum desligamento corresponde a estes filtros."
                : cases.length === 0
                  ? "Nenhum desligamento cadastrado ainda. "
                  : "Nenhum desligamento com tarefas pendentes."}
              {cases.length === 0 && !areaFilter && deadlineFilter === "all" && emptyAction}
            </p>
          )}
        </Card>
        <Card
          size="sm"
          role="region"
          aria-labelledby="areas-title"
          {...classProps(styles.railSection)}
        >
          <h2 id="areas-title" {...classProps(s.workHeading)}>
            Pendências por área
          </h2>
          {areas.length > 0 ? (
            <div className="relative isolate">
              <ChartContainer
                className="pointer-events-none absolute inset-y-0 right-9 left-1/2 aspect-auto"
                aria-hidden="true"
              >
                <BarChart
                  data={areaSeries}
                  layout="vertical"
                  margin={{ top: 0, bottom: 0, left: 0, right: 0 }}
                  accessibilityLayer={false}
                >
                  <XAxis type="number" hide domain={[0, areas[0]?.[1] ?? 1]} />
                  <YAxis type="category" dataKey="area" hide />
                  <Bar
                    dataKey="count"
                    barSize={8}
                    radius={4}
                    background={{ fill: "var(--muted)", radius: 4 }}
                    isAnimationActive={false}
                  >
                    {areaSeries.map(({ area }) => (
                      <Cell
                        key={area}
                        fill="var(--chart-2)"
                        fillOpacity={areaFilter && areaFilter !== area ? 0.35 : 1}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ul role="list" className="relative">
                {areaSeries.map(({ area, count }) => (
                  <li key={area}>
                    <Toggle
                      pressed={areaFilter === area}
                      onPressedChange={(pressed) => onAreaChange(pressed ? area : "")}
                      {...classProps(styles.team)}
                    >
                      <span>{area}</span>
                      <strong className="col-start-3 text-right tabular-nums">{count}</strong>
                    </Toggle>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p {...classProps(styles.muted)}>Nenhuma área com pendências.</p>
          )}
        </Card>
      </div>
    </ListPage>
  );
}

function SummaryChart({
  id,
  title,
  value,
  series,
}: {
  id: string;
  title: string;
  value: number | string;
  series: { name: string; count: number; fill: string }[];
}) {
  const hasData = series.some(({ count }) => count > 0);

  return (
    <Card size="sm" role="region" aria-labelledby={id} {...classProps(styles.railSection)}>
      <h2 id={id} {...classProps(s.workHeading)}>
        {title}
      </h2>
      <div className="flex items-center gap-4 sm:gap-5">
        <div className="relative size-24 shrink-0">
          {hasData ? (
            <ChartContainer className="size-full" aria-hidden="true">
              <PieChart accessibilityLayer={false}>
                <Pie
                  data={series}
                  dataKey="count"
                  innerRadius="72%"
                  outerRadius="94%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  isAnimationActive={false}
                />
              </PieChart>
            </ChartContainer>
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-1 rounded-full border-8 border-muted"
            />
          )}
          <strong className="absolute inset-0 grid place-items-center text-xl font-semibold tabular-nums">
            {value}
          </strong>
        </div>
        <ul role="list" className="grid min-w-0 gap-2 text-sm text-muted-foreground">
          {series.map(({ name, count, fill }) => (
            <li key={name} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: fill }}
              />
              <span>{name}</span>
              <strong className="ml-auto font-medium text-foreground tabular-nums">{count}</strong>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
