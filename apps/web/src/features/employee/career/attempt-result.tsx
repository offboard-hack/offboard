import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type AiAttempt, aiScreenshotUrl, isAttemptRunning, useAiCheck } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { EmployeeError } from "../ui";
import { attemptReason, attemptState, evidenceValue } from "./labels";

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

const progress = {
  queued: "Na fila. O navegador começa a preencher em instantes.",
  running: "O navegador está preenchendo o formulário da vaga.",
  submitting: "Enviando a candidatura…",
} as const;

export function AttemptBadge({ state }: { state: AiAttempt["state"] }) {
  return <Badge variant={attemptTones[state]}>{attemptState(state)}</Badge>;
}

export function SentCheck({ account, attempt }: { account: EmployeeAccount; attempt: AiAttempt }) {
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

function LiveView({ url }: { url: string }) {
  return (
    <figure className="grid gap-2">
      <figcaption className="flex items-center gap-2 text-sm font-medium">
        <span className="size-2 rounded-full bg-destructive motion-safe:animate-pulse" />
        Navegador ao vivo
      </figcaption>
      <div inert className="pointer-events-none overflow-hidden rounded-xl border select-none">
        <iframe
          src={url}
          title="Navegador ao vivo"
          tabIndex={-1}
          referrerPolicy="no-referrer"
          className="pointer-events-none aspect-video w-full"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Só para acompanhar. O navegador é controlado pela IA.
      </p>
    </figure>
  );
}

function Evidence({ attempt }: { attempt: AiAttempt }) {
  const { evidence } = attempt;

  if (!evidence) return null;

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">O que foi preenchido</p>
      <dl className="grid gap-2 text-sm">
        {evidence.fields.map((field, index) => (
          <div key={`${index}:${field.question}`} className="grid gap-0.5">
            <dt className="text-muted-foreground wrap-anywhere">{field.question}</dt>
            <dd className="wrap-anywhere">{evidenceValue(field.value)}</dd>
          </div>
        ))}
      </dl>
      {evidence.files.length ? (
        <p className="text-sm text-muted-foreground wrap-anywhere">
          Arquivos: {evidence.files.join(", ")}
        </p>
      ) : null}
      {evidence.finalUrl ? (
        <a
          href={evidence.finalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Página final do formulário
        </a>
      ) : null}
    </div>
  );
}

export function AttemptProgress({
  account,
  attempt,
  runError,
}: {
  account: EmployeeAccount;
  attempt: AiAttempt;
  runError?: string;
}) {
  const reason = attemptReason(attempt.reason);
  const running = isAttemptRunning(attempt);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <AttemptBadge state={attempt.state} />
        {attempt.rehearsal ? <Badge variant="outline">Ensaio</Badge> : null}
      </div>
      {attempt.state === "queued" ||
      attempt.state === "running" ||
      attempt.state === "submitting" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner className="size-4" /> {progress[attempt.state]}
        </p>
      ) : null}
      {running && runError ? (
        <p className="text-sm text-muted-foreground">
          {runError} O preenchimento segue pela fila e aparece aqui quando começar.
        </p>
      ) : null}
      {running && attempt.liveUrl ? <LiveView url={attempt.liveUrl} /> : null}
      {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      {attempt.state === "rehearsed" ? (
        <p className="text-sm">Ensaio concluído. Nada foi enviado para {attempt.job.company}.</p>
      ) : null}
      {attempt.state === "needs_check" ? <SentCheck account={account} attempt={attempt} /> : null}
      {!running && attempt.hasScreenshot ? (
        <figure className="grid gap-2">
          <figcaption className="text-sm font-medium">Foto da tela no fim</figcaption>
          <img
            src={`${aiScreenshotUrl(attempt.id)}?v=${encodeURIComponent(attempt.confirmedAt ?? attempt.preparedAt)}`}
            alt={`Formulário de ${attempt.job.company} preenchido pela IA`}
            className="w-full rounded-xl border"
          />
        </figure>
      ) : null}
      {running ? null : <Evidence attempt={attempt} />}
      {attempt.state === "assisted" ? (
        <a
          href={attempt.job.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", className: "w-fit" })}
        >
          <HugeiconsIcon icon={LinkSquare02Icon} aria-hidden="true" /> Abrir vaga
        </a>
      ) : null}
    </div>
  );
}
