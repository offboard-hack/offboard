import { brazilTimezone } from "@offboard/employee";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  careerPlanQuery,
  useCancelCareerPro,
  useCancelCopay,
  useCopayCheckout,
  useUpgradeCheckout,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { EmployeeError, EmployeePanel } from "../ui";
import { featureComparisonView, type TierFeatures } from "./benefit-features";
import {
  type CareerPlan,
  cancelConfirmLabel,
  cancelCopayLabel,
  cancelCopayPrompt,
  copayContinueLabel,
  cancelConfirmPrompt,
  cancelKeepLabel,
  cancelProLabel,
  copayPaymentReceivedNote,
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

export function PlanSection({
  account,
  paid,
  copayPaid,
}: {
  account: EmployeeAccount;
  paid: boolean;
  copayPaid: boolean;
}) {
  const checkout = useUpgradeCheckout(account);
  const copayCheckout = useCopayCheckout(account);
  const cancel = useCancelCareerPro(account);
  const cancelCopay = useCancelCopay(account);
  const [openedAt] = useState(() => Date.now());
  const [today] = useState(() => dayFormat.format(new Date()));

  const plan = useQuery({
    ...careerPlanQuery(account),
    refetchInterval: (query) =>
      (paid || copayPaid) &&
      Date.now() - openedAt < planPollTimeout &&
      shouldPollPlan(query.state.data, today, !paid)
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
      copayPaid={copayPaid}
      upgrading={checkout.isPending || checkout.isSuccess}
      copaying={copayCheckout.isPending || copayCheckout.isSuccess}
      error={
        checkout.error?.message ??
        copayCheckout.error?.message ??
        cancel.error?.message ??
        cancelCopay.error?.message
      }
      canceling={cancel.isPending}
      cancelingCopay={cancelCopay.isPending}
      onUpgrade={() => checkout.mutate()}
      onCopay={(targetPlanId) => copayCheckout.mutate(targetPlanId)}
      onContinueCopay={(url) => window.location.assign(url)}
      onCancel={() => cancel.mutate()}
      onCancelCopay={() => cancelCopay.mutate()}
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
  copayPaid,
  upgrading,
  copaying,
  error,
  canceling,
  cancelingCopay,
  onUpgrade,
  onCopay,
  onContinueCopay,
  onCancel,
  onCancelCopay,
}: {
  plan: CareerPlan;
  today: string;
  paid: boolean;
  copayPaid: boolean;
  upgrading: boolean;
  copaying: boolean;
  error?: string;
  canceling: boolean;
  cancelingCopay: boolean;
  onUpgrade: () => void;
  onCopay: (targetPlanId: string) => void;
  onContinueCopay: (url: string) => void;
  onCancel: () => void;
  onCancelCopay: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmingCopay, setConfirmingCopay] = useState(false);
  const view = planCardView(plan, today, paid, copayPaid);
  const { copay } = plan;
  const comparison = view.showComparison ? featureComparisonView(view.activeBenefit) : null;

  return (
    <EmployeePanel title="Seu plano">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{view.companyPlan}</span>
        {view.aiLine ? (
          <Badge variant={plan.company.includesAiApply ? "status-success" : "secondary"}>
            {view.aiLine}
          </Badge>
        ) : null}
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
      {view.copayPaymentNote ? (
        <p role="status" className="text-sm">
          {copayPaymentReceivedNote}
        </p>
      ) : null}
      {view.statusNote ? <p className="text-sm text-destructive">{view.statusNote}</p> : null}
      {copay && view.copayButton === "available" ? (
        <div>
          <Button variant="outline" onClick={() => onCopay(copay.targetPlanId)} disabled={copaying}>
            {view.copayLabel}
          </Button>
        </div>
      ) : null}
      {view.copayPendingLabel ? (
        <p role="status" className="text-sm">
          {view.copayPendingLabel}
        </p>
      ) : null}
      {view.copayContinueUrl ? (
        <div>
          <Button variant="outline" onClick={() => onContinueCopay(view.copayContinueUrl!)}>
            {copayContinueLabel}
          </Button>
        </div>
      ) : null}
      {view.copayPaymentFailedNote ? (
        <p role="status" className="text-sm text-destructive">
          {view.copayPaymentFailedNote}
        </p>
      ) : null}
      {view.copayActiveLabel ? (
        <Badge variant="status-success">{view.copayActiveLabel}</Badge>
      ) : null}
      {view.copayEndedLabel ? <Badge variant="secondary">{view.copayEndedLabel}</Badge> : null}
      {view.copayCancelable && !confirmingCopay ? (
        <div>
          <Button variant="outline" onClick={() => setConfirmingCopay(true)}>
            {cancelCopayLabel}
          </Button>
        </div>
      ) : null}
      {view.copayCancelable && confirmingCopay ? (
        <div role="alertdialog" aria-label={cancelCopayLabel} className="space-y-2">
          <p className="text-sm">{cancelCopayPrompt}</p>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={onCancelCopay} disabled={cancelingCopay}>
              {cancelConfirmLabel}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmingCopay(false)}
              disabled={cancelingCopay}
            >
              {cancelKeepLabel}
            </Button>
          </div>
        </div>
      ) : null}
      {view.upgrade === "available" ? (
        <div>
          <Button onClick={onUpgrade} disabled={upgrading}>
            {view.upgradeLabel}
          </Button>
        </div>
      ) : null}
      {view.cancelable && !confirming ? (
        <div>
          <Button variant="outline" onClick={() => setConfirming(true)}>
            {cancelProLabel}
          </Button>
        </div>
      ) : null}
      {view.cancelable && confirming ? (
        <div role="alertdialog" aria-label={cancelProLabel} className="space-y-2">
          <p className="text-sm">{cancelConfirmPrompt}</p>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={onCancel} disabled={canceling}>
              {cancelConfirmLabel}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={canceling}>
              {cancelKeepLabel}
            </Button>
          </div>
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
