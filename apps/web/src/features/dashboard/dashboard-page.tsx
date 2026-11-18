import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactNode } from "react";
import { formatDeadline } from "../../entities/offboarding";
import type { OffboardingCase } from "../../entities/offboarding";
import { ProgressBar } from "../../shared/ui/progress";
import { PortalFilter } from "../../shared/ui/select";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { colors, motion, typeScale } from "../../shared/ui/theme.stylex";
import { deadlineGroups, deadlineLabels } from "./deadline";
import type { DeadlineGroup } from "./deadline";

const stacked = "@media (max-width: 66rem)";
const compact = "@media (max-width: 37rem)";

const dateAtWorkspace = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const styles = stylex.create({
  layout: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 2.2fr) minmax(0, 1fr)", [stacked]: "1fr" },
    gap: { default: "2rem", [compact]: "1.5rem" },
    alignItems: "start",
  },
  muted: { fontSize: typeScale.caption, color: colors.muted, lineHeight: 1.5 },
  list: { listStyleType: "none", padding: 0, margin: 0 },
  queueHeader: {
    padding: { default: "1.125rem 1.25rem 0.75rem", [compact]: "1rem 0.875rem 0.75rem" },
  },
  queueTitle: { paddingBlockEnd: "0.25rem" },
  filters: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
    paddingBlockStart: "0.875rem",
  },
  group: {
    display: { default: "flex", [compact]: "grid" },
    gridTemplateColumns: { default: null, [compact]: "repeat(2, minmax(0, 1fr))" },
    width: { default: "auto", [compact]: "100%" },
    flexWrap: "wrap",
    gap: "0.125rem",
    minWidth: 0,
    padding: "0.1875rem",
    borderRadius: "0.5rem",
    backgroundColor: colors.wash,
  },
  filter: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: { default: "start", [compact]: "space-between" },
    gap: "0.375rem",
    paddingInline: "0.5rem",
    minHeight: { default: "2.25rem", [compact]: "2.75rem" },
    borderWidth: 0,
    borderRadius: "0.375rem",
    color: { default: colors.muted, ":is([data-pressed])": colors.brandHover },
    backgroundColor: {
      default: "transparent",
      ":hover": colors.lavenderSoft,
      ":is([data-pressed])": colors.surface,
    },
    fontSize: typeScale.caption,
    fontWeight: 650,
    cursor: "pointer",
  },
  filterCount: { fontVariantNumeric: "tabular-nums", minWidth: "1ch" },
  queueGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 0.875rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    backgroundColor: colors.wash,
    color: colors.muted,
    fontSize: typeScale.caption,
    fontWeight: 680,
  },
  overdue: { color: colors.dangerInk, backgroundColor: colors.dangerSurface },
  today: { color: colors.warningInk, backgroundColor: colors.warningSurface },
  deadlineDot: {
    width: "0.375rem",
    height: "0.375rem",
    borderRadius: "50%",
    backgroundColor: "currentColor",
  },
  row: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
  },
  link: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 7rem 6.5rem 1rem",
      [compact]: "minmax(0, 1fr) auto 0.875rem",
    },
    alignItems: "center",
    columnGap: "0.625rem",
    rowGap: "0.1875rem",
    minHeight: "3.75rem",
    padding: "0.625rem 0.875rem",
    borderRadius: "0.25rem",
    textDecoration: "none",
    color: colors.ink,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.wash,
      ":active": colors.lavenderSoft,
    },
    outlineOffset: { default: null, ":focus-visible": "-2px" },
    transitionProperty: "background-color",
    transitionDuration: motion.feedback,
    WebkitTapHighlightColor: colors.lavenderSoft,
  },
  person: { display: "grid", gap: "0.125rem", gridColumn: 1, minWidth: 0 },
  name: { fontWeight: 670, fontSize: "0.9375rem", overflowWrap: "anywhere" },
  deadline: { gridColumn: { default: 2, [compact]: 1 }, gridRow: { default: 1, [compact]: 2 } },
  pending: {
    gridColumn: { default: 3, [compact]: 2 },
    gridRow: 1,
    textAlign: "end",
    fontSize: typeScale.caption,
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
  },
  arrow: { gridColumn: { default: 4, [compact]: 3 }, gridRow: 1, color: colors.brandHover },
  empty: {
    display: "grid",
    gap: "0.625rem",
    justifyItems: "start",
    padding: "1rem 1.25rem 1.25rem",
  },
  rail: { display: "grid", gap: "1.5rem" },
  railSection: {
    display: "grid",
    gap: "0.625rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlockStart: "0.875rem",
  },
  team: {
    display: "grid",
    width: "100%",
    gridTemplateColumns: "minmax(0, 1fr) minmax(2.5rem, 0.8fr) 2ch",
    alignItems: "center",
    gap: "0.625rem",
    minHeight: "2.75rem",
    borderWidth: 0,
    borderRadius: "0.375rem",
    paddingInline: "0.5rem",
    color: colors.ink,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.wash,
      ":is([data-pressed])": colors.lavenderSoft,
    },
    textAlign: "start",
    fontSize: typeScale.body,
    cursor: "pointer",
  },
  track: { height: "0.3125rem", borderRadius: "1rem", backgroundColor: colors.lavenderSoft },
  fill: (width: string) => ({
    display: "block",
    borderRadius: "inherit",
    width,
    height: "100%",
    backgroundColor: colors.brand,
  }),
  totals: { fontVariantNumeric: "tabular-nums", textAlign: "end" },
  progressSummary: {
    display: "flex",
    justifyContent: "space-between",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "0.4375rem",
  },
});

