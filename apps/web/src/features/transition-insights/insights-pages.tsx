import { Alert02Icon, Calendar03Icon, Tick02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { useSuspenseQuery } from "@tanstack/react-query";
import { exitSurveyAggregatesQuery } from "@/entities/exit-survey";
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
  stageValue: "text-lg font-semibold tabular-nums",
  track: "col-span-2 h-1.5 overflow-hidden bg-muted",
  bar: "h-full bg-primary",
  outcomeValue: "text-xl font-semibold text-primary",
  feedback: "grid gap-3 rounded-2xl border bg-card p-4 sm:p-5",
  topics: "mt-2 grid max-w-3xl gap-3",
  topic: "grid grid-cols-[minmax(0,1fr)_minmax(1rem,1fr)_auto] items-center gap-2 text-sm",
  topicTrack: "col-auto",
  topicValue: "text-right font-medium tabular-nums",
  placement: "grid gap-3 self-start rounded-2xl border bg-card p-4 sm:p-5",
  placementCopy: "text-sm text-muted-foreground",
};

function formatNps(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function FeedbackPage() {
  const { data } = useSuspenseQuery(exitSurveyAggregatesQuery);
  const { totalResponses, averageNps, nps, completionRate, activationsByMonth, topTopics } = data;

  const feedbackMetrics: ListMetric[] = [
    { label: "Respostas", value: String(totalResponses), icon: UserGroupIcon, tone: "primary" },
    { label: "Taxa de resposta", value: `${completionRate}%`, icon: Tick02Icon, tone: "success" },
    {
      label: "Nota média",
      value: averageNps.toLocaleString("pt-BR"),
      icon: Calendar03Icon,
      tone: "primary",
    },
    { label: "NPS de saída", value: formatNps(nps), icon: Alert02Icon, tone: "primary" },
  ];

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
            <BarChart
              data={activationsByMonth}
              margin={{ top: 20, bottom: 4 }}
              accessibilityLayer={false}
            >
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
            {activationsByMonth.map(({ label, value }) => (
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
          {totalResponses} respostas anônimas. Temas mais citados:
        </p>
        <ul role="list" {...classProps(styles.topics)}>
          {topTopics.map(({ label, value }) => (
            <li key={label} {...classProps(styles.topic)}>
              <span>{label}</span>
              <div {...classProps(styles.track, styles.topicTrack)} aria-hidden="true">
                <div
                  {...classProps(styles.bar)}
                  style={{ width: `${(value / totalResponses) * 100}%` }}
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
