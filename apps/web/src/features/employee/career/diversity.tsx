import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type CareerPreferences,
  careerPreferencesQuery,
  useSaveProfileFields,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Button } from "@/shared/ui/shadcn/button";
import { Checkbox } from "@/shared/ui/shadcn/checkbox";
import { Label } from "@/shared/ui/shadcn/label";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { Switch } from "@/shared/ui/shadcn/switch";
import { EmployeeError, EmployeePanel } from "../ui";
import {
  type DiversityDraft,
  type DiversityKey,
  diversityChanges,
  diversityDraft,
  diversityFields,
  toggled,
} from "./diversity-form";
import { useUnsavedGuard } from "./use-unsaved-guard";

export function DiversitySection({ account }: { account: EmployeeAccount }) {
  const preferences = useQuery(careerPreferencesQuery(account));

  if (preferences.error) return <EmployeeError message={preferences.error.message} />;

  if (!preferences.data) return <Skeleton className="h-48 w-full" aria-busy="true" />;

  return <DiversityForm account={account} fields={preferences.data.profileFields} />;
}

function DiversityForm({
  account,
  fields,
}: {
  account: EmployeeAccount;
  fields: CareerPreferences["profileFields"];
}) {
  const [draft, setDraft] = useState<DiversityDraft>(() => diversityDraft(fields));
  const [unchanged, setUnchanged] = useState(false);
  const save = useSaveProfileFields(account);
  const changes = diversityChanges(fields, draft);

  useUnsavedGuard(Object.keys(changes).length > 0 && !save.isPending);

  const set = (key: DiversityKey, next: DiversityDraft[DiversityKey]) => {
    setUnchanged(false);
    save.reset();
    setDraft((current) => ({ ...current, [key]: next }));
  };

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();

        if (Object.keys(changes).length === 0) {
          setUnchanged(true);

          return;
        }

        save.mutate(changes, {
          onSuccess(saved) {
            setDraft(diversityDraft(saved.profileFields));
          },
        });
      }}
    >
      <EmployeePanel
        title="Diversidade"
        description="Opcional. A IA usa estes dados só para sugerir respostas às perguntas de diversidade das vagas, e você confere cada uma antes do envio."
      >
        {diversityFields.map((field) => {
          const current = draft[field.key];
          const id = `diversity-${field.key}`;

          return (
            <fieldset key={field.key} className="grid gap-2" disabled={save.isPending}>
              <legend className="text-sm font-medium">{field.label}</legend>
              {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
              <div className="grid gap-1 sm:grid-cols-2">
                {field.options.map((option) => {
                  const on = current.values.includes(option.value);

                  const change = (next: boolean) =>
                    set(field.key, {
                      ...current,
                      values: toggled(field.multiple, current.values, option.value, next),
                    });

                  return (
                    <label key={option.value} className="flex min-h-9 items-center gap-2 text-sm">
                      {field.multiple ? (
                        <Checkbox checked={on} onCheckedChange={change} />
                      ) : (
                        <input
                          type="radio"
                          name={id}
                          value={option.value}
                          checked={on}
                          onChange={() => change(true)}
                        />
                      )}
                      {option.label}
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`${id}-share`}
                    size="sm"
                    checked={current.share}
                    disabled={current.values.length === 0}
                    onCheckedChange={(share) => set(field.key, { ...current, share })}
                  />
                  <Label
                    htmlFor={`${id}-share`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Usar nas candidaturas
                  </Label>
                </div>
                {!field.multiple && current.values.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => set(field.key, { ...current, values: [] })}
                  >
                    Limpar
                  </Button>
                ) : null}
              </div>
            </fieldset>
          );
        })}
      </EmployeePanel>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar diversidade"}
        </Button>
        {save.isSuccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Dados salvos.
          </p>
        ) : null}
        {unchanged ? (
          <p role="status" className="text-sm text-muted-foreground">
            Nada mudou desde o último salvamento.
          </p>
        ) : null}
        <EmployeeError message={save.error?.message} />
      </div>
    </form>
  );
}
