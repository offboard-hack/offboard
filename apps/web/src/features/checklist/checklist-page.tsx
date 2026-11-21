import * as stylex from "@stylexjs/stylex";
import { Switch } from "@base-ui/react/switch";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { checklistQuery, toggleChecklistRule } from "../../shared/api";
import { portalStyles } from "../../shared/ui/surface.styles";
import { colors, motion } from "../../shared/ui/theme.stylex";

const stacked = "@media (max-width: 52rem)";
const short = "@media (max-width: 37rem)";

const styles = stylex.create({
  metric: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlockStart: "0.625rem",
  },
  metricValue: {
    margin: "0.25rem 0 0",
    fontSize: "1.5rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  muted: { fontSize: "0.875rem", color: colors.muted, lineHeight: 1.5, margin: 0 },
  columns: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1.35fr) minmax(0, 1fr)", [stacked]: "1fr" },
    alignItems: "start",
    gap: "1rem",
  },
  panelTitle: { padding: "1rem", margin: 0 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  badge: {
    flexShrink: 0,
    borderRadius: "99px",
    padding: "0.25rem 0.625rem",
    backgroundColor: colors.lavenderSoft,
    color: colors.brand,
    fontSize: "0.75rem",
    fontWeight: 650,
  },
  deadline: {
    display: "grid",
    alignContent: "start",
    gap: "0.25rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlock: "0.5rem",
    fontSize: "0.875rem",
  },
  ruleText: {
    display: "grid",
    gap: "0.25rem",
    fontSize: "0.875rem",
  },
  ruleTiming: { color: colors.brand, fontSize: "0.75rem", fontWeight: 550 },
  switchControl: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    padding: 0,
    width: "2.75rem",
    height: "2.75rem",
    borderWidth: 0,
    borderRadius: "0.5rem",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  switchTrack: {
    display: "flex",
    alignItems: "center",
    width: "2.25rem",
    height: "1.375rem",
    borderRadius: "99px",
    backgroundColor: colors.muted,
    padding: "0.125rem",
    transitionProperty: "background-color",
    transitionDuration: motion.feedback,
  },
  switchTrackOn: { backgroundColor: colors.brand },
  switchThumb: {
    width: "1.125rem",
    height: "1.125rem",
    borderRadius: "99px",
    backgroundColor: colors.surface,
    transitionProperty: {
      default: null,
      "@media (prefers-reduced-motion: no-preference)": "transform",
    },
    transitionDuration: motion.popup,
    transitionTimingFunction: motion.easeOut,
  },
  switchThumbOn: { transform: "translateX(0.875rem)" },
  preview: { alignSelf: "start" },
  previewContent: { display: "grid", gap: "0.875rem", padding: "0 1rem 1rem" },
  previewMetrics: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", [short]: "1fr" },
    margin: 0,
    gap: "0.5rem",
  },
  timelineTitle: { fontSize: "0.875rem" },
  timeline: { display: "grid", gap: "0.375rem" },
});

export function ChecklistRulesPage() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(checklistQuery);
  const { baseRules, optionalRules } = data;

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      toggleChecklistRule(id, enabled),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: checklistQuery.queryKey });

      const previous = queryClient.getQueryData(checklistQuery.queryKey);

      queryClient.setQueryData(
        checklistQuery.queryKey,
        (current) =>
          current && {
            ...current,
            optionalRules: current.optionalRules.map((rule) =>
              rule.id === id ? { ...rule, enabled } : rule,
            ),
          },
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(checklistQuery.queryKey, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: checklistQuery.queryKey }),
  });

  const activeRules = [...baseRules, ...optionalRules.filter((rule) => rule.enabled)];
  const teamCount = new Set(activeRules.map((rule) => rule.team)).size;

  return (
    <>
      <header {...stylex.props(portalStyles.pageHeader)}>
        <div>
          <h1 id="titulo-pagina" tabIndex={-1} {...stylex.props(portalStyles.heading)}>
            Checklist automático
          </h1>
          <p {...stylex.props(portalStyles.description)}>
            Ative as regras que complementam o checklist de desligamento. As alterações são salvas
            automaticamente.
          </p>
        </div>
      </header>

      <div {...stylex.props(styles.columns)}>
        <section aria-labelledby="rules-title" {...stylex.props(portalStyles.panel)}>
          <h2 id="rules-title" {...stylex.props(portalStyles.subheading, styles.panelTitle)}>
            Regras do checklist
          </h2>
          <ul {...stylex.props(styles.list)}>
            {baseRules.map((rule) => (
              <li key={rule.id} {...stylex.props(styles.row)}>
                <div {...stylex.props(styles.ruleText)}>
                  <h3>{rule.title}</h3>
                  <p {...stylex.props(styles.muted)}>{rule.description}</p>
                  <p {...stylex.props(styles.ruleTiming)}>
                    {rule.team} · {rule.timing}
                  </p>
                </div>
                <span {...stylex.props(styles.badge)}>Obrigatória</span>
              </li>
            ))}
            {optionalRules.map((rule) => {
              const { enabled } = rule;

              return (
                <li key={rule.id} {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.ruleText)}>
                    <h3>
                      <label htmlFor={`rule-${rule.id}`}>{rule.title}</label>
                    </h3>
                    <p id={`rule-detail-${rule.id}`} {...stylex.props(styles.muted)}>
                      {rule.description}
                    </p>
                    <p {...stylex.props(styles.ruleTiming)}>
                      {rule.team} · {rule.timing}
                    </p>
                  </div>
                  <Switch.Root
                    id={`rule-${rule.id}`}
                    aria-describedby={`rule-detail-${rule.id}`}
                    checked={enabled}
                    nativeButton
                    render={<button type="button" />}
                    onCheckedChange={(checked) => {
                      toggle.mutate({ id: rule.id, enabled: checked });
                    }}
                    {...stylex.props(styles.switchControl)}
                  >
                    <span {...stylex.props(styles.switchTrack, enabled && styles.switchTrackOn)}>
                      <Switch.Thumb
                        {...stylex.props(styles.switchThumb, enabled && styles.switchThumbOn)}
                      />
                    </span>
                  </Switch.Root>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          aria-labelledby="preview-title"
          {...stylex.props(portalStyles.panel, styles.preview)}
        >
          <h2 id="preview-title" {...stylex.props(portalStyles.subheading, styles.panelTitle)}>
            Regras ativas
          </h2>
          <div {...stylex.props(styles.previewContent)}>
            <dl aria-live="polite" {...stylex.props(styles.previewMetrics)}>
              <div {...stylex.props(styles.metric)}>
                <dt {...stylex.props(styles.muted)}>Regras aplicadas</dt>
                <dd {...stylex.props(styles.metricValue)}>{activeRules.length}</dd>
              </div>
              <div {...stylex.props(styles.metric)}>
                <dt {...stylex.props(styles.muted)}>Áreas envolvidas</dt>
                <dd {...stylex.props(styles.metricValue)}>{teamCount}</dd>
              </div>
            </dl>
            <h3 {...stylex.props(styles.timelineTitle)}>Prazos do checklist</h3>
            <ul {...stylex.props(styles.list, styles.timeline)}>
              {activeRules.map((rule) => (
                <li key={rule.id} {...stylex.props(styles.deadline)}>
                  <strong>{rule.timing}</strong>
                  <span>{rule.title}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
