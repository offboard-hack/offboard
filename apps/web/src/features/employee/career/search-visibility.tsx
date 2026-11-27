import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { careerProfileQuery, useSetSearchable } from "@/entities/career";
import type { EmployeeAccount } from "@/entities/employee";
import { Label } from "@/shared/ui/shadcn/label";
import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { Switch } from "@/shared/ui/shadcn/switch";
import { EmployeeError, EmployeePanel } from "../ui";

export const searchableLabel = "Aparecer na busca pública de candidatos";

export const searchableHint =
  "Qualquer pessoa pode encontrar seu nome, cargo, cidade, experiências, competências e idiomas na busca de candidatos da Offboard. E-mail, telefone e links ficam ocultos. Você pode desligar quando quiser em Preferências.";

export function SearchableSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <Label htmlFor={id}>{searchableLabel}</Label>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {searchableHint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onCheckedChange={onChange}
      />
    </div>
  );
}

export function SearchVisibility({ account }: { account: EmployeeAccount }) {
  const profile = useQuery(careerProfileQuery(account));
  const save = useSetSearchable(account);

  return (
    <EmployeePanel title="Visibilidade do currículo">
      {profile.data ? (
        <SearchableSwitch
          checked={save.isPending ? save.variables : profile.data.searchable}
          disabled={save.isPending}
          onChange={(searchable) => save.mutate(searchable)}
        />
      ) : (
        <Skeleton className="h-12 w-full" />
      )}
      <EmployeeError message={profile.error?.message ?? save.error?.message} />
    </EmployeePanel>
  );
}
