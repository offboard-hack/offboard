import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMachine } from "@xstate/react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useCreateResume, useReadResume } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/shadcn/button";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { EmployeeError } from "../ui";
import {
  fileSize,
  maxResumeBytes,
  type Method,
  onboardingMachine,
  readingChecks,
  sectionSummaries,
} from "./resume-onboarding";
import { SectionSheet } from "./resume-sections";

const accept =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fileProblem(file: File) {
  if (file.size > maxResumeBytes) return "O arquivo passa de 5 MB.";

  return /\.(pdf|docx)$/i.test(file.name) ? undefined : "Envie um arquivo PDF ou DOCX.";
}

function StepHeader({ step, onBack }: { step: 1 | 2; onBack: () => void }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <Button variant="link" className="h-auto px-0" onClick={onBack}>
          <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden="true" /> Voltar
        </Button>
        <span className="text-sm text-muted-foreground">Passo {step} de 2</span>
      </div>
      <div
        className="grid grid-cols-2 gap-1.5"
        role="progressbar"
        aria-label="Progresso"
        aria-valuemin={1}
        aria-valuemax={2}
        aria-valuenow={step}
      >
        <span className="h-1 rounded-full bg-primary" />
        <span className={cn("h-1 rounded-full", step === 2 ? "bg-primary" : "bg-primary/20")} />
      </div>
    </div>
  );
}

function Footer({
  label,
  disabled,
  pending,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="lg"
      className="mt-2 h-12 w-full justify-between px-5"
      disabled={disabled || pending}
      onClick={onClick}
    >
      {label}
      {pending ? (
        <Spinner className="size-4" />
      ) : (
        <HugeiconsIcon icon={ArrowRight02Icon} aria-hidden="true" />
      )}
    </Button>
  );
}

function Option({
  value,
  current,
  title,
  description,
  onChoose,
  children,
}: {
  value: Method;
  current: Method;
  title: string;
  description: string;
  onChoose: (method: Method) => void;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-3 py-4 first:pt-0">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="resume-method"
          className="mt-1 size-5 accent-primary"
          checked={current === value}
          onChange={() => onChoose(value)}
        />
        <span className="grid">
          <span className="font-medium">{title}</span>
          <span className="text-sm text-muted-foreground">{description}</span>
        </span>
      </label>
      {current === value ? children : null}
    </div>
  );
}

