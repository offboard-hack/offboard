import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type CareerJob,
  careerJobsQuery,
  careerProfileQuery,
  careerResumeQuery,
  type JobsView,
  useMarkApplied,
  type WorkModel,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { cn } from "@/shared/lib/utils";
import { PortalFilter } from "@/shared/ui/select";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/shadcn/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/shared/ui/shadcn/item";
import { Label } from "@/shared/ui/shadcn/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/shared/ui/shadcn/pagination";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "../ui";
import { AiApplyDialog } from "./ai-apply";
import { DismissJob } from "./dismiss-job";
import { jobsEmpty, jobsSummary, jobsViews } from "./jobs-view";
import { careerDate, isLongText, jobPlace, matchScore, salaryRange } from "./labels";
import { CareerRetry } from "./resume";

const workModels = [
  { value: "all", label: "Todas" },
  { value: "remote", label: "Remotas" },
  { value: "hybrid", label: "Híbridas" },
  { value: "onsite", label: "Presenciais" },
] as const;

function isWorkModel(value: string): value is WorkModel {
  return value === "remote" || value === "hybrid" || value === "onsite";
}

function JobDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = isLongText(text);

  return (
    <div className="grid gap-1">
      <p
        className={cn(
          "text-sm whitespace-pre-line wrap-anywhere",
          long && !expanded && "line-clamp-6",
        )}
      >
        {text}
      </p>
      {long ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto w-fit p-0"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Ver menos" : "Ver mais"}
        </Button>
      ) : null}
    </div>
  );
}

