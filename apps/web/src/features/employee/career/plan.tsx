import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { EmployeeError, EmployeePanel } from "../ui";
import { type CareerPlan, paymentReceivedNote, planCardView } from "./plan-card";

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
  const view = planCardView(plan, today);

  return (
    <EmployeePanel title="Seu plano">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{view.companyPlan}</span>
        <Badge variant={plan.company.includesAiApply ? "status-success" : "secondary"}>
          {view.aiLine}
        </Badge>
        {view.proLine ? <Badge variant="status-success">{view.proLine}</Badge> : null}
      </div>
      {view.sponsorLine ? (
        <p className="text-sm text-muted-foreground">{view.sponsorLine}</p>
      ) : null}
      {paid ? (
        <p role="status" className="text-sm">
          {paymentReceivedNote}
        </p>
      ) : null}
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
