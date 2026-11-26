import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import Upload01Icon from "@hugeicons/core-free-icons/Upload01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type CareerResume,
  careerResumeQuery,
  resumePdfUrl,
  resumeSuggestionsQuery,
  useResumeUpload,
  useSuggestionAction,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { ProgressBar } from "@/shared/ui/progress";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/shadcn/dialog";
import { Dropzone } from "@/shared/ui/shadcn/dropzone";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "../ui";
import { careerDate, criterionLabel, resumeScoreState, scoreCriteria } from "./labels";

const maxResumeBytes = 5_242_880;

const resumeTypes = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

const rejections = new Map([
  ["file-too-large", "O arquivo passa de 5 MB."],
  ["file-invalid-type", "Envie um arquivo PDF ou DOCX."],
]);

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

function ResumeUpload({ account, onDone }: { account: EmployeeAccount; onDone?: () => void }) {
  const upload = useResumeUpload(account);
  const [rejected, setRejected] = useState("");

  return (
    <div className="grid gap-3">
      <Dropzone
        accept={resumeTypes}
        maxSize={maxResumeBytes}
        label={upload.isPending ? "Lendo o currículo…" : "Escolher arquivo"}
        describedBy="resume-upload-help"
        onFile={(file) => {
          setRejected("");
          upload.mutate(file, { onSuccess: onDone });
        }}
        onReject={(files) => {
          const code = files[0]?.errors[0]?.code ?? "";

          setRejected(rejections.get(code) ?? "Não foi possível selecionar o arquivo.");
        }}
      >
        <span className="grid size-9 place-items-center text-muted-foreground">
          {upload.isPending ? (
            <Spinner className="size-6" />
          ) : (
            <HugeiconsIcon icon={Upload01Icon} aria-hidden="true" className="size-6" />
          )}
        </span>
        <span className="text-base font-medium">Solte o currículo aqui</span>
        <span id="resume-upload-help" className="text-sm text-muted-foreground">
          PDF ou DOCX, até 5 MB. A IA lê o arquivo e leva alguns segundos.
        </span>
      </Dropzone>
      <EmployeeError message={rejected || upload.error?.message} />
    </div>
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
                  {item.points}/{item.max}
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
                  <Badge variant="status-success">+{suggestion.estimatedGain} pontos</Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground line-through wrap-anywhere">
                {suggestion.originalText}
              </p>
              <p className="text-sm wrap-anywhere">{suggestion.suggestedText}</p>
              {suggestion.extraGainWithFacts > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Mais +{suggestion.extraGainWithFacts} se você incluir os dados reais pedidos
                  acima.
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

export function ResumeFirst({ account }: { account: EmployeeAccount }) {
  return (
    <EmployeePanel
      title="Comece pelo currículo"
      description="Envie seu currículo para ver as vagas em ordem de compatibilidade e se candidatar com IA. A IA lê o arquivo, dá uma nota e sugere melhorias."
    >
      <ResumeUpload account={account} />
    </EmployeePanel>
  );
}

export function ResumeCareer({ account }: { account: EmployeeAccount }) {
  const resume = useQuery(careerResumeQuery(account));
  const [replacing, setReplacing] = useState(false);

  if (resume.isPending) return <CareerPending />;

  if (resume.isError) {
    return <CareerRetry message={resume.error.message} retry={() => void resume.refetch()} />;
  }

  if (!resume.data) {
    return (
      <div className="space-y-5">
        <EmployeePanel
          title="Envie seu currículo"
          description="Comece por aqui. A IA lê seu currículo, dá uma nota e sugere melhorias. Com ele, as vagas aparecem em ordem de compatibilidade e você pode se candidatar com IA."
        >
          <ResumeUpload account={account} />
        </EmployeePanel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
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
          <Button variant="outline" onClick={() => setReplacing(true)}>
            <HugeiconsIcon icon={File01Icon} aria-hidden="true" /> Enviar outro arquivo
          </Button>
        </div>
      </EmployeePanel>
      <Suggestions account={account} />
      {replacing ? (
        <Dialog open onOpenChange={(open) => setReplacing(open)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Enviar outro currículo</DialogTitle>
              <DialogDescription>
                O novo arquivo substitui o atual. A nota e as sugestões são refeitas.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ResumeUpload account={account} onDone={() => setReplacing(false)} />
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