type DeadlineFilter = DeadlineGroup | "all";

const filters: DeadlineFilter[] = ["all", ...deadlineGroups];

export function DashboardPage({
  cases,
  areaFilter,
  deadlineFilter,
  onAreaChange,
  onDeadlineChange,
  importLink,
  renderCaseLink,
}: {
  cases: OffboardingCase[];
  areaFilter: string;
  deadlineFilter: DeadlineFilter;
  onAreaChange: (area: string) => void;
  onDeadlineChange: (deadline: DeadlineFilter) => void;
  importLink: ReactNode;
  renderCaseLink: (id: string, content: ReactNode, xstyle: stylex.StyleXStyles) => ReactNode;
}) {
  const [today] = useState(() => dateAtWorkspace.format(new Date()));
  const tasks = cases.flatMap((item) => item.tasks);
  const pending = tasks.filter((task) => task.status !== "done");
  const areaCounts = new Map<string, number>();

  for (const task of pending) {
    areaCounts.set(task.team, (areaCounts.get(task.team) ?? 0) + 1);
  }

  const areas = [...areaCounts].sort((left, right) => right[1] - left[1]);
  const largest = areas[0]?.[1] ?? 1;

  const teams = [...new Set(tasks.map((task) => task.team))].sort((left, right) =>
    left.localeCompare(right, "pt-BR"),
  );

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

  return (
    <>
      <header {...stylex.props(s.pageHeader)}>
        <div>
          <h1 id="titulo-pagina" tabIndex={-1} {...stylex.props(s.heading)}>
            Painel de desligamentos
          </h1>
          <p {...stylex.props(s.description)}>
            Veja o que vence primeiro e quem ainda tem pendências.
          </p>
        </div>
        {importLink}
      </header>
      <div {...stylex.props(styles.layout)}>
        <section aria-labelledby="attention-title" {...stylex.props(s.workSurface)}>
          <div {...stylex.props(styles.queueHeader)}>
            <h2 id="attention-title" {...stylex.props(s.workHeading, styles.queueTitle)}>
              Precisa de atenção
            </h2>
            <p role="status" {...stylex.props(styles.muted)}>
              {displayedCount} {displayedCount === 1 ? "desligamento" : "desligamentos"}
              {areaFilter ? ` em ${areaFilter}` : ""} · Por prazo
            </p>
            <div {...stylex.props(styles.filters)}>
              <ToggleGroup<DeadlineFilter>
                value={[deadlineFilter]}
                onValueChange={(value) => {
                  const next = value[0];

                  if (next) {
                    onDeadlineChange(next);
                  }
                }}
                aria-label="Prazo do desligamento"
                {...stylex.props(styles.group)}
              >
                {filters.map((filter) => (
                  <Toggle<DeadlineFilter>
                    value={filter}
                    key={filter}
                    {...stylex.props(styles.filter)}
                  >
                    {filter === "all" ? "Todos" : deadlineLabels[filter]}
                    <span {...stylex.props(styles.filterCount)}>
                      {filter === "all" ? queue.length : visibleGroups[filter].length}
                    </span>
                  </Toggle>
                ))}
              </ToggleGroup>
              <PortalFilter
                label="Área responsável"
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
                    {...stylex.props(
                      styles.queueGroup,
                      group === "overdue" && styles.overdue,
                      group === "today" && styles.today,
                    )}
                  >
                    <span aria-hidden="true" {...stylex.props(styles.deadlineDot)} />
                    {deadlineLabels[group]}
                  </h3>
                  <ul role="list" {...stylex.props(styles.list)}>
                    {records.map(({ item, count }) => (
                      <li key={item.id} {...stylex.props(styles.row)}>
                        {renderCaseLink(
                          item.id,
                          <>
                            <span {...stylex.props(styles.person)}>
                              <span {...stylex.props(styles.name)}>{item.name}</span>
                              <span {...stylex.props(styles.muted)}>{item.department}</span>
                            </span>
                            <time
                              dateTime={item.deadline}
                              {...stylex.props(styles.deadline, styles.muted)}
                            >
                              {formatDeadline(item.deadline)}
                            </time>
                            <span {...stylex.props(styles.pending)}>
                              {count} {count === 1 ? "pendência" : "pendências"}
                            </span>
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden="true"
                              {...stylex.props(styles.arrow)}
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
            <p {...stylex.props(styles.empty, styles.muted)}>
              {areaFilter || deadlineFilter !== "all"
                ? "Nenhum desligamento corresponde a estes filtros."
                : "Nenhum desligamento com tarefas pendentes."}
            </p>
          )}
        </section>
        <div {...stylex.props(styles.rail)}>
          <section aria-labelledby="progress-title" {...stylex.props(styles.railSection)}>
            <h2 id="progress-title" {...stylex.props(s.workHeading)}>
              Progresso dos desligamentos
            </h2>
            <div {...stylex.props(styles.progressSummary, styles.muted)}>
              <span>
                {completed} de {tasks.length} tarefas concluídas
              </span>
              <strong {...stylex.props(styles.totals)}>{progress}%</strong>
            </div>
            {tasks.length > 0 && (
              <ProgressBar label="Progresso das tarefas" value={completed} max={tasks.length} />
            )}
            <p {...stylex.props(styles.muted)}>
              {cases.length} desligamentos · {pending.length} pendências · {areas.length} áreas
            </p>
          </section>
          <section aria-labelledby="areas-title" {...stylex.props(styles.railSection)}>
            <h2 id="areas-title" {...stylex.props(s.workHeading)}>
              Pendências por área
            </h2>
            {areas.length > 0 ? (
              <ul role="list" {...stylex.props(styles.list)}>
                {areas.map(([area, count]) => (
                  <li key={area}>
                    <Toggle
                      pressed={areaFilter === area}
                      onPressedChange={(pressed) => onAreaChange(pressed ? area : "")}
                      {...stylex.props(styles.team)}
                    >
                      <span>{area}</span>
                      <span aria-hidden="true" {...stylex.props(styles.track)}>
                        <span {...stylex.props(styles.fill(`${(100 * count) / largest}%`))} />
                      </span>
                      <strong {...stylex.props(styles.totals)}>{count}</strong>
                    </Toggle>
                  </li>
                ))}
              </ul>
            ) : (
              <p {...stylex.props(styles.muted)}>Nenhuma área com pendências.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
