import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type AiAttempt,
  aiAttemptsQuery,
  careerApplicationsQuery,
  useAiCheck,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/shared/ui/shadcn/item";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "../ui";
import { AiApplyDialog } from "./ai-apply";
import { applicationStatus, attemptReason, attemptState, careerDate } from "./labels";

const attemptTones = {
  draft: "status-warning",
  queued: "secondary",
  running: "secondary",
  submitting: "secondary",
  submitted: "status-success",
  rehearsed: "status-success",
  assisted: "status-warning",
  needs_check: "status-warning",
  cancelled: "outline",
} as const;

function SentCheck({ account, attempt }: { account: EmployeeAccount; attempt: AiAttempt }) {
  const check = useAiCheck(account);

  return (
    <div className="grid gap-2">
      <p className="text-sm">
        A IA clicou em enviar, mas não viu a confirmação da empresa. Foi enviada?
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={check.isPending}
          onClick={() => check.mutate({ id: attempt.id, sent: true })}
        >
          Sim, foi enviada
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={check.isPending}
          onClick={() => check.mutate({ id: attempt.id, sent: false })}
        >
          Não foi
        </Button>
      </div>
      <EmployeeError message={check.error?.message} />
    </div>
  );
}

export function AttemptBadge({ state }: { state: AiAttempt["state"] }) {
  return <Badge variant={attemptTones[state]}>{attemptState(state)}</Badge>;
}

export function CareerApplications({ account }: { account: EmployeeAccount }) {
  const [opened, setOpened] = useState<AiAttempt | null>(null);
  const attempts = useQuery(aiAttemptsQuery(account));
  const applications = useQuery(careerApplicationsQuery(account));

  const viaAi = new Set(
    attempts.data?.flatMap((attempt) => (attempt.state === "submitted" ? [attempt.job.id] : [])),
  );

  return (
    <div className="space-y-5">
      <EmployeePanel
        title="Candidaturas com IA"
        description="Respostas preparadas pela IA, ensaios e envios."
      >
        {attempts.isPending ? <Skeleton className="h-24 w-full" /> : null}
        {attempts.isError ? <EmployeeError message={attempts.error.message} /> : null}
        {attempts.data?.length === 0 ? (
          <EmployeeEmpty>
            Abra uma vaga em Vagas e escolha “Candidatar com IA” para começar.
          </EmployeeEmpty>
        ) : null}
        <ul className="divide-y">
          {attempts.data?.map((attempt) => {
            const reason = attemptReason(attempt.reason);

            return (
              <li key={attempt.id}>
                <Item size="sm" className="max-sm:flex-wrap">
                  <ItemMedia variant="icon">
                    <HugeiconsIcon icon={AiMagicIcon} aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="block wrap-anywhere">{attempt.job.title}</ItemTitle>
                    <ItemDescription>
                      {attempt.job.company} · {careerDate(attempt.preparedAt)}
                      {attempt.rehearsal ? " · Ensaio" : ""}
                    </ItemDescription>
                    {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
                    {attempt.state === "needs_check" ? (
                      <SentCheck account={account} attempt={attempt} />
                    ) : null}
                  </ItemContent>
                  <ItemActions className="max-sm:w-full max-sm:flex-wrap">
                    <AttemptBadge state={attempt.state} />
                    {attempt.state === "draft" || attempt.state === "rehearsed" ? (
                      <Button size="sm" variant="outline" onClick={() => setOpened(attempt)}>
                        Revisar respostas
                      </Button>
                    ) : null}
                  </ItemActions>
                </Item>
              </li>
            );
          })}
        </ul>
      </EmployeePanel>
      <EmployeePanel title="Candidaturas">
        {applications.isPending ? <Skeleton className="h-24 w-full" /> : null}
        {applications.isError ? <EmployeeError message={applications.error.message} /> : null}
        {applications.data?.length === 0 ? (
          <EmployeeEmpty>Suas candidaturas vão aparecer aqui.</EmployeeEmpty>
        ) : null}
        <ul className="divide-y">
          {applications.data?.map((application) => (
            <li key={application.id}>
              <Item size="sm">
                <ItemMedia variant="icon">
                  <HugeiconsIcon icon={Briefcase01Icon} aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="block wrap-anywhere">{application.job.title}</ItemTitle>
                  <ItemDescription>
                    {application.job.company} · {careerDate(application.appliedAt)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="flex-wrap justify-end">
                  {viaAi.has(application.job.id) ? <Badge variant="outline">via IA</Badge> : null}
                  <Badge variant="secondary">{applicationStatus(application)}</Badge>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      </EmployeePanel>
      {opened ? (
        <AiApplyDialog
          account={account}
          job={opened.job}
          attemptId={opened.id}
          close={() => setOpened(null)}
        />
      ) : null}
    </div>
  );
}
