import * as stylex from "@stylexjs/stylex";
import { Metrics, PageHeading } from "../../shared/ui/page";
import { portalStyles as s } from "../../shared/ui/surface.styles";
import { colors } from "../../shared/ui/theme.stylex";

const compact = "@media (max-width: 67rem)";
const mobile = "@media (max-width: 36rem)";

const styles = stylex.create({
  report: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1.9fr) minmax(0, 1fr)",
      [compact]: "minmax(0, 1fr)",
    },
    gap: { default: "2.5rem", [compact]: "1.75rem" },
    paddingBlockEnd: "1.75rem",
  },
  section: { display: "grid", alignContent: "start", gap: "0.75rem" },
  reportHeading: {
    fontSize: "1.375rem",
    fontWeight: 680,
    letterSpacing: "-0.025em",
    lineHeight: 1.25,
  },
  rail: { display: "grid", alignContent: "start", gap: "1.5rem", minWidth: 0 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  stages: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colors.border,
  },
  stage: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "baseline",
    columnGap: "1rem",
    rowGap: "0.5rem",
    paddingBlock: { default: "0.875rem", [mobile]: "0.625rem" },
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
  },
  stageLabel: { fontSize: "0.875rem", fontWeight: 560 },
  stageValue: {
    color: colors.ink,
    fontSize: "1.375rem",
    lineHeight: 1,
    fontWeight: 680,
    fontVariantNumeric: "tabular-nums",
  },
  track: {
    gridColumn: "1 / -1",
    backgroundColor: colors.wash,
    height: "0.4375rem",
    borderRadius: "1rem",
    overflow: "hidden",
  },
  bar: (width: string) => ({
    width,
    height: "100%",
    borderRadius: "inherit",
    backgroundColor: colors.brand,
  }),
  outcomes: {
    display: "grid",
    gap: "0.75rem",
    padding: "1rem 1.125rem",
    backgroundColor: colors.wash,
    borderRadius: "0.75rem",
  },
  outcome: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.75rem",
  },
  outcomeDetail: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlockStart: "0.75rem",
  },
  outcomeValue: { color: colors.brandHover, fontSize: "1.75rem", letterSpacing: "-0.025em" },
  job: {
    paddingBlock: "0.625rem",
    display: "grid",
    gap: "0.125rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    fontSize: "0.875rem",
    fontWeight: 590,
  },
  caption: { color: colors.muted, fontSize: "0.8125rem", lineHeight: 1.5, fontWeight: 400 },
  privacy: {
    color: colors.muted,
    fontSize: "0.8125rem",
    lineHeight: 1.6,
    paddingBlock: "0.875rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
  },
  timeline: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: { default: "0.75rem", [mobile]: "0.4375rem" },
  },
  month: {
    display: "grid",
    gridTemplateRows: "8rem auto",
    justifyItems: "center",
    gap: "0.5rem",
    fontSize: "0.8125rem",
    color: colors.muted,
    minWidth: 0,
  },
  plot: {
    display: "flex",
    width: "100%",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "0.375rem",
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colors.border,
  },
  column: (height: string) => ({
    height,
    width: "min(100%, 3.25rem)",
    borderStartStartRadius: "0.25rem",
    borderStartEndRadius: "0.25rem",
    backgroundColor: colors.lavender,
  }),
  latestColumn: { backgroundColor: colors.brand },
  chartValue: { color: colors.ink, fontVariantNumeric: "tabular-nums", fontWeight: 650 },
  feedback: {
    display: "grid",
    gap: { default: "0.5rem", [mobile]: "0.75rem" },
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlockStart: "1.25rem",
  },
  topics: { display: "grid", gap: "0.625rem", marginBlockStart: "0.5rem", maxWidth: "48rem" },
  topic: {
    display: "grid",
    alignItems: "center",
    gridTemplateColumns: "minmax(9rem, 1fr) minmax(2rem, 1.5fr) 2ch",
    gap: "0.625rem",
    fontSize: "0.875rem",
  },
  topicTrack: { gridColumn: "auto" },
  topicValue: { textAlign: "end", fontVariantNumeric: "tabular-nums", fontWeight: 650 },
  placement: {
    display: "grid",
    alignSelf: "start",
    gap: "0.75rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
    paddingBlockStart: "0.875rem",
  },
  placementCopy: { color: colors.muted, lineHeight: 1.55, fontSize: "0.875rem" },
});

const applicationStages = [
  { label: "Candidaturas assistidas", value: 386 },
  { label: "Com retorno da empresa", value: 121 },
  { label: "Entrevistas", value: 64 },
  { label: "Ofertas", value: 15 },
];

const sharedJobs = [
  { title: "Analista de CRM", company: "Aurora" },
  { title: "Analista de conteúdo", company: "Nexo Digital" },
  { title: "Analista de dados", company: "Vértice Educação" },
];

const feedbackMetrics = [
  { label: "Ativação", value: "86%" },
  { label: "Engajamento no mês", value: "77%" },
  { label: "Etapas da saída concluídas", value: "68%" },
  { label: "NPS de saída", value: "+42" },
];

