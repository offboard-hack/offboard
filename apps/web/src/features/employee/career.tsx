import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import Calendar01Icon from "@hugeicons/core-free-icons/Calendar01Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { brazilTimezone, employeeDate, type EmployeeState } from "@offboard/employee";
import {
  applicationCounts,
  applicationStatusLabel,
  applyForJob,
  jobFit,
  resumeFormSchema,
  skillsList,
  versionLabelSchema,
  type Job,
  type Resume,
  type ResumeVersion,
} from "@offboard/employee/career";
import { resumeHtml } from "@offboard/employee/resume-document";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
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
import { Input } from "@/shared/ui/shadcn/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/shared/ui/shadcn/item";
import { Label } from "@/shared/ui/shadcn/label";
import { Switch } from "@/shared/ui/shadcn/switch";
import { Textarea } from "@/shared/ui/shadcn/textarea";
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

type Editor = { kind: "base" } | { kind: "version"; version: ResumeVersion } | { kind: "new" };

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

export function ResumePage({ account, state }: CareerProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [printError, setPrintError] = useState("");
  const write = useEmployeeWrite(account);
  const { base, versions, published, baseUpdatedAt } = state.value;

  function download(resume: Resume) {
    setPrintError(
      printResume(resume) ? "" : "Permita abrir a nova aba para imprimir ou salvar o PDF.",
    );
  }

  return (
    <div className="space-y-5">
      <EmployeePanel
        title="Currículo base"
        description={
          base.headline
            ? `Atualizado em ${employeeDate(baseUpdatedAt, shortDate)}`
            : "Preencha seu perfil profissional para criar o currículo base."
        }
      >
        {base.headline ? <p className="font-bold">{base.headline}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditor({ kind: "base" })}>Editar base</Button>
          {base.headline ? (
            <Button variant="outline" onClick={() => download(base)}>
              <HugeiconsIcon icon={Download01Icon} aria-hidden /> Baixar PDF
            </Button>
          ) : null}
        </div>
      </EmployeePanel>
      <EmployeePanel title="Uma versão para cada vaga">
        <Button variant="outline" onClick={() => setEditor({ kind: "new" })}>
          Nova versão
        </Button>
        {versions.length === 0 ? <EmployeeEmpty>Você ainda não tem versões.</EmployeeEmpty> : null}
        <ul className="divide-y">
          {versions.map((version) => (
            <li key={version.id}>
              <Item
                size="sm"
                className="max-sm:grid max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:items-start"
              >
                <ItemMedia variant="icon">
                  <HugeiconsIcon icon={File01Icon} aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="block wrap-anywhere">{version.label}</ItemTitle>
                  {version.company ? <ItemDescription>{version.company}</ItemDescription> : null}
                </ItemContent>
                <ItemActions className="max-sm:col-start-2 max-sm:flex-wrap">
                  <Button
                    variant="ghost"
                    aria-label={`Editar versão ${version.label}`}
                    onClick={() => setEditor({ kind: "version", version })}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`Baixar PDF de ${version.label}`}
                    onClick={() => download(version.resume)}
                  >
                    PDF
                  </Button>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      </EmployeePanel>
      <EmployeePanel
        title="Prévia privada do currículo"
        description="Só você pode abrir a prévia na sua conta. Para compartilhar o currículo, baixe o PDF."
      >
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="employee-resume-visibility">Ativar prévia privada</Label>
          <Switch
            id="employee-resume-visibility"
            checked={published}
            disabled={write.isPending}
            onCheckedChange={(next) =>
              write.mutate({ ...state, value: { ...state.value, published: next } })
            }
          />
        </div>
        <EmployeeError message={write.error?.message} />
        {published ? (
          <Button variant="outline" render={<Link to="/colaborador" search={{ tela: "previa" }} />}>
            Ver prévia
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Prévia oculta.</p>
        )}
      </EmployeePanel>
      <EmployeeError message={printError} />
      {editor ? (
        <ResumeEditor
          account={account}
          state={state}
          editor={editor}
          close={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}

const resumeFields = [
  { key: "name", label: "Nome no currículo", multiline: false },
  { key: "headline", label: "Título profissional", multiline: false },
  { key: "summary", label: "Resumo profissional", multiline: true },
  { key: "launchResult", label: "Experiência com projetos e lançamentos", multiline: true },
  { key: "campaignResult", label: "Outras experiências e resultados", multiline: true },
  { key: "skills", label: "Competências separadas por vírgula", multiline: false },
] as const;

function ResumeEditor({
  account,
  state,
  editor,
  close,
}: CareerProps & { editor: Editor; close: () => void }) {
  const write = useEmployeeWrite(account);
  const version = editor.kind === "version" ? editor.version : null;

  const schema = resumeFormSchema.extend({
    label: editor.kind === "base" ? z.string() : versionLabelSchema,
    company: z.string().trim().max(200),
  });

  const form = useForm({
    defaultValues: {
      ...(version?.resume ?? state.value.base),
      label: version?.label ?? "",
      company: version?.company ?? "",
    },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: schema },
    onSubmit: ({ value }) => {
      const resume = resumeFormSchema.parse(value);
      const date = today();

      if (editor.kind === "base") {
        write.mutate(
          { ...state, value: { ...state.value, base: resume, baseUpdatedAt: date } },
          { onSuccess: close },
        );

        return;
      }

      const saved = {
        id: version?.id ?? window.crypto.randomUUID(),
        label: value.label.trim(),
        company: value.company.trim(),
        match: version?.match ?? null,
        resume,
        updatedAt: date,
      };

      const versions = version
        ? state.value.versions.map((item) => (item.id === version.id ? saved : item))
        : [saved, ...state.value.versions];

      write.mutate({ ...state, value: { ...state.value, versions } }, { onSuccess: close });
    },
  });

  const title =
    editor.kind === "base"
      ? "Editar currículo base"
      : editor.kind === "new"
        ? "Nova versão"
        : "Editar versão";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !write.isPending && !write.error) close();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>As alterações ficam na sua conta.</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogBody className="grid gap-4">
            {editor.kind !== "base" ? (
              <>
                <form.Field name="label">
                  {(field) => (
                    <div className="grid gap-1.5">
                      <Label htmlFor="resume-version-label">Nome da versão</Label>
                      <Input
                        id="resume-version-label"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={field.state.meta.errors.length > 0}
                        aria-describedby={
                          field.state.meta.errors.length > 0
                            ? "resume-version-label-error"
                            : undefined
                        }
                      />
                      <EmployeeError
                        id="resume-version-label-error"
                        message={field.state.meta.errors[0]?.message}
                      />
                    </div>
                  )}
                </form.Field>
                <form.Field name="company">
                  {(field) => (
                    <div className="grid gap-1.5">
                      <Label htmlFor="resume-version-company">Empresa (opcional)</Label>
                      <Input
                        id="resume-version-company"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        maxLength={200}
                      />
                    </div>
                  )}
                </form.Field>
              </>
            ) : null}
            {resumeFields.map(({ key, label, multiline }) => (
              <form.Field key={key} name={key}>
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`resume-${key}`}>{label}</Label>
                    {multiline ? (
                      <Textarea
                        id={`resume-${key}`}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        maxLength={1200}
                        aria-invalid={field.state.meta.errors.length > 0}
                        aria-describedby={
                          field.state.meta.errors.length > 0 ? `resume-${key}-error` : undefined
                        }
                      />
                    ) : (
                      <Input
                        id={`resume-${key}`}
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                        maxLength={1200}
                        aria-invalid={field.state.meta.errors.length > 0}
                        aria-describedby={
                          field.state.meta.errors.length > 0 ? `resume-${key}-error` : undefined
                        }
                      />
                    )}
                    <EmployeeError
                      id={`resume-${key}-error`}
                      message={field.state.meta.errors[0]?.message}
                    />
                  </div>
                )}
              </form.Field>
            ))}
            <EmployeeError message={write.error?.message} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={write.isPending} onClick={close}>
              {write.error ? "Descartar rascunho" : "Cancelar"}
            </Button>
            <Button type="submit" disabled={write.isPending}>
              {write.isPending ? "Salvando…" : "Salvar currículo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
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