function JobDialog({
  account,
  job,
  resumeId,
  close,
  applyWithAi,
}: {
  account: EmployeeAccount;
  job: CareerJob;
  resumeId: string | null;
  close: () => void;
  applyWithAi: () => void;
}) {
  const markApplied = useMarkApplied(account);
  const [dismissing, setDismissing] = useState(false);
  const profile = useQuery(careerProfileQuery(account));
  const salary = salaryRange(job);
  const score = matchScore(job.match);
  const offersAi = job.aiApplyCapable && !job.applied;
  const eligible = profile.data?.aiApply.eligible === true;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !markApplied.isPending) close();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job.title}</DialogTitle>
          <DialogDescription>
            {job.company} · {jobPlace(job)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          {salary ? <p className="font-bold">{salary}</p> : null}
          {job.postedAt ? (
            <p className="text-sm text-muted-foreground">Publicada em {careerDate(job.postedAt)}</p>
          ) : null}
          {job.description ? <JobDescription text={job.description} /> : null}
          {job.match ? (
            <div className="grid gap-2">
              <p className="font-medium">{score} com seu currículo</p>
              {job.match.reasons.length ? (
                <ul className="grid list-disc gap-1 pl-5 text-sm">
                  {job.match.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              A compatibilidade aparece depois que a IA avaliar seu currículo.
            </p>
          )}
          {job.fitsPreferences ? null : (
            <p className="text-sm text-muted-foreground">
              Esta vaga está fora das preferências que você informou.
            </p>
          )}
          {job.applied ? (
            <p className="text-sm text-muted-foreground">Você já se candidatou a esta vaga.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Se você se candidatou pelo site da vaga, registre aqui para acompanhar em
              Candidaturas.
            </p>
          )}
          {offersAi && profile.data && !eligible ? (
            <p className="text-sm text-muted-foreground">
              Candidatura com IA: disponível no plano Platinum Premium da sua empresa ou no Carreira
              Pro.
            </p>
          ) : null}
          {!job.applied && resumeId === null ? (
            <p className="text-sm text-muted-foreground">
              Para registrar a candidatura, envie seu currículo primeiro.
            </p>
          ) : null}
          <EmployeeError message={markApplied.error?.message} />
          {dismissing ? (
            <DismissJob
              account={account}
              job={job}
              cancel={() => setDismissing(false)}
              done={close}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          {job.applied || dismissing ? null : (
            <Button
              variant="ghost"
              className="sm:mr-auto"
              disabled={markApplied.isPending}
              onClick={() => setDismissing(true)}
            >
              Não tenho interesse
            </Button>
          )}
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            <HugeiconsIcon icon={LinkSquare02Icon} aria-hidden="true" /> Abrir vaga
          </a>
          {job.applied ? null : (
            <Button
              variant="outline"
              disabled={markApplied.isPending || resumeId === null}
              onClick={() => {
                if (resumeId) markApplied.mutate({ jobId: job.id, resumeId }, { onSuccess: close });
              }}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} aria-hidden="true" />
              {markApplied.isPending ? "Registrando…" : "Já me candidatei"}
            </Button>
          )}
          {offersAi && eligible ? (
            <Button disabled={markApplied.isPending} onClick={applyWithAi}>
              <HugeiconsIcon icon={AiMagicIcon} aria-hidden="true" /> Candidatar com IA
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobRow({ job, open }: { job: CareerJob; open: () => void }) {
  const score = matchScore(job.match);

  return (
    <li>
      <Item size="sm">
        <ItemMedia variant="icon">
          <HugeiconsIcon icon={Briefcase01Icon} aria-hidden="true" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="block wrap-anywhere">{job.title}</ItemTitle>
          <ItemDescription>
            {job.company} · {jobPlace(job)}
          </ItemDescription>
          <div className="flex flex-wrap gap-1.5">
            {score ? <Badge variant="status-success">{score}</Badge> : null}
            {job.applied ? <Badge variant="secondary">Candidatura registrada</Badge> : null}
            {job.fitsPreferences ? null : (
              <Badge variant="outline">Fora das suas preferências</Badge>
            )}
          </div>
        </ItemContent>
        <ItemActions>
          <Button type="button" variant="outline" onClick={open}>
            Ver vaga <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden="true" />
          </Button>
        </ItemActions>
      </Item>
    </li>
  );
}

export function CareerJobs({ account }: { account: EmployeeAccount }) {
  const [view, setView] = useState<JobsView>("compatible");
  const [model, setModel] = useState<WorkModel | "all">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CareerJob | null>(null);
  const [aiJob, setAiJob] = useState<CareerJob | null>(null);
  const resume = useQuery(careerResumeQuery(account));

  const jobs = useQuery({
    ...careerJobsQuery(
      account,
      view,
      model === "all" ? undefined : model,
      page,
      Boolean(resume.data),
    ),
    placeholderData: keepPreviousData,
  });

  if (jobs.isError && !jobs.data) {
    return <CareerRetry message={jobs.error.message} retry={() => void jobs.refetch()} />;
  }

  const pages = jobs.data ? Math.max(1, Math.ceil(jobs.data.total / jobs.data.pageSize)) : 1;
  const current = selected && jobs.data?.items.find((job) => job.id === selected.id);
  const hasResume = Boolean(resume.data);
  const matching = hasResume && jobs.data?.matching === true;

  const empty = jobsEmpty({
    view,
    matching: jobs.data?.matching === true,
    hasResume,
    filtered: model !== "all",
  });

  return (
    <div className="space-y-5">
      <EmployeePanel
        title="Vagas para você"
        description={
          jobs.data ? jobsSummary({ view, total: jobs.data.total, hasResume }) : undefined
        }
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Vagas exibidas">
          {jobsViews.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={view === item.value ? "default" : "outline"}
              aria-pressed={view === item.value}
              onClick={() => {
                setPage(1);
                setView(item.value);
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="grid w-full max-w-56 gap-2">
          <Label htmlFor="career-mode">Modalidade</Label>
          <PortalFilter
            id="career-mode"
            label="Modalidade"
            className="w-full"
            value={model}
            items={[...workModels]}
            onChange={(value) => {
              setPage(1);
              setModel(isWorkModel(value) ? value : "all");
            }}
          />
        </div>
        {matching && jobs.data?.items.length ? (
          <p className="text-sm text-muted-foreground">
            Calculando a compatibilidade com seu currículo… pode levar alguns minutos.
          </p>
        ) : null}
        {jobs.isPending ? <Skeleton className="h-48 w-full" /> : null}
        {jobs.data?.items.length === 0 ? (
          <EmployeeEmpty>
            {empty === "calculating"
              ? "Calculando a compatibilidade com seu currículo… pode levar alguns minutos."
              : null}
            {empty === "no-resume" ? (
              <>
                Envie seu currículo para ver as vagas compatíveis.{" "}
                <Link
                  to="/colaborador"
                  search={{ tela: "curriculo" }}
                  className="underline underline-offset-4"
                >
                  Ir para Currículo
                </Link>
              </>
            ) : null}
            {empty === "no-compatible"
              ? "Nenhuma vaga compatível agora. Veja todas as vagas ou volte mais tarde — novas vagas chegam todo dia."
              : null}
            {empty === "no-model" ? "Nenhuma vaga nessa modalidade." : null}
            {empty === "none" ? "Nenhuma vaga disponível no momento." : null}
          </EmployeeEmpty>
        ) : null}
        <ul className="divide-y" aria-busy={jobs.isPlaceholderData}>
          {jobs.data?.items.map((job) => (
            <JobRow key={job.id} job={job} open={() => setSelected(job)} />
          ))}
        </ul>
        {pages > 1 ? (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={page === 1 || jobs.isPlaceholderData}
                  onClick={() => setPage(page - 1)}
                />
              </PaginationItem>
              <PaginationItem className="px-3 text-sm text-muted-foreground">
                Página {page} de {pages}
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  disabled={page >= pages || jobs.isPlaceholderData}
                  onClick={() => setPage(page + 1)}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        ) : null}
        {jobs.isError ? <EmployeeError message={jobs.error.message} /> : null}
      </EmployeePanel>
      {selected ? (
        <JobDialog
          account={account}
          job={current ?? selected}
          resumeId={resume.data?.id ?? null}
          close={() => setSelected(null)}
          applyWithAi={() => {
            setSelected(null);
            setAiJob(current ?? selected);
          }}
        />
      ) : null}
      {aiJob ? <AiApplyDialog account={account} job={aiJob} close={() => setAiJob(null)} /> : null}
    </div>
  );
}
