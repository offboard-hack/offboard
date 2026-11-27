import { brazilTimezone } from "@offboard/employee";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { careerPlanQuery, useUpgradeCheckout } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { EmployeeError, EmployeePanel } from "../ui";
import { featureComparisonView, type TierFeatures } from "./benefit-features";
import {
  type CareerPlan,
  paymentReceivedNote,
  planCardView,
  planPollInterval,
  planPollTimeout,
  shouldPollPlan,
} from "./plan-card";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: brazilTimezone,
});

export function PlanSection({ account, paid }: { account: EmployeeAccount; paid: boolean }) {
  const checkout = useUpgradeCheckout(account);
  const [openedAt] = useState(() => Date.now());
  const [today] = useState(() => dayFormat.format(new Date()));

  const plan = useQuery({
    ...careerPlanQuery(account),
    refetchInterval: (query) =>
      paid && Date.now() - openedAt < planPollTimeout && shouldPollPlan(query.state.data, today)
        ? planPollInterval
        : false,
  });

  if (!plan.data) {
    return <EmployeeError message={plan.error?.message} />;
  }

  return (
    <PlanCard
      plan={plan.data}
      today={today}
      paid={paid}
      upgrading={checkout.isPending || checkout.isSuccess}
      error={checkout.error?.message}
      onUpgrade={() => checkout.mutate()}
    />
  );
}

function tierFeatureLines(tier: TierFeatures) {
  return [
    tier.score === "detailed" ? "Pontuação detalhada" : "Pontuação numérica",
    tier.aiApplyLimit > 0
      ? `${tier.aiApplyLimit} candidaturas/dia com IA`
      : "Sem candidatura com IA",
    ...(tier.aiApplyPriority ? ["Prioridade na fila"] : []),
  ];
}

function FeatureList({ title, tier }: { title: string; tier: TierFeatures }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        {tierFeatureLines(tier).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanCard({
  plan,
  today,
  paid,
  upgrading,
  error,
  onUpgrade,
}: {
  plan: CareerPlan;
  today: string;
  paid: boolean;
  upgrading: boolean;
  error?: string;
  onUpgrade: () => void;
}) {
  const view = planCardView(plan, today, paid);
  const comparison = featureComparisonView(plan.benefit);

  return (
    <EmployeePanel title="Seu plano">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{view.companyPlan}</span>
        <Badge variant={plan.company.includesAiApply ? "status-success" : "secondary"}>
          {view.aiLine}
        </Badge>
        {view.proLine ? <Badge variant="status-success">{view.proLine}</Badge> : null}
        {view.aiApplyLine ? <Badge variant="status-success">{view.aiApplyLine}</Badge> : null}
      </div>
      {view.benefitLine ? (
        <p className="text-sm text-muted-foreground">{view.benefitLine}</p>
      ) : null}
      {view.benefitExpiryWarning ? (
        <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
          {view.benefitExpiryWarning}
        </p>
      ) : null}
      {comparison ? (
        <div className="space-y-3">
          <FeatureList title={`Incluído no ${comparison.current.name}`} tier={comparison.current} />
          {comparison.next ? (
            <FeatureList title={`No ${comparison.next.name}`} tier={comparison.next} />
          ) : null}
          {comparison.copayLabel ? (
            <div>
              <Button variant="outline" disabled>
                {comparison.copayLabel} · Em breve
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {view.sponsorLine ? (
        <p className="text-sm text-muted-foreground">{view.sponsorLine}</p>
      ) : null}
      {view.paymentNote ? (
        <p role="status" className="text-sm">
          {paymentReceivedNote}
        </p>
      ) : null}
      {view.statusNote ? <p className="text-sm text-destructive">{view.statusNote}</p> : null}
      {view.upgrade === "available" ? (
        <div>
          <Button onClick={onUpgrade} disabled={upgrading}>
            {view.upgradeLabel}
          </Button>
        </div>
      ) : null}
      {view.upgrade === "unavailable" ? (
        <div>
          <Button disabled>Indisponível no momento</Button>
        </div>
      ) : null}
      <EmployeeError message={error} />
    </EmployeePanel>
  );
}