export function ResumeWizard({
  account,
  onCreated,
  onCancel,
}: {
  account: EmployeeAccount;
  onCreated: () => void;
  onCancel?: () => void;
}) {
  const read = useReadResume(account);
  const create = useCreateResume(account);

  const machine = useMemo(
    () =>
      onboardingMachine({
        read: (file) => read.mutateAsync(file),
        create: async ({ draft, file }) => {
          await create.mutateAsync({ content: draft, file });
        },
        onCreated,
      }),
    [read.mutateAsync, create.mutateAsync, onCreated],
  );

  const [snapshot, send] = useMachine(machine);
  const picker = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState("");
  const { context } = snapshot;

  const pickFile = (
    <>
      <input
        ref={picker}
        type="file"
        accept={accept}
        hidden
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];

          event.target.value = "";

          if (!file) return;

          const problem = fileProblem(file);

          setRejected(problem ?? "");

          if (!problem) send({ type: "select", file });
        }}
      />
      <Button
        variant="outline"
        className="h-14 w-full border-dashed border-primary/50 bg-primary/5 text-primary"
        onClick={() => picker.current?.click()}
      >
        <HugeiconsIcon icon={File01Icon} aria-hidden="true" />
        {context.file ? context.file.name : "Escolher arquivo"}
      </Button>
      <EmployeeError message={rejected} />
    </>
  );

  if (snapshot.matches("intro")) {
    return (
      <section className="mx-auto grid w-full max-w-md gap-6" aria-labelledby="resume-intro">
        <div className="grid gap-1">
          <h2 id="resume-intro" className="text-2xl font-bold">
            Seu novo currículo
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} aria-hidden="true" className="size-4" /> Cerca de 3
            min
          </p>
        </div>
        <div className="grid gap-2">
          <h3 className="font-semibold">Como funciona</h3>
          <ol className="divide-y">
            {["Envio do arquivo", "Revisão dos dados"].map((step, index) => (
              <li key={step} className="flex items-center gap-4 py-3">
                <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <div className="grid gap-2">
          <Footer label="Começar" onClick={() => send({ type: "start" })} />
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Manter o currículo atual
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  if (snapshot.matches("choose")) {
    const ready = context.method === "scratch" || context.file !== null;

    return (
      <section className="mx-auto grid w-full max-w-md gap-6" aria-labelledby="resume-choose">
        <StepHeader step={1} onBack={() => send({ type: "back" })} />
        <h2 id="resume-choose" className="text-2xl font-bold">
          Como quer enviar seu currículo?
        </h2>
        <div className="divide-y" role="radiogroup" aria-labelledby="resume-choose">
          <Option
            value="file"
            current={context.method}
            title="Enviar um arquivo"
            description="PDF ou Word, até 5 MB"
            onChoose={(method) => send({ type: "choose", method })}
          >
            {pickFile}
          </Option>
          <Option
            value="scratch"
            current={context.method}
            title="Criar do zero"
            description="Preencha os dados você mesmo"
            onChoose={(method) => send({ type: "choose", method })}
          />
        </div>
        <Footer label="Continuar" disabled={!ready} onClick={() => send({ type: "continue" })} />
      </section>
    );
  }

  if (snapshot.matches("reading")) {
    const done = snapshot.matches({ reading: "read" });
    const failed = snapshot.matches({ reading: "failed" });
    const checks = readingChecks(done ? context.draft : null);
    const file = context.file;

    return (
      <section className="mx-auto grid w-full max-w-md gap-6" aria-labelledby="resume-reading">
        <StepHeader step={1} onBack={() => send({ type: "back" })} />
        <h2 id="resume-reading" className="text-2xl font-bold">
          {done ? "Lemos seu currículo" : failed ? "Não deu para ler" : "Lendo seu currículo…"}
        </h2>
        {file ? (
          <div className="flex items-center gap-3">
            <HugeiconsIcon icon={File01Icon} aria-hidden="true" className="size-5 text-primary" />
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium">{file.name}</span>
              <span className="text-sm text-muted-foreground">{fileSize(file.size)}</span>
            </span>
            <Button variant="link" className="px-0" onClick={() => send({ type: "back" })}>
              Trocar
            </Button>
          </div>
        ) : null}
        <div className="h-1.5 overflow-hidden rounded-full bg-primary/15" aria-hidden="true">
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none",
              done || failed ? "w-full" : "w-2/3 animate-pulse",
              failed && "bg-destructive",
            )}
          />
        </div>
        <ul className="grid gap-4" aria-live="polite">
          {checks.map((check) => (
            <li key={check.label} className="flex items-center gap-3">
              <ReadingMark state={markState(check.found, failed)} />
              <span className={cn(check.found === false && "text-muted-foreground")}>
                {check.label}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-3 text-muted-foreground">
            <ReadingMark state="later" />
            Nota e sugestões · depois de criar
          </li>
        </ul>
        <EmployeeError message={context.error} />
        <Footer label="Continuar" disabled={!done} onClick={() => send({ type: "continue" })} />
      </section>
    );
  }

  const { draft } = context;

  return (
    <section className="mx-auto grid w-full max-w-md gap-6" aria-labelledby="resume-review">
      <StepHeader step={2} onBack={() => send({ type: "back" })} />
      <h2 id="resume-review" className="text-2xl font-bold">
        {context.method === "scratch"
          ? "Preencha seu currículo"
          : "O que encontramos no seu currículo"}
      </h2>
      <ul className="divide-y">
        {sectionSummaries(draft).map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => send({ type: "open", section: section.id })}
            >
              <span className="grid min-w-0 flex-1">
                <span className="font-medium">{section.title}</span>
                <span className="truncate text-sm text-muted-foreground">{section.detail}</span>
              </span>
              {section.toCheck ? (
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {section.toCheck} para conferir
                </span>
              ) : null}
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            </button>
          </li>
        ))}
      </ul>
      <EmployeeError message={context.error} />
      <Footer
        label="Criar currículo"
        pending={snapshot.matches("creating")}
        onClick={() => send({ type: "create" })}
      />
      {context.section ? (
        <SectionSheet
          key={context.section}
          section={context.section}
          draft={draft}
          onSave={(next) => send({ type: "save", draft: next })}
          onClose={() => send({ type: "close" })}
        />
      ) : null}
    </section>
  );
}

function markState(found: boolean | null, failed: boolean) {
  if (found === null) return failed ? "missing" : "reading";

  return found ? "found" : "missing";
}

function ReadingMark({ state }: { state: "found" | "missing" | "reading" | "later" }) {
  if (state === "found") {
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        aria-label="Encontrado"
        className="size-6 text-emerald-600"
      />
    );
  }

  if (state === "reading") return <Spinner className="size-6 text-primary" aria-label="Lendo" />;

  return (
    <span
      className="size-6 rounded-full border-2 border-muted-foreground/30"
      aria-label={state === "missing" ? "Não encontrado" : "Depois"}
      role="img"
    />
  );
}
