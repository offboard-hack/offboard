import { Alert02Icon, Calendar03Icon, Tick02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import type { ListMetric } from "@/shared/ui/list-page";
import { Bar, BarChart, LabelList, XAxis } from "recharts";
import { ChartContainer } from "@/shared/ui/shadcn/chart";
import { classProps } from "../../shared/lib/class-props";
import { portalStyles as s } from "../../shared/ui/surface.styles";

const styles = {
  report: "grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
  section: "grid min-w-0 content-start gap-3 rounded-2xl border bg-card p-4 sm:p-5",
  reportHeading: "text-lg font-semibold",
  rail: "grid min-w-0 content-start gap-5",
  stageLabel: "text-sm font-medium",
  stageValue: "text-lg font-semibold tabular-nums",
  track: "col-span-2 h-1.5 overflow-hidden bg-muted",
  bar: "h-full bg-primary",
  outcomes: "grid gap-3 rounded-2xl border bg-card p-4 sm:p-5",
  outcome: "flex items-baseline justify-between gap-3",
  outcomeDetail: "border-t pt-3",
  outcomeValue: "text-xl font-semibold text-primary",
  job: "grid gap-1 border-t py-2 text-sm font-medium",
  caption: "text-sm font-normal text-muted-foreground",
  privacy: "border-t py-3 text-sm text-muted-foreground",
  feedback: "grid gap-3 rounded-2xl border bg-card p-4 sm:p-5",
  topics: "mt-2 grid max-w-3xl gap-3",
  topic: "grid grid-cols-[minmax(0,1fr)_minmax(1rem,1fr)_auto] items-center gap-2 text-sm",
  topicTrack: "col-auto",
  topicValue: "text-right font-medium tabular-nums",
  placement: "grid gap-3 self-start rounded-2xl border bg-card p-4 sm:p-5",
  placementCopy: "text-sm text-muted-foreground",
};

const applicationStages: (ListMetric & { axis: string; value: number })[] = [
  {
    label: "Candidaturas assistidas",
    axis: "Candidaturas",
    value: 386,
    icon: Calendar03Icon,
    tone: "primary",
  },
  {
    label: "Com retorno da empresa",
    axis: "Retornos",
    value: 121,
    icon: UserGroupIcon,
    tone: "primary",
  },
  { label: "Entrevistas", axis: "Entrevistas", value: 64, icon: Calendar03Icon, tone: "warning" },
  { label: "Ofertas", axis: "Ofertas", value: 15, icon: Tick02Icon, tone: "success" },
];

const sharedJobs = [
  { title: "Analista de CRM", company: "Aurora" },
  { title: "Analista de conteúdo", company: "Nexo Digital" },
  { title: "Analista de dados", company: "Vértice Educação" },
];

const feedbackMetrics: ListMetric[] = [
  { label: "Ativação", value: "86%", icon: UserGroupIcon, tone: "primary" },
  { label: "Engajamento no mês", value: "77%", icon: Calendar03Icon, tone: "primary" },
  { label: "Etapas da saída concluídas", value: "68%", icon: Tick02Icon, tone: "success" },
  { label: "NPS de saída", value: "+42", icon: Alert02Icon, tone: "primary" },
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
  return (
    <ListPage
      title="Candidaturas assistidas"
      breadcrumb={<ListBreadcrumb title="Candidaturas assistidas" />}
      metrics={applicationStages}
    >
      <div {...classProps(styles.report)}>
        <section aria-labelledby="application-stages" {...classProps(styles.section)}>
          <h2 id="application-stages" {...classProps(styles.reportHeading)}>
            Do convite à oferta
          </h2>
          <p className="text-sm text-muted-foreground">Totais desde junho.</p>
          <ChartContainer className="aspect-auto h-56 w-full min-w-0" aria-hidden="true">
            <BarChart
              data={applicationStages}
              margin={{ top: 24, bottom: 4 }}
              accessibilityLayer={false}
            >
              <XAxis dataKey="axis" axisLine={false} tickLine={false} interval={0} />
              <Bar
                dataKey="value"
                fill="var(--primary)"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
                maxBarSize={56}
              >
                <LabelList dataKey="value" position="top" fill="var(--foreground)" />
              </Bar>
            </BarChart>
          </ChartContainer>
        </section>
        <div {...classProps(styles.rail)}>
          <dl {...classProps(styles.outcomes)}>
            <div {...classProps(styles.outcome)}>
              <dt {...classProps(styles.stageLabel)}>Recolocações autorizadas</dt>
              <dd {...classProps(styles.stageValue, styles.outcomeValue)}>12</dd>
            </div>
            <div {...classProps(styles.outcome, styles.outcomeDetail)}>
              <dt {...classProps(styles.stageLabel)}>Pessoas com acesso ao app</dt>
              <dd {...classProps(styles.stageValue)}>48</dd>
            </div>
          </dl>
          <section aria-labelledby="shared-jobs" {...classProps(styles.section)}>
            <h2 id="shared-jobs" {...classProps(s.subheading)}>
              Vagas compartilhadas
            </h2>
            <ul role="list">
              {sharedJobs.map(({ title, company }) => (
                <li key={title} {...classProps(styles.job)}>
                  {title}
                  <span {...classProps(styles.caption)}>{company}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <p {...classProps(styles.privacy)}>
        O RH vê somente dados agregados. Currículos, candidaturas e mensagens individuais ficam
        privados.
      </p>
    </ListPage>
  );
}

export function FeedbackPage() {
  return (
    <ListPage
      title="Resultados e feedback"
      breadcrumb={<ListBreadcrumb title="Resultados e feedback" />}
      metrics={feedbackMetrics}
    >
      <div {...classProps(styles.report)}>
        <section aria-labelledby="monthly-activations" {...classProps(styles.section)}>
          <h2 id="monthly-activations" {...classProps(styles.reportHeading)}>
            Ativações por mês
          </h2>
          <ChartContainer className="aspect-auto h-48 w-full min-w-0" aria-hidden="true">
            <BarChart data={activations} margin={{ top: 20, bottom: 4 }} accessibilityLayer={false}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} />
              <Bar
                dataKey="value"
                fill="var(--primary)"
                radius={[5, 5, 0, 0]}
                isAnimationActive={false}
                maxBarSize={48}
              >
                <LabelList dataKey="value" position="top" fill="var(--foreground)" />
              </Bar>
            </BarChart>
          </ChartContainer>
          <ol className="sr-only">
            {activations.map(({ label, value }) => (
              <li key={label}>
                {label}: {value}
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="reported-placements" {...classProps(styles.placement)}>
          <h2 id="reported-placements" {...classProps(s.subheading)}>
            Recolocação informada
          </h2>
          <p {...classProps(styles.stageValue, styles.outcomeValue)}>12 pessoas</p>
          <p {...classProps(styles.placementCopy)}>
            Total baseado em relatos voluntários com autorização.
          </p>
        </section>
      </div>
      <section aria-labelledby="feedback-topics" {...classProps(styles.feedback)}>
        <h2 id="feedback-topics" {...classProps(styles.reportHeading)}>
          O que aparece nos feedbacks
        </h2>
        <p {...classProps(styles.placementCopy)}>
          {feedbackResponses} respostas anônimas. Temas mais citados:
        </p>
        <ul role="list" {...classProps(styles.topics)}>
          {feedbackTopics.map(({ label, value }) => (
            <li key={label} {...classProps(styles.topic)}>
              <span>{label}</span>
              <div {...classProps(styles.track, styles.topicTrack)} aria-hidden="true">
                <div
                  {...classProps(styles.bar)}
                  style={{ width: `${(value / feedbackResponses) * 100}%` }}
                />
              </div>
              <span {...classProps(styles.topicValue)}>{value}</span>
            </li>
          ))}
        </ul>
      </section>
    </ListPage>
  );
}
