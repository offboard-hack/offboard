import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type AnswerLibrary,
  answerLibraryQuery,
  type CareerPreferences,
  careerPreferencesQuery,
  useSaveAnswer,
  useSaveProfileFields,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { Switch } from "@/shared/ui/shadcn/switch";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import { EmployeeEmpty, EmployeeError, EmployeePanel } from "../ui";
import {
  type AddressDraft,
  addressFields,
  addressProblem,
  answerProblem,
  type ProfileDraft,
  profileChanges,
  profileDraft,
  type TextDraft,
  type TextKey,
  textFields,
  textProblem,
} from "./preferences-form";

export type PreferencesSection = "perfil" | "respostas";

const sections = [
  { id: "perfil", label: "Perfil" },
  { id: "respostas", label: "Respostas salvas" },
] as const satisfies { id: PreferencesSection; label: string }[];

const shareLabel = "Usar nas candidaturas";

function saoPauloToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

export function Preferences({
  account,
  section,
}: {
  account: EmployeeAccount;
  section: PreferencesSection;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        A IA usa estes dados para preencher os formulários das vagas. Você revisa tudo antes de cada
        envio.
      </p>
      <nav aria-label="Preferências" className="flex flex-wrap gap-2">
        {sections.map((item) => (
          <Link
            key={item.id}
            to="/colaborador"
            search={{ tela: "preferencias", secao: item.id }}
            className={buttonVariants({ variant: section === item.id ? "default" : "outline" })}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {section === "perfil" ? <ProfileSection account={account} /> : null}
      {section === "respostas" ? <AnswersSection account={account} /> : null}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function ProfileSection({ account }: { account: EmployeeAccount }) {
  const preferences = useQuery(careerPreferencesQuery(account));

  if (preferences.error) return <EmployeeError message={preferences.error.message} />;

  if (!preferences.data) return <Loading />;

  const fields = preferences.data.profileFields;

  return <ProfileForm account={account} fields={fields} />;
}

function ProfileForm({
  account,
  fields,
}: {
  account: EmployeeAccount;
  fields: CareerPreferences["profileFields"];
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraft(fields));
  const [checked, setChecked] = useState(false);
  const [unchanged, setUnchanged] = useState(false);
  const save = useSaveProfileFields(account);
  const today = saoPauloToday();

  const problems = new Map(
    textFields.map(({ key }) => [key, textProblem(key, draft[key].value, today)]),
  );

  const addressError = addressProblem(draft.address);
  const invalid = [...problems.values()].some(Boolean) || addressError !== undefined;

  const setText = (key: TextKey, next: TextDraft) => {
    setUnchanged(false);
    save.reset();
    setDraft((current) => ({ ...current, [key]: next }));
  };

  const setAddress = (next: AddressDraft) => {
    setUnchanged(false);
    save.reset();
    setDraft((current) => ({ ...current, address: next }));
  };

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setChecked(true);

        if (invalid) return;

        const changes = profileChanges(fields, draft);

        if (Object.keys(changes).length === 0) {
          setUnchanged(true);

          return;
        }

        save.mutate(changes, {
          onSuccess(saved) {
            setDraft(profileDraft(saved.profileFields));
            setChecked(false);
          },
        });
      }}
    >
      <EmployeePanel
        title="Informações pessoais"
        description="Desligue “Usar nas candidaturas” para guardar um dado sem enviá-lo às empresas."
      >
        {textFields
          .filter((field) => field.group === "personal")
          .map((field) => (
            <TextRow
              key={field.key}
              id={`profile-${field.key}`}
              label={field.label}
              hint={field.hint}
              value={draft[field.key]}
              error={checked ? problems.get(field.key) : undefined}
              onChange={(next) => setText(field.key, next)}
            />
          ))}
      </EmployeePanel>
      <EmployeePanel title="Endereço" description="Preencha tudo ou deixe em branco.">
        <div className="grid gap-3 sm:grid-cols-2">
          {addressFields.map((field) => (
            <div key={field.key} className="grid gap-1.5">
              <Label htmlFor={`address-${field.key}`}>
                {field.label}
                {field.optional ? " (opcional)" : ""}
              </Label>
              <Input
                id={`address-${field.key}`}
                value={draft.address[field.key]}
                aria-invalid={checked && addressError !== undefined}
                aria-describedby="address-error"
                onChange={(event) =>
                  setAddress({ ...draft.address, [field.key]: event.target.value })
                }
              />
            </div>
          ))}
        </div>
        <ShareSwitch
          id="address-share"
          checked={draft.address.share}
          onChange={(share) => setAddress({ ...draft.address, share })}
        />
        <EmployeeError id="address-error" message={checked ? addressError : undefined} />
      </EmployeePanel>
      <EmployeePanel
        title="Sobre o trabalho"
        description="Respostas comuns nos formulários das vagas."
      >
        {textFields
          .filter((field) => field.group === "work")
          .map((field) => (
            <TextRow
              key={field.key}
              id={`profile-${field.key}`}
              label={field.label}
              hint={field.hint}
              value={draft[field.key]}
              error={checked ? problems.get(field.key) : undefined}
              onChange={(next) => setText(field.key, next)}
            />
          ))}
      </EmployeePanel>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar perfil"}
        </Button>
        <Link
          to="/colaborador"
          search={{ tela: "curriculo" }}
          className={buttonVariants({ variant: "outline" })}
        >
          Ver currículo
        </Link>
        {save.isSuccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Perfil salvo.
          </p>
        ) : null}
        {unchanged ? (
          <p role="status" className="text-sm text-muted-foreground">
            Nada mudou desde o último salvamento.
          </p>
        ) : null}
        {checked && invalid ? <EmployeeError message="Corrija os campos marcados." /> : null}
        <EmployeeError message={save.error?.message} />
      </div>
    </form>
  );
}

function TextRow({
  id,
  label,
  hint,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint: string | null;
  value: TextDraft;
  error: string | undefined;
  onChange: (next: TextDraft) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value.value}
        aria-invalid={error !== undefined}
        aria-describedby={`${id}-hint ${id}-error`}
        onChange={(event) => onChange({ ...value, value: event.target.value })}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : (
          <span />
        )}
        <ShareSwitch
          id={`${id}-share`}
          checked={value.share}
          onChange={(share) => onChange({ ...value, share })}
        />
      </div>
      <EmployeeError id={`${id}-error`} message={error} />
    </div>
  );
}

