import * as stylex from "@stylexjs/stylex";
import { portalStyles } from "./surface.styles";
import { colors } from "./theme.stylex";

type Metric = { label: string; value: string | number; detail?: string; tone?: "danger" };

const styles = stylex.create({
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr))",
    columnGap: "1.25rem",
    rowGap: "0.75rem",
  },
  metric: {
    gridColumn: {
      default: null,
      "@media (max-width: 36rem)": { default: null, ":is(:last-child:nth-child(odd))": "1 / -1" },
    },
    display: "grid",
    alignContent: "start",
    gap: "0.25rem",
    minWidth: 0,
    paddingBlockStart: "0.625rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
  },
  exception: { borderBlockStartColor: colors.dangerInk },
  exceptionText: { color: colors.dangerInk },
  metricValue: {
    color: colors.ink,
    fontSize: "1.625rem",
    fontWeight: 720,
    letterSpacing: "-0.025em",
    fontVariantNumeric: "tabular-nums",
  },
  label: {
    color: colors.muted,
    fontSize: "0.8125rem",
    lineHeight: 1.45,
  },
});

export function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <header {...stylex.props(portalStyles.pageHeader)}>
      <div>
        <h1 {...stylex.props(portalStyles.heading)} id="titulo-pagina" tabIndex={-1}>
          {title}
        </h1>
        <p {...stylex.props(portalStyles.description)}>{description}</p>
      </div>
    </header>
  );
}

export function Metrics({ items }: { items: Metric[] }) {
  return (
    <dl {...stylex.props(styles.metrics, portalStyles.metricsSpacing)}>
      {items.map(({ label, value, detail, tone }) => (
        <div {...stylex.props(styles.metric, tone === "danger" && styles.exception)} key={label}>
          <dt {...stylex.props(styles.label, tone === "danger" && styles.exceptionText)}>
            {label}
          </dt>
          <dd {...stylex.props(styles.metricValue, tone === "danger" && styles.exceptionText)}>
            {value}
          </dd>
          {detail && <dd {...stylex.props(styles.label)}>{detail}</dd>}
        </div>
      ))}
    </dl>
  );
}
