import { useListPagination } from "@/shared/lib/use-list-pagination";
import { Alert02Icon, Calendar03Icon, Tick02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { classProps } from "../../shared/lib/class-props";
import { equipmentStatus } from "./status";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles } from "../../shared/ui/surface.styles";

const styles = {
  section: "rounded-2xl border bg-card p-4 sm:p-5",
  inventory: "min-w-2xl",
  badge: "text-xs font-medium text-primary",
  badgeNeutral: "text-muted-foreground",
  badgeReady: "text-foreground",
  badgeTransit: "text-foreground",
  badgeWarning: "text-destructive",
  steps: "mt-3 list-decimal space-y-1 pl-5 text-sm",
};

type Equipment = {
  item: string;
  tag: string;
  person: string;
  method: "Coleta em casa" | "Entrega no escritório";
  date: { iso: string; label: string } | null;
  status: keyof typeof equipmentStatus;
};

const equipment: Equipment[] = [
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0412",
    person: "Marina Lopes",
    method: "Coleta em casa",
    date: { iso: "2026-11-10", label: "10 nov" },
    status: "scheduled",
  },
  {
    item: "Notebook MacBook Air M3",
    tag: "AUR-0398",
    person: "Léo Andrade",
    method: "Coleta em casa",
    date: null,
    status: "received",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0377",
    person: "Rafa Souza",
    method: "Coleta em casa",
    date: { iso: "2026-11-09", label: "9 nov" },
    status: "failed",
  },
  {
    item: "Celular Galaxy A55",
    tag: "AUR-2210",
    person: "Otávio Lima",
    method: "Entrega no escritório",
    date: null,
    status: "inventory",
  },
  {
    item: "Notebook ThinkPad T14",
    tag: "AUR-0455",
    person: "Igor Santos",
    method: "Coleta em casa",
    date: null,
    status: "transit",
  },
  {
    item: "Monitor Dell 27″",
    tag: "AUR-3104",
    person: "Igor Santos",
    method: "Coleta em casa",
    date: null,
    status: "transit",
  },
  {
    item: "Notebook MacBook Pro 14",
    tag: "AUR-0301",
    person: "Sofia Ramos",
    method: "Coleta em casa",
    date: { iso: "2026-11-12", label: "12 nov" },
    status: "withPerson",
  },
  {
    item: "Kit EPI e rádio",
    tag: "AUR-5520",
    person: "Marcos Vieira",
    method: "Entrega no escritório",
    date: null,
    status: "received",
  },
  {
    item: "Notebook Dell Latitude 5440",
    tag: "AUR-0419",
    person: "Ju Martins",
    method: "Coleta em casa",
    date: { iso: "2026-11-11", label: "11 nov" },
    status: "scheduled",
  },
];

const assetBadges = {
  scheduled: null,
  received: styles.badgeReady,
  failed: styles.badgeWarning,
  inventory: styles.badgeReady,
  transit: styles.badgeTransit,
  withPerson: styles.badgeNeutral,
};

const equipmentColumns: TableColumn<Equipment>[] = [
  {
    id: "item",
    accessorFn: ({ item }) => item,
    header: "Item",
    enableSorting: true,
    sortFn: "portugueseText",
    meta: { cellStyle: portalStyles.tableHeading },
  },
  { id: "tag", accessorFn: ({ tag }) => tag, header: "Patrimônio" },
  {
    id: "person",
    accessorFn: ({ person }) => person,
    header: "Pessoa",
    enableSorting: true,
    sortFn: "portugueseText",
  },
  { id: "method", accessorFn: ({ method }) => method, header: "Como volta" },
  {
    id: "date",
    header: "Data",
    cell: ({ row }) => {
      const { date } = row.original;

      return date ? <time dateTime={date.iso}>{date.label}</time> : "Sem data";
    },
  },
  {
    id: "status",
    header: "Situação",
    cell: ({ row }) => {
      const { status } = row.original;

      return (
        <Badge variant="secondary" {...classProps(styles.badge, assetBadges[status])}>
          {equipmentStatus[status]}
        </Badge>
      );
    },
  },
];

const route = getRouteApi("/bens-e-coleta");

export function EquipmentPage() {
  const navigate = route.useNavigate();

  const urlPagination = useListPagination(
    (patch) =>
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        resetScroll: false,
      }),
  );

  const { status: requestedStatus } = route.useSearch();

  const status = requestedStatus ?? "";

  function setStatus(next: string) {
    if (next !== status) {
      void navigate({
        search: (previous) => ({ ...previous, status: next || undefined, page: undefined }),
        resetScroll: false,
      });
    }
  }

  const visibleEquipment = useMemo(
    () => (status ? equipment.filter((entry) => entry.status === status) : equipment),
    [status],
  );

  return (
    <ListPage
      title="Bens e coleta"
      breadcrumb={<ListBreadcrumb title="Bens e coleta" />}
      metrics={[
        {
          label: "Itens no inventário",
          value: equipment.length,
          icon: UserGroupIcon,
          tone: "primary",
        },
        {
          label: "Recebidos",
          value: equipment.filter(({ status }) => status === "received" || status === "inventory")
            .length,
          icon: Tick02Icon,
          tone: "success",
        },
        {
          label: "Coletas agendadas",
          value: equipment.filter(({ status }) => status === "scheduled").length,
          icon: Calendar03Icon,
          tone: "warning",
        },
        {
          label: "Com problema",
          value: equipment.filter(({ status }) => status === "failed").length,
          icon: Alert02Icon,
          tone: "danger",
        },
      ]}
    >
      <section className="min-w-0" aria-labelledby="equipment-title">
        <h2 className="sr-only" id="equipment-title">
          Amostra do inventário
        </h2>
        <DataTable
          urlPagination={urlPagination}
          data={visibleEquipment}
          filters={[
            {
              caption: "Status da devolução",
              label: "Status da devolução",
              value: status,
              onChange: setStatus,
              items: [
                { value: "", label: "Todos os status" },
                ...Object.entries(equipmentStatus).map(([value, label]) => ({ value, label })),
              ],
            },
          ]}
          emptyText="Nenhum item neste status."
          scrollLabel="Tabela do inventário"
          columns={equipmentColumns}
          labelledBy="equipment-title"
          getRowId={(entry) => entry.tag}
          tableStyle={styles.inventory}
        />
      </section>
      <section {...classProps(styles.section)} aria-labelledby="collection-title">
        <h2 {...classProps(portalStyles.subheading)} id="collection-title">
          Como a coleta funciona
        </h2>
        <ol {...classProps(styles.steps)}>
          <li>A pessoa confirma os itens e escolhe o horário no app.</li>
          <li>A transportadora leva embalagem e etiqueta e retira o equipamento.</li>
          <li>A equipe de TI confere os itens, apaga os dados e devolve os bens ao estoque.</li>
          <li>A pessoa recebe o comprovante no app. O RH recebe um aviso.</li>
        </ol>
      </section>
    </ListPage>
  );
}
