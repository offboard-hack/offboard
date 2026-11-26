import AiMagicIcon from "@hugeicons/core-free-icons/AiMagicIcon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type AiAttempt,
  aiAttemptProgressQuery,
  type ConfirmAnswers,
  careerProfileQuery,
  NotAiApplicable,
  useAiApplyConsent,
  useAiConfirm,
  useAiDraft,
  useAiRun,
  useCoverLetter,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { PortalFilter } from "@/shared/ui/select";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import { Checkbox } from "@/shared/ui/shadcn/checkbox";
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
import { Label } from "@/shared/ui/shadcn/label";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/shadcn/toggle-group";
import { EmployeeError } from "../ui";
import {
  type AnswerValue,
  answerControl,
  answerNote,
  answerOptions,
  answerProblem,
  askedQuestions,
  confirmAnswers,
  draftFor,
  fileQuestionLabel,
  fileQuestions,
  initialAnswer,
} from "./ai-apply-form";
import { AttemptProgress } from "./attempt-result";

type AttemptJob = Pick<AiAttempt["job"], "id" | "title" | "company" | "url">;

type Question = AiAttempt["questions"][number];

const pressed =
  "aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground";

function Waiting({ children }: { children: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner className="size-4" /> {children}
    </p>
  );
}

function Start({
  account,
  job,
  onAttempt,
}: {
  account: EmployeeAccount;
  job: AttemptJob;
  onAttempt: (attempt: AiAttempt) => void;
}) {
  const profile = useQuery(careerProfileQuery(account));
  const consent = useAiApplyConsent(account);
  const draft = useAiDraft(account);

  function prepare() {
    draft.mutate(job.id, { onSuccess: onAttempt });
  }

  if (profile.isPending) return <Waiting>Abrindo…</Waiting>;

  if (profile.isError) return <EmployeeError message={profile.error.message} />;

  if (!profile.data.aiApply.eligible) {
    return <EmployeeError message="Disponível no plano Platinum Premium da sua empresa." />;
  }

  if (!profile.data.aiApply.consented) {
    return (
      <div className="grid gap-3">
        <p className="font-medium">Antes de começar</p>
        <p className="text-sm">
          A IA prepara as respostas do formulário da vaga com base no seu currículo e nas respostas
          que você já salvou. Você revisa tudo antes de qualquer envio.
        </p>
        <p className="text-sm">
          Para preencher o formulário, seus dados são enviados à empresa da vaga por meio da
          Browserbase, um navegador automatizado com servidores nos Estados Unidos.
        </p>
        <EmployeeError message={consent.error?.message} />
        <Button
          className="w-fit"
          disabled={consent.isPending}
          onClick={() => consent.mutate(undefined, { onSuccess: prepare })}
        >
          {consent.isPending ? "Registrando…" : "Concordo e quero continuar"}
        </Button>
      </div>
    );
  }

  if (draft.isPending) {
    return <Waiting>A IA está lendo o formulário e preparando as respostas…</Waiting>;
  }

  if (draft.error instanceof NotAiApplicable) {
    return (
      <div className="grid gap-3">
        <EmployeeError message={draft.error.message} />
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", className: "w-fit" })}
        >
          <HugeiconsIcon icon={LinkSquare02Icon} aria-hidden="true" /> Abrir vaga
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        A IA lê o formulário de {job.company} e prepara as respostas. Nada é enviado nesta etapa.
      </p>
      <EmployeeError message={draft.error?.message} />
      <Button className="w-fit" onClick={prepare}>
        <HugeiconsIcon icon={AiMagicIcon} aria-hidden="true" />
        {draft.isError ? "Tentar de novo" : "Preparar respostas"}
      </Button>
    </div>
  );
}

function AnswerControl({
  question,
  id,
  value,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: {
  question: Question;
  id: string;
  value: AnswerValue;
  invalid: boolean;
  describedBy: string;
  onChange: (value: AnswerValue) => void;
  onBlur: () => void;
}) {
  const control = answerControl(question);
  const options = answerOptions(question);

  if (control === "multi") {
    const chosen = Array.isArray(value) ? value : [];

    return (
      <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
        {options.map((option) => (
          <label key={option.value} className="flex min-h-9 items-center gap-2 text-sm">
            <Checkbox
              checked={chosen.includes(option.value)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...chosen, option.value]
                    : chosen.filter((item) => item !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  const text = Array.isArray(value) ? "" : value;

  if (control === "single") {
    return (
      <PortalFilter
        id={id}
        label={question.label}
        className="w-full"
        invalid={invalid}
        describedBy={describedBy}
        value={text}
        items={[{ value: "", label: "Sem resposta" }, ...options]}
        onChange={onChange}
      />
    );
  }

  const Field = control === "textarea" ? Textarea : Input;

  return (
    <Field
      id={id}
      value={text}
      maxLength={2_000}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}

function Review({
  account,
  attempt,
  confirm,
  submit,
  close,
}: {
  account: EmployeeAccount;
  attempt: AiAttempt;
  confirm: ReturnType<typeof useAiConfirm>;
  submit: (answers: ConfirmAnswers, rehearsal: boolean) => void;
  close: () => void;
}) {
  const coverLetter = useCoverLetter(account);
  const [mode, setMode] = useState<"rehearsal" | "send">("rehearsal");
  const [sending, setSending] = useState(false);
  const asked = askedQuestions(attempt.questions);
  const files = fileQuestions(attempt.questions);
  const needsLetter = files.some((question) => question.kind === "cover_letter");

  const form = useForm({
    defaultValues: {
      answers: asked.map((question) => initialAnswer(question, draftFor(attempt, question))),
    },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: ({ value }) => {
      if (mode === "send" && !sending) {
        setSending(true);

        return;
      }

      setSending(false);
      submit(confirmAnswers(asked, value.answers), mode === "rehearsal");
    },
  });

  return (
    <form
      className="flex min-h-0 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DialogBody className="grid gap-5">
        <p className="text-sm text-muted-foreground">
          {attempt.state === "rehearsed"
            ? "O ensaio terminou. Revise as respostas e, se quiser, envie a candidatura de verdade."
            : "Revise as respostas. Complete o que estiver em branco e corrija o que não estiver certo."}
        </p>
        {asked.map((question, index) => {
          const id = `ai-answer-${index}`;
          const note = answerNote(draftFor(attempt, question));

          return (
            <form.Field
              key={question.id}
              name={`answers[${index}]`}
              validators={{ onDynamic: ({ value }) => answerProblem(question, value) }}
            >
              {(field) => {
                const error = field.state.meta.errors[0];

                return (
                  <div className="grid gap-1.5">
                    <Label id={`${id}-label`} htmlFor={id} className="wrap-anywhere">
                      {question.label}
                      {question.required ? " (obrigatória)" : ""}
                    </Label>
                    <AnswerControl
                      question={question}
                      id={id}
                      value={field.state.value}
                      invalid={error !== undefined}
                      describedBy={`${id}-note ${id}-error`}
                      onChange={field.handleChange}
                      onBlur={field.handleBlur}
                    />
                    <div id={`${id}-note`} className="flex flex-wrap items-center gap-1.5 text-xs">
                      {note.source ? (
                        <span className="text-muted-foreground">{note.source}</span>
                      ) : null}
                      {note.inferred ? <Badge variant="outline">inferido pela IA</Badge> : null}
                      {note.attention ? (
                        <Badge variant="status-warning">{note.attention}</Badge>
                      ) : null}
                    </div>
                    <EmployeeError id={`${id}-error`} message={error} />
                  </div>
                );
              }}
            </form.Field>
          );
        })}
        {files.length ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Arquivos enviados com a candidatura</p>
            <ul className="grid gap-1 text-sm">
              {files.map((question) => (
                <li key={question.id} className="wrap-anywhere">
                  <Badge variant="secondary">{fileQuestionLabel(question)}</Badge> {question.label}
                </li>
              ))}
            </ul>
            {needsLetter ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">
                  A vaga pede uma carta de apresentação. Se ainda não gerou a carta desta vaga, gere
                  antes de confirmar.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  disabled={coverLetter.isPending || coverLetter.isSuccess}
                  onClick={() => coverLetter.mutate(attempt.job.id)}
                >
                  {coverLetter.isSuccess
                    ? "Carta pronta"
                    : coverLetter.isPending
                      ? "Escrevendo a carta…"
                      : "Gerar carta"}
                </Button>
                <EmployeeError message={coverLetter.error?.message} />
              </div>
            ) : null}
          </div>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">O que fazer com as respostas</legend>
          <ToggleGroup
            aria-label="O que fazer com as respostas"
            variant="outline"
            className="max-w-full flex-wrap"
            value={[mode]}
            onValueChange={([next]) => {
              if (next === "rehearsal" || next === "send") setMode(next);
            }}
          >
            <ToggleGroupItem value="rehearsal" className={pressed}>
              Ensaio (não envia)
            </ToggleGroupItem>
            <ToggleGroupItem value="send" className={pressed}>
              Enviar candidatura
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-sm text-muted-foreground">
            {mode === "rehearsal"
              ? "A IA preenche o formulário da vaga e registra uma foto da tela, sem enviar."
              : `A IA preenche o formulário e envia a candidatura para ${attempt.job.company}.`}
          </p>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        {confirm.error ? (
          <div className="sm:mr-auto sm:self-center">
            <EmployeeError message={confirm.error.message} />
          </div>
        ) : null}
        <Button type="button" variant="outline" disabled={confirm.isPending} onClick={close}>
          Fechar
        </Button>
        <Button type="submit" disabled={confirm.isPending}>
          {confirm.isPending
            ? "Confirmando…"
            : mode === "rehearsal"
              ? "Confirmar ensaio"
              : "Enviar candidatura"}
        </Button>
      </DialogFooter>
      {sending ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSending(false);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Enviar a candidatura?</DialogTitle>
              <DialogDescription>
                A candidatura vai de verdade para {attempt.job.company}, com estas respostas e seu
                currículo. Depois de enviada, não dá para desfazer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSending(false)}>
                Voltar
              </Button>
              <Button type="button" onClick={() => void form.handleSubmit()}>
                Sim, enviar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </form>
  );
}

function Attempt({
  account,
  id,
  close,
}: {
  account: EmployeeAccount;
  id: string;
  close: () => void;
}) {
  const attempt = useQuery(aiAttemptProgressQuery(account, id));
  const confirm = useAiConfirm(account);
  const run = useAiRun(account);
  const [reviewing, setReviewing] = useState(false);

  function submit(answers: ConfirmAnswers, rehearsal: boolean) {
    confirm.mutate(
      { id, answers, rehearsal },
      {
        onSuccess(confirmed) {
          setReviewing(false);
          run.mutate(confirmed.id);
        },
      },
    );
  }

  if (attempt.isPending) {
    return (
      <DialogBody>
        <Waiting>Abrindo…</Waiting>
      </DialogBody>
    );
  }

  if (attempt.isError) {
    return (
      <DialogBody>
        <EmployeeError message={attempt.error.message} />
      </DialogBody>
    );
  }

  if (attempt.data.state === "draft" || (reviewing && attempt.data.state === "rehearsed")) {
    return (
      <Review
        account={account}
        attempt={attempt.data}
        confirm={confirm}
        submit={submit}
        close={close}
      />
    );
  }

  return (
    <>
      <DialogBody>
        <AttemptProgress account={account} attempt={attempt.data} runError={run.error?.message} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Fechar
        </Button>
        {attempt.data.state === "rehearsed" ? (
          <Button type="button" onClick={() => setReviewing(true)}>
            Revisar e enviar
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

export function AiApplyDialog({
  account,
  job,
  attemptId,
  close,
}: {
  account: EmployeeAccount;
  job: AttemptJob;
  attemptId?: string;
  close: () => void;
}) {
  const [id, setId] = useState(attemptId);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Candidatar com IA</DialogTitle>
          <DialogDescription>
            {job.title} · {job.company}
          </DialogDescription>
        </DialogHeader>
        {id ? (
          <Attempt account={account} id={id} close={close} />
        ) : (
          <DialogBody>
            <Start account={account} job={job} onAttempt={(attempt) => setId(attempt.id)} />
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}
