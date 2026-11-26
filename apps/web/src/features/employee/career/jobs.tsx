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
  careerResumeQuery,
  useMarkApplied,
  type WorkModel,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
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
import { careerDate, jobPlace, matchScore, salaryRange } from "./labels";
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

export function ResumeFirst() {
  return (
    <EmployeePanel
      title="Comece pelo currículo"
      description="Envie seu currículo para ver as vagas em ordem de compatibilidade e se candidatar com IA."
    >
      <Link
        to="/colaborador"
        search={{ tela: "curriculo" }}
        className={buttonVariants({ className: "w-fit" })}
      >
        Enviar currículo
      </Link>
    </EmployeePanel>
  );
}

function JobDialog({
  account,
  job,
  resumeId,
  close,
}: {
  account: EmployeeAccount;
  job: CareerJob;
  resumeId: string | null;
  close: () => void;
}) {
  const markApplied = useMarkApplied(account);
  const salary = salaryRange(job);
  const score = matchScore(job.match);

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
              Leia a descrição completa no site da vaga. Se você se candidatou por lá, registre aqui
              para acompanhar em Candidaturas.
            </p>
          )}
          {!job.applied && resumeId === null ? (
            <p className="text-sm text-muted-foreground">
              Para registrar a candidatura, envie seu currículo primeiro.
            </p>
          ) : null}
          <EmployeeError message={markApplied.error?.message} />
        </DialogBody>
        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CareerJobs({ account }: { account: EmployeeAccount }) {
  const [model, setModel] = useState<WorkModel | "all">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CareerJob | null>(null);
  const resume = useQuery(careerResumeQuery(account));

  const jobs = useQuery({
    ...careerJobsQuery(account, model === "all" ? undefined : model, page),
    placeholderData: keepPreviousData,
  });

  if (jobs.isError && !jobs.data) {
    return <CareerRetry message={jobs.error.message} retry={() => void jobs.refetch()} />;
  }

  const pages = jobs.data ? Math.max(1, Math.ceil(jobs.data.total / jobs.data.pageSize)) : 1;
  const current = selected && jobs.data?.items.find((job) => job.id === selected.id);

  return (
    <div className="space-y-5">
      {resume.data === null ? <ResumeFirst /> : null}
      <EmployeePanel
        title="Vagas para você"
        description={
          jobs.data
            ? `${jobs.data.total} ${jobs.data.total === 1 ? "vaga" : "vagas"}, das mais compatíveis às menos.`
            : undefined
        }
      >
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
        {jobs.isPending ? <Skeleton className="h-48 w-full" /> : null}
        {jobs.data?.items.length === 0 ? (
          <EmployeeEmpty>
            Nenhuma vaga {model === "all" ? "disponível no momento." : "nessa modalidade."}
          </EmployeeEmpty>
        ) : null}
        <ul className="divide-y" aria-busy={jobs.isPlaceholderData}>
          {jobs.data?.items.map((job) => {
            const score = matchScore(job.match);

            return (
              <li key={job.id}>
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
                      {job.applied ? (
                        <Badge variant="secondary">Candidatura registrada</Badge>
                      ) : null}
                      {job.fitsPreferences ? null : (
                        <Badge variant="outline">Fora das suas preferências</Badge>
                      )}
                    </div>
                  </ItemContent>
                  <ItemActions>
                    <Button type="button" variant="outline" onClick={() => setSelected(job)}>
                      Ver vaga <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden="true" />
                    </Button>
                  </ItemActions>
                </Item>
              </li>
            );
          })}
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
        />
      ) : null}
    </div>
  );
}
