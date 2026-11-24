import { Add01Icon, Delete02Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  automationRulesQuery,
  useAutomationRuleMutations,
  type AutomationRule,
} from "@/entities/automation-rule";
import { DataTable, type TableColumn } from "@/shared/ui/data-table";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { Switch } from "@/shared/ui/shadcn/switch";
import { RuleDialog } from "./rule-dialog";
import { summarizeActions, triggerLabels } from "./rule-form";

type Editing = AutomationRule | "new" | null;

export function AutomationsPage() {
  const { data: rules } = useSuspenseQuery(automationRulesQuery);
  const { create, update, remove } = useAutomationRuleMutations();
  const [editing, setEditing] = useState<Editing>(null);

  const failed = update.isError || remove.isError;

  const columns: TableColumn<AutomationRule>[] = [
    { id: "name", accessorFn: ({ name }) => name, header: "Automação" },
    {
      id: "trigger",
      accessorFn: ({ trigger }) => triggerLabels[trigger],
      header: "Gatilho",
      cell: ({ row: { original } }) => (
        <span className="grid gap-1">
          <span>{triggerLabels[original.trigger]}</span>
          {original.cronSchedule && (
            <Badge variant="secondary" className="w-fit font-mono">
              {original.cronSchedule}
            </Badge>
          )}
        </span>
      ),
    },
    {
      id: "actions",
      accessorFn: ({ actions }) => summarizeActions(actions),
      header: "Ações",
    },
    {
      id: "enabled",
      accessorFn: ({ enabled }) => (enabled ? "Ativa" : "Inativa"),
      header: "Status",
      cell: ({ row: { original } }) => (
        <Switch
          checked={original.enabled}
          disabled={update.isPending}
          aria-label={`${original.enabled ? "Desativar" : "Ativar"} ${original.name}`}
          onCheckedChange={(enabled) => update.mutate({ id: original.id, enabled })}
        />
      ),
    },
    {
      id: "controls",
      header: "Ações da regra",
      enableSorting: false,
      cell: ({ row: { original } }) => (
        <span className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Editar ${original.name}`}
            onClick={() => setEditing(original)}
          >
            <HugeiconsIcon icon={Edit02Icon} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Excluir ${original.name}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(original.id)}
          >
            <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <ListPage title="Automações" breadcrumb={<ListBreadcrumb title="Automações" />}>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível atualizar a automação. Tente novamente.
        </p>
      )}
      <section className="min-w-0" aria-labelledby="automacoes">
        <DataTable
          toolbar={
            <h2 id="automacoes" className="text-base font-semibold">
              Regras de automação
            </h2>
          }
          toolbarEnd={
            <Button type="button" onClick={() => setEditing("new")}>
              <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
              Nova automação
            </Button>
          }
          data={rules}
          columns={columns}
          labelledBy="automacoes"
          scrollLabel="Tabela de automações"
          tableStyle="min-w-3xl"
          emptyText="Nenhuma automação configurada."
          getRowId={(rule) => rule.id}
        />
      </section>
      {editing && (
        <RuleDialog
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={(values) =>
            editing === "new"
              ? create.mutateAsync(values)
              : update.mutateAsync({ id: editing.id, ...values })
          }
        />
      )}
    </ListPage>
  );
}
