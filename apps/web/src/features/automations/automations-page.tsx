import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  automationRulesQuery,
  useDeleteAutomationRule,
  useUpdateAutomationRule,
  type AutomationRuleRow,
} from "@/entities/automation-rule";
import { DataTable, type TableColumn } from "@/shared/ui/data-table";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Button } from "@/shared/ui/shadcn/button";
import { Switch } from "@/shared/ui/shadcn/switch";
import { portalStyles } from "@/shared/ui/surface.styles";
import { RuleDialog } from "./rule-dialog";
import { summarizeActions, triggerLabels } from "./rule-form";

export function AutomationsPage() {
  const { data: rules } = useSuspenseQuery(automationRulesQuery);

  const [editing, setEditing] = useState<AutomationRuleRow | "new" | null>(null);

  const update = useUpdateAutomationRule();
  const remove = useDeleteAutomationRule();

  const columns: TableColumn<AutomationRuleRow>[] = [
    {
      id: "name",
      accessorFn: ({ name }) => name,
      header: "Nome",
      meta: { cellStyle: portalStyles.tableHeading },
    },
    {
      id: "trigger",
      accessorFn: ({ trigger }) => triggerLabels[trigger],
      header: "Gatilho",
    },
    {
      id: "actions",
      accessorFn: ({ actions }) => summarizeActions(actions),
      header: "Ações",
    },
    {
      id: "enabled",
      accessorFn: ({ enabled }) => String(enabled),
      header: "Ativa",
      cell: ({ row }) => (
        <span onClick={(event) => event.stopPropagation()}>
          <Switch
            aria-label={`Ativar ${row.original.name}`}
            checked={row.original.enabled}
            disabled={update.isPending}
            onCheckedChange={(enabled) => update.mutate({ id: row.original.id, enabled })}
          />
        </span>
      ),
    },
    {
      id: "remove",
      accessorFn: ({ id }) => id,
      header: "Remover",
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive"
          aria-label={`Remover ${row.original.name}`}
          disabled={remove.isPending}
          onClick={(event) => {
            event.stopPropagation();

            if (window.confirm(`Remover a automação "${row.original.name}"?`)) {
              remove.mutate(row.original.id);
            }
          }}
        >
          Remover
        </Button>
      ),
    },
  ];

  return (
    <ListPage title="Automações" breadcrumb={<ListBreadcrumb title="Automações" />}>
      {(update.isError || remove.isError) && (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível atualizar a automação. Tente novamente.
        </p>
      )}
      <DataTable
        toolbar={
          <h2 className={portalStyles.subheading} id="automations-title">
            Regras
          </h2>
        }
        toolbarEnd={
          <Button type="button" size="sm" className="ml-auto" onClick={() => setEditing("new")}>
            <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
            Nova automação
          </Button>
        }
        data={rules}
        columns={columns}
        labelledBy="automations-title"
        getRowId={({ id }) => id}
        scrollLabel="Tabela de automações"
        tableStyle="min-w-2xl"
        emptyText="Nenhuma automação criada."
        onRowClick={setEditing}
      />
      {editing && (
        <RuleDialog
          key={editing === "new" ? "new" : editing.id}
          rule={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </ListPage>
  );
}
