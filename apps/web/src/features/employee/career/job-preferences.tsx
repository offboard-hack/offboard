import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type CareerPreferences,
  careerPreferencesQuery,
  useSaveJobPreferences,
} from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Button } from "@/shared/ui/shadcn/button";
import { Checkbox } from "@/shared/ui/shadcn/checkbox";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { Switch } from "@/shared/ui/shadcn/switch";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import { EmployeeError, EmployeePanel } from "../ui";
import {
  type JobDraft,
  jobChanges,
  jobDraft,
  jobProblems,
  type PlaceDraft,
  newPlace,
  workModelOptions,
} from "./job-preferences-form";

export function JobPreferencesSection({ account }: { account: EmployeeAccount }) {
  const preferences = useQuery(careerPreferencesQuery(account));

  if (preferences.error) return <EmployeeError message={preferences.error.message} />;

  if (!preferences.data) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return <JobForm account={account} stored={preferences.data} />;
}

function JobForm({ account, stored }: { account: EmployeeAccount; stored: CareerPreferences }) {
  const [draft, setDraft] = useState<JobDraft>(() => jobDraft(stored));
  const [checked, setChecked] = useState(false);
  const [unchanged, setUnchanged] = useState(false);
  const save = useSaveJobPreferences(account);
  const problems = jobProblems(draft);
  const invalid = Object.values(problems).some(Boolean);
  const shown = (message: string | undefined) => (checked ? message : undefined);
  const chosenModels = new Set(draft.workModels);

  const change = (next: Partial<JobDraft>) => {
    setUnchanged(false);
    save.reset();
    setDraft((current) => ({ ...current, ...next }));
  };

  const setPlace = (index: number, next: PlaceDraft) =>
    change({ places: draft.places.map((place, at) => (at === index ? next : place)) });

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setChecked(true);

        if (invalid) return;

        const changes = jobChanges(stored, draft);

        if (Object.keys(changes).length === 0) {
          setUnchanged(true);

          return;
        }

        save.mutate(changes, {
          onSuccess(saved) {
            setDraft(jobDraft(saved));
            setChecked(false);
          },
        });
      }}
    >
      <EmployeePanel
        title="Cargos que procuro"
        description="Um por linha. A IA usa estes cargos para achar vagas compatíveis."
      >
        <div className="grid gap-1.5">
          <Label htmlFor="job-titles">Cargos</Label>
          <Textarea
            id="job-titles"
            rows={3}
            value={draft.titles}
            placeholder={"Engenheiro de Software\nPlatform Engineer"}
            aria-invalid={shown(problems.titles) !== undefined}
            aria-describedby="job-titles-error"
            onChange={(event) => change({ titles: event.target.value })}
          />
          <EmployeeError id="job-titles-error" message={shown(problems.titles)} />
        </div>
      </EmployeePanel>
      <EmployeePanel
        title="Onde e como"
        description="Vagas fora disso saem da lista de compatíveis. Vagas sem a informação continuam."
      >
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Modelo de trabalho</legend>
          <div className="flex flex-wrap gap-4">
            {workModelOptions.map((option) => (
              <label key={option.value} className="flex min-h-9 items-center gap-2 text-sm">
                <Checkbox
                  checked={chosenModels.has(option.value)}
                  onCheckedChange={(on) =>
                    change({
                      workModels: on
                        ? [...draft.workModels, option.value]
                        : draft.workModels.filter((model) => model !== option.value),
                    })
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Nenhum marcado aceita todos.</p>
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Locais</legend>
          {draft.places.map((place, index) => (
            <div key={place.id} className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`place-state-${index}`}>UF</Label>
                <Input
                  id={`place-state-${index}`}
                  maxLength={2}
                  value={place.state}
                  onChange={(event) => setPlace(index, { ...place, state: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`place-city-${index}`}>Cidade (opcional)</Label>
                <Input
                  id={`place-city-${index}`}
                  value={place.city}
                  onChange={(event) => setPlace(index, { ...place, city: event.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => change({ places: draft.places.filter((_, at) => at !== index) })}
              >
                Remover
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => change({ places: [...draft.places, newPlace()] })}
          >
            Adicionar local
          </Button>
          <p className="text-xs text-muted-foreground">
            Sem locais, qualquer lugar serve. Vagas remotas sempre aparecem.
          </p>
          <EmployeeError message={shown(problems.places)} />
        </fieldset>
        <div className="flex items-center gap-2">
          <Switch
            id="job-relocate"
            checked={draft.relocate}
            onCheckedChange={(relocate) => change({ relocate })}
          />
          <Label htmlFor="job-relocate">Aceito me mudar (ignora os locais)</Label>
        </div>
      </EmployeePanel>
      <EmployeePanel title="Salário e empresas">
        <div className="grid gap-1.5">
          <Label htmlFor="job-salary">Salário mínimo mensal (R$)</Label>
          <Input
            id="job-salary"
            inputMode="decimal"
            className="max-w-48"
            placeholder="8.000"
            value={draft.salaryFloor}
            aria-invalid={shown(problems.salaryFloor) !== undefined}
            aria-describedby="job-salary-hint job-salary-error"
            onChange={(event) => change({ salaryFloor: event.target.value })}
          />
          <p id="job-salary-hint" className="text-xs text-muted-foreground">
            Esconde vagas cujo teto é menor. Vagas sem salário informado continuam.
          </p>
          <EmployeeError id="job-salary-error" message={shown(problems.salaryFloor)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="job-excluded">Empresas que não quero ver</Label>
          <Textarea
            id="job-excluded"
            rows={3}
            value={draft.excluded}
            placeholder="Uma por linha"
            aria-invalid={shown(problems.excluded) !== undefined}
            aria-describedby="job-excluded-error"
            onChange={(event) => change({ excluded: event.target.value })}
          />
          <EmployeeError id="job-excluded-error" message={shown(problems.excluded)} />
        </div>
      </EmployeePanel>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar preferências"}
        </Button>
        {save.isSuccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Preferências salvas. A lista de vagas já usa os novos filtros.
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
