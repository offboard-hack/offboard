import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  type CareerResume,
  careerResumeQuery,
  resumePdfUrl,
  resumeSuggestionsQuery,
  useSuggestionAction,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { ProgressBar } from "@/shared/ui/progress";
import { Badge } from "@/shared/ui/shadcn/badge";
import { cn } from "@/shared/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/shadcn/alert";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "../ui";
import {
  careerDate,
  criterionLabel,
  gainLabel,
  pointsLabel,
  resumeScoreState,
  scoreCriteria,
} from "./labels";
import { ResumeWizard } from "./resume-wizard";

export function CareerPending() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}

export function CareerRetry({ message, retry }: { message: string; retry: () => void }) {
  return (
    <EmployeePanel title="Não foi possível carregar">
      <EmployeeError message={message} />
      <Button variant="outline" className="w-fit" onClick={retry}>
        Tentar de novo
      </Button>
    </EmployeePanel>
  );
}

function ResumeContent({ resume }: { resume: CareerResume }) {
  const { content } = resume;

  return (
    <div className="grid gap-3">
      {content.headline.text ? <p className="font-bold">{content.headline.text}</p> : null}
      {content.summary.text ? (
        <p className="whitespace-pre-wrap wrap-anywhere">{content.summary.text}</p>
      ) : null}
      {content.experiences.length ? (
        <ul className="grid gap-1 text-sm">
          {content.experiences.map((experience) => (
            <li key={experience.id} className="wrap-anywhere">
              <span className="font-medium">{experience.role}</span> · {experience.company} ·{" "}
              {experience.start} – {experience.end ?? "atual"}
            </li>
          ))}
        </ul>
      ) : null}
      {content.skills.length ? (
        <div className="flex flex-wrap gap-1.5">
          {content.skills.map((skill) => (
            <Badge key={skill.id} variant="secondary">
              {skill.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResumeScore({ resume }: { resume: CareerResume }) {
  const { score } = resume;
  const state = resumeScoreState(resume);
  const criteria = scoreCriteria(resume.scoreBreakdown);

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">Nota do currículo</span>
        <span className="flex items-baseline gap-2">
          {state === "recalculating" ? (
            <span role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Spinner className="size-3.5" /> Recalculando…
            </span>
          ) : null}
          <span className="text-2xl font-bold">
            {score === null ? "–" : Math.round(score)}
            <span className="text-sm font-normal text-muted-foreground">/100</span>
          </span>
        </span>
      </div>
      {score === null ? (
        <p className="text-sm text-muted-foreground">A nota aparece assim que a IA avaliar.</p>
      ) : (
        <ProgressBar label="Nota do currículo" value={Math.round(score)} max={100} />
      )}
      {criteria.length ? (
        <ul className="grid gap-1.5 text-sm" aria-label="Nota por critério">
          {criteria.map((item) => (
            <li key={item.criterion} className="grid gap-0.5">
              <span className="flex justify-between gap-4">
                <span className="font-medium">{item.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  <span aria-hidden="true">
                    {item.points}/{item.max}
                  </span>
                  <span className="sr-only">
                    {pointsLabel(item.points)} de {item.max}
                  </span>
                </span>
              </span>
              {item.reason ? (
                <span className="text-muted-foreground wrap-anywhere">{item.reason}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Suggestions({ account }: { account: EmployeeAccount }) {
  const suggestions = useQuery(resumeSuggestionsQuery(account));
  const action = useSuggestionAction(account);

  return (
    <EmployeePanel
      title="Sugestões da IA"
      description="Cada sugestão reescreve um trecho do currículo. Aplique as que fizerem sentido para você."
    >
      {suggestions.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {suggestions.isError ? <EmployeeError message={suggestions.error.message} /> : null}
      {suggestions.data?.length === 0 ? (
        <EmployeeEmpty>Nenhuma sugestão aberta no momento.</EmployeeEmpty>
      ) : null}
      <ul className="divide-y">
        {suggestions.data?.map((suggestion) => {
          const busy = action.isPending && action.variables.id === suggestion.id;
          const label = criterionLabel(suggestion.criterion);

          return (
            <li key={suggestion.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <HugeiconsIcon
                  icon={SparklesIcon}
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
                <p className="font-medium wrap-anywhere">{suggestion.rationale}</p>
                {label ? <Badge variant="secondary">{label}</Badge> : null}
                {suggestion.estimatedGain > 0 ? (
                  <Badge variant="status-success">{gainLabel(suggestion.estimatedGain)}</Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground line-through wrap-anywhere">
                {suggestion.originalText}
              </p>
              <p className="text-sm wrap-anywhere">{suggestion.suggestedText}</p>
              {suggestion.extraGainWithFacts > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Mais {gainLabel(suggestion.extraGainWithFacts)} se você incluir os dados reais
                  pedidos acima.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: suggestion.id, action: "apply" })}
                >
                  {busy && action.variables.action === "apply" ? "Aplicando…" : "Aplicar"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: suggestion.id, action: "dismiss" })}
                >
                  Dispensar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <EmployeeError message={action.error?.message} />
    </EmployeePanel>
  );
}

export function ResumeFirst() {
  return (
    <EmployeePanel
      title="Comece pelo currículo"
      description="Crie seu currículo para ver as vagas em ordem de compatibilidade e se candidatar com IA. A IA lê o seu arquivo, você revisa os dados e ela dá uma nota com sugestões."
    >
      <Link
        to="/colaborador"
        search={{ tela: "curriculo" }}
        className={cn(buttonVariants(), "w-fit")}
      >
        Criar currículo
        <HugeiconsIcon icon={ArrowRight02Icon} aria-hidden="true" />
      </Link>
    </EmployeePanel>
  );
}

export function ResumeCareer({ account }: { account: EmployeeAccount }) {
  const resume = useQuery(careerResumeQuery(account));
  const [replacing, setReplacing] = useState(false);
  const [created, setCreated] = useState(false);

  const onCreated = useCallback(() => {
    setReplacing(false);
    setCreated(true);
  }, []);

  if (resume.isPending) return <CareerPending />;

  if (resume.isError) {
    return <CareerRetry message={resume.error.message} retry={() => void resume.refetch()} />;
  }

  if (!resume.data || replacing) {
    return (
      <ResumeWizard
        account={account}
        onCreated={onCreated}
        onCancel={resume.data ? () => setReplacing(false) : undefined}
      />
    );
  }

  return (
    <div className="space-y-5">
      {created ? (
        <Alert role="status">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} aria-hidden="true" />
          <AlertTitle>Currículo criado</AlertTitle>
          <AlertDescription>A IA está calculando a nota e as sugestões.</AlertDescription>
        </Alert>
      ) : null}
      <EmployeePanel
        title="Seu currículo"
        description={`Atualizado em ${careerDate(resume.data.updatedAt)}`}
      >
        <ResumeScore resume={resume.data} />
        <ResumeContent resume={resume.data} />
        <div className="flex flex-wrap gap-2">
          <a
            href={resumePdfUrl(resume.data.id)}
            download
            className={buttonVariants({ variant: "outline" })}
          >
            <HugeiconsIcon icon={Download01Icon} aria-hidden="true" /> Baixar PDF
          </a>
          <Button
            variant="outline"
            onClick={() => {
              setCreated(false);
              setReplacing(true);
            }}
          >
            <HugeiconsIcon icon={File01Icon} aria-hidden="true" /> Refazer currículo
          </Button>
        </div>
      </EmployeePanel>
      <Suggestions account={account} />
    </div>
  );
}