function ShareSwitch({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {shareLabel}
      </Label>
    </div>
  );
}

function AnswersSection({ account }: { account: EmployeeAccount }) {
  const library = useQuery(answerLibraryQuery(account));

  if (library.error) return <EmployeeError message={library.error.message} />;

  if (!library.data) return <Loading />;

  const { questions } = library.data;

  return (
    <EmployeePanel
      title="Respostas salvas"
      description="Respostas que você confirmou em candidaturas. A IA reaproveita quando a mesma pergunta aparece de novo."
    >
      {questions.length === 0 ? (
        <EmployeeEmpty>
          Ainda não há respostas salvas. Quando você confirmar uma candidatura com IA, as respostas
          aparecem aqui.
        </EmployeeEmpty>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Em perguntas de múltipla escolha, mantenha o texto igual ao da opção, senão a IA não
            consegue reaproveitar.
          </p>
          <ul className="grid gap-5">
            {questions.map((question) => (
              <AnswerRow
                key={`${question.id}:${question.answer ?? ""}`}
                account={account}
                question={question}
              />
            ))}
          </ul>
        </>
      )}
    </EmployeePanel>
  );
}

function AnswerRow({
  account,
  question,
}: {
  account: EmployeeAccount;
  question: AnswerLibrary["questions"][number];
}) {
  const saved = question.answer ?? "";
  const [answer, setAnswer] = useState(saved);
  const save = useSaveAnswer(account);
  const id = `answer-${question.id}`;
  const problem = answerProblem(answer);
  const changed = answer.trim() !== saved;

  return (
    <li className="grid gap-1.5">
      <Label htmlFor={id} className="wrap-anywhere">
        {question.text}
      </Label>
      <Textarea
        id={id}
        value={answer}
        rows={2}
        aria-invalid={problem !== undefined}
        aria-describedby={`${id}-error`}
        onChange={(event) => setAnswer(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!changed || problem !== undefined || save.isPending}
          onClick={() => save.mutate({ questionId: question.id, answer })}
        >
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
        {saved !== "" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate({ questionId: question.id, answer: "" })}
          >
            Apagar resposta
          </Button>
        ) : null}
      </div>
      <EmployeeError id={`${id}-error`} message={problem ?? save.error?.message} />
    </li>
  );
}