const activations = [
  { label: "Jun", value: 22 },
  { label: "Jul", value: 27 },
  { label: "Ago", value: 32 },
  { label: "Set", value: 36 },
  { label: "Out", value: 43 },
  { label: "Nov", value: 48 },
];

const feedbackResponses = 24;

const feedbackTopics = [
  { label: "Respeito na comunicação", value: 15 },
  { label: "Clareza de prazos", value: 12 },
  { label: "Devolução de equipamentos", value: 10 },
];

export function ApplicationsPage() {
  const total = applicationStages[0].value;

  return (
    <>
      <PageHeading
        title="Candidaturas assistidas"
        description="Totais da jornada de recolocação desde junho."
      />
      <div {...stylex.props(styles.report)}>
        <section aria-labelledby="application-stages" {...stylex.props(styles.section)}>
          <h2 id="application-stages" {...stylex.props(styles.reportHeading)}>
            Do convite à oferta
          </h2>
          <ol role="list" {...stylex.props(styles.list, styles.stages)}>
            {applicationStages.map(({ label, value }) => (
              <li key={label} {...stylex.props(styles.stage)}>
                <span {...stylex.props(styles.stageLabel)}>{label}</span>
                <strong {...stylex.props(styles.stageValue)}>{value}</strong>
                <div {...stylex.props(styles.track)} aria-hidden="true">
                  <div {...stylex.props(styles.bar(`${(value / total) * 100}%`))} />
                </div>
              </li>
            ))}
          </ol>
        </section>
        <div {...stylex.props(styles.rail)}>
          <dl {...stylex.props(styles.outcomes)}>
            <div {...stylex.props(styles.outcome)}>
              <dt {...stylex.props(styles.stageLabel)}>Recolocações autorizadas</dt>
              <dd {...stylex.props(styles.stageValue, styles.outcomeValue)}>12</dd>
            </div>
            <div {...stylex.props(styles.outcome, styles.outcomeDetail)}>
              <dt {...stylex.props(styles.stageLabel)}>Pessoas com acesso ao app</dt>
              <dd {...stylex.props(styles.stageValue)}>48</dd>
            </div>
          </dl>
          <section aria-labelledby="shared-jobs" {...stylex.props(styles.section)}>
            <h2 id="shared-jobs" {...stylex.props(s.subheading)}>
              Vagas compartilhadas
            </h2>
            <ul role="list" {...stylex.props(styles.list)}>
              {sharedJobs.map(({ title, company }) => (
                <li key={title} {...stylex.props(styles.job)}>
                  {title}
                  <span {...stylex.props(styles.caption)}>{company}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <p {...stylex.props(styles.privacy)}>
        O RH vê somente dados agregados. Currículos, candidaturas e mensagens individuais ficam
        privados.
      </p>
    </>
  );
}

export function FeedbackPage() {
  const max = Math.max(...activations.map(({ value }) => value));
  const latest = activations.at(-1)?.label;

  return (
    <>
      <PageHeading
        title="Cuidado que continua"
        description="Resultados e feedback agregados da jornada."
      />
      <Metrics items={feedbackMetrics} />
      <div {...stylex.props(styles.report)}>
        <section aria-labelledby="monthly-activations" {...stylex.props(styles.section)}>
          <h2 id="monthly-activations" {...stylex.props(styles.reportHeading)}>
            Ativações por mês
          </h2>
          <ol role="list" {...stylex.props(styles.list, styles.timeline)}>
            {activations.map(({ label, value }) => (
              <li key={label} {...stylex.props(styles.month)}>
                <div {...stylex.props(styles.plot)}>
                  <span {...stylex.props(styles.chartValue)}>{value}</span>
                  <div
                    {...stylex.props(
                      styles.column(`${(value / max) * 78}%`),
                      label === latest && styles.latestColumn,
                    )}
                    aria-hidden="true"
                  />
                </div>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="reported-placements" {...stylex.props(styles.placement)}>
          <h2 id="reported-placements" {...stylex.props(s.subheading)}>
            Recolocação informada
          </h2>
          <p {...stylex.props(styles.stageValue, styles.outcomeValue)}>12 pessoas</p>
          <p {...stylex.props(styles.placementCopy)}>
            Total baseado em relatos voluntários com autorização.
          </p>
        </section>
      </div>
      <section aria-labelledby="feedback-topics" {...stylex.props(styles.feedback)}>
        <h2 id="feedback-topics" {...stylex.props(styles.reportHeading)}>
          O que aparece nos feedbacks
        </h2>
        <p {...stylex.props(styles.placementCopy)}>
          {feedbackResponses} respostas anônimas. Temas mais citados:
        </p>
        <ul role="list" {...stylex.props(styles.list, styles.topics)}>
          {feedbackTopics.map(({ label, value }) => (
            <li key={label} {...stylex.props(styles.topic)}>
              <span>{label}</span>
              <div {...stylex.props(styles.track, styles.topicTrack)} aria-hidden="true">
                <div {...stylex.props(styles.bar(`${(value / feedbackResponses) * 100}%`))} />
              </div>
              <span {...stylex.props(styles.topicValue)}>{value}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
