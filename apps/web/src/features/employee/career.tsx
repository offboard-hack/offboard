import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import Calendar01Icon from "@hugeicons/core-free-icons/Calendar01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { brazilTimezone, employeeDate, type EmployeeState } from "@offboard/employee";
import {
  applicationCounts,
  applicationStatusLabel,
  applyForJob,
  jobFit,
  skillsList,
  type Job,
  type Resume,
} from "@offboard/employee/career";
import { resumeHtml } from "@offboard/employee/resume-document";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { type EmployeeAccount, useEmployeeWrite } from "@/entities/employee";
import { DatePicker } from "@/shared/ui/date-picker";
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
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "./ui";

type CareerState = Extract<EmployeeState, { key: "career" }>;

type CareerProps = { account: EmployeeAccount; state: CareerState };

const shortDate = { day: "numeric", month: "short", year: "numeric" } as const;

function today() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: brazilTimezone }).format();
}

export function Career({
  account,
  state,
  jobs,
  view,
}: CareerProps & { jobs: readonly Job[]; view: "vagas" | "candidaturas" }) {
  const counts = applicationCounts(state.value.applications);
  const [job, setJob] = useState<Job | null>(null);
  const [mode, setMode] = useState<"all" | "remote" | "hybrid">("all");
  const [date, setDate] = useState("");
  const write = useEmployeeWrite(account);

  const interviews = state.value.applications.flatMap(({ status }) =>
    status.kind === "interview" ? [status.interview] : [],
  );

  const agenda = date ? interviews.filter((interview) => interview.date === date) : interviews;
  const visibleJobs = jobs.filter((item) => mode === "all" || item.mode === mode);

  const selectedJobApplication =
    job && state.value.applications.find(({ jobId }) => jobId === job.id);

  return (
    <div className="space-y-5">
      <nav aria-label="Carreira" className="flex flex-wrap gap-2">
        <Link
          to="/colaborador"
          search={{ tela: "carreira", carreira: "vagas" }}
          className={buttonVariants({ variant: view === "vagas" ? "default" : "outline" })}
        >
          Vagas
        </Link>
        <Link
          to="/colaborador"
          search={{ tela: "carreira", carreira: "candidaturas" }}
          className={buttonVariants({ variant: view === "candidaturas" ? "default" : "outline" })}
        >
          Candidaturas · {counts.all}
        </Link>
      </nav>
      {view === "vagas" ? (
        <EmployeePanel title="Vagas disponíveis">
          {jobs.length ? (
            <div className="grid w-full max-w-56 gap-2">
              <Label htmlFor="career-mode">Modalidade</Label>
              <PortalFilter
                id="career-mode"
                label="Modalidade"
                className="w-full"
                value={mode}
                items={[
                  { value: "all", label: "Todas" },
                  { value: "remote", label: "Remotas" },
                  { value: "hybrid", label: "Híbridas" },
                ]}
                onChange={(value) => {
                  if (value === "all" || value === "remote" || value === "hybrid") setMode(value);
                }}
              />
            </div>
          ) : null}
          {visibleJobs.length === 0 ? (
            <EmployeeEmpty>
              Nenhuma vaga disponível {jobs.length ? "nessa modalidade." : "no momento."}
            </EmployeeEmpty>
          ) : null}
          <ul className="divide-y">
            {visibleJobs.map((item) => {
              const registered = state.value.applications.some(({ jobId }) => jobId === item.id);

              return (
                <li key={item.id}>
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <HugeiconsIcon icon={Briefcase01Icon} aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="block wrap-anywhere">{item.title}</ItemTitle>
                      <ItemDescription>
                        {item.company} ·{" "}
                        {item.mode === "remote" ? "Remoto" : item.location || "Híbrido"}
                      </ItemDescription>
                      {registered ? <Badge variant="secondary">Registrada</Badge> : null}
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          write.reset();
                          setJob(item);
                        }}
                      >
                        Ver vaga <HugeiconsIcon icon={ArrowRight01Icon} aria-hidden="true" />
                      </Button>
                    </ItemActions>
                  </Item>
                </li>
              );
            })}
          </ul>
        </EmployeePanel>
      ) : (
        <>
          <EmployeePanel title="Entrevistas">
            {interviews.length ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-2">
                  <Label id="interview-date-label" htmlFor="interview-date">
                    Filtrar por data
                  </Label>
                  <DatePicker
                    id="interview-date"
                    labelledBy="interview-date-label"
                    value={date}
                    onChange={setDate}
                  />
                </div>
                {date ? (
                  <Button type="button" variant="ghost" onClick={() => setDate("")}>
                    Ver todas
                  </Button>
                ) : null}
              </div>
            ) : null}
            {agenda.length ? (
              agenda.map((interview) => (
                <Item
                  key={`${interview.date}:${interview.time}:${interview.title}`}
                  variant="outline"
                  size="sm"
                >
                  <ItemMedia variant="icon">
                    <HugeiconsIcon icon={Calendar01Icon} aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="block wrap-anywhere">{interview.title}</ItemTitle>
                    <ItemDescription>
                      {employeeDate(interview.date, shortDate)} · {interview.time} ·{" "}
                      {interview.format}
                    </ItemDescription>
                    <p>{interview.instructions}</p>
                  </ItemContent>
                </Item>
              ))
            ) : (
              <EmployeeEmpty>Nenhuma entrevista {date ? "nessa data." : "agendada."}</EmployeeEmpty>
            )}
          </EmployeePanel>
          <EmployeePanel title="Etapas das candidaturas">
            {counts.all === 0 ? (
              <EmployeeEmpty>Suas candidaturas vão aparecer aqui.</EmployeeEmpty>
            ) : null}
            <ul className="divide-y">
              {state.value.applications.map((application) => (
                <li key={application.id}>
                  <Item size="sm">
                    <ItemMedia variant="icon">
                      <HugeiconsIcon icon={Briefcase01Icon} aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="block wrap-anywhere">{application.title}</ItemTitle>
                      <ItemDescription>
                        {application.company} · {employeeDate(application.appliedAt, shortDate)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant="secondary">{applicationStatusLabel(application)}</Badge>
                    </ItemActions>
                  </Item>
                </li>
              ))}
            </ul>
          </EmployeePanel>
        </>
      )}
      {job ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !write.isPending) setJob(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{job.title}</DialogTitle>
              <DialogDescription>
                {job.company} · {job.mode === "remote" ? "Remoto" : job.location || "Híbrido"}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-3">
              <p>{job.description}</p>
              {job.salary ? <p className="font-bold">{job.salary}</p> : null}
              {job.requirements.length ? (
                <p className="text-sm text-muted-foreground">
                  {jobFit(job, state.value.base).score}% de compatibilidade com o currículo base
                </p>
              ) : null}
              {selectedJobApplication ? (
                <p className="text-sm text-muted-foreground">
                  Candidatura registrada em{" "}
                  {employeeDate(selectedJobApplication.appliedAt, shortDate)}.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  O Offboard registra a candidatura e salva uma versão do seu currículo na conta. O
                  envio à empresa é feito pelo canal da vaga.
                </p>
              )}
              <EmployeeError message={write.error?.message} />
            </DialogBody>
            {selectedJobApplication ? null : (
              <DialogFooter>
                <Button
                  disabled={write.isPending}
                  onClick={() =>
                    write.mutate(
                      {
                        ...state,
                        value: applyForJob(state.value, { job, date: today(), name: account.name }),
                      },
                      { onSuccess: () => setJob(null) },
                    )
                  }
                >
                  <HugeiconsIcon icon={Briefcase01Icon} aria-hidden />
                  {write.isPending ? "Salvando…" : "Registrar candidatura"}
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function printResume(resume: Resume) {
  const preview = window.open("", "_blank");

  if (!preview) return false;

  preview.opener = null;
  preview.document.open();
  preview.document.write(resumeHtml(resume));
  preview.document.close();
  preview.focus();
  preview.print();

  return true;
}

export function ResumePreview({ state }: { state: CareerState }) {
  const { base, published } = state.value;
  const [error, setError] = useState("");

  return (
    <div className="space-y-5">
      <EmployeePanel
        title={published ? base.name : "Prévia oculta"}
        description={published ? base.headline : undefined}
      >
        {published ? (
          <>
            <p className="whitespace-pre-wrap wrap-anywhere">{base.summary}</p>
            <p className="whitespace-pre-wrap wrap-anywhere">{base.launchResult}</p>
            <p className="whitespace-pre-wrap wrap-anywhere">{base.campaignResult}</p>
            <p className="wrap-anywhere">{skillsList(base.skills).join(" · ")}</p>
            <Button
              variant="outline"
              onClick={() =>
                setError(printResume(base) ? "" : "Permita abrir a nova aba para salvar o PDF.")
              }
            >
              Baixar PDF
            </Button>
            <EmployeeError message={error} />
          </>
        ) : (
          <p className="text-muted-foreground">Ative a prévia na tela Currículo.</p>
        )}
      </EmployeePanel>
    </div>
  );
}
