import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { listPagination } from "@/shared/lib/list-pagination";
import { Alert02Icon, Calendar03Icon, Tick02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { classProps } from "../../shared/lib/class-props";
import { getTrackingStatus, equipmentStatus, trackingStatus } from "./status";
import { formatShortDeadline, offboardingsQuery, taskTrackingQuery } from "@/entities/offboarding";
import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
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
  trackingNone: "bg-muted text-muted-foreground",
  trackingWaiting: "bg-muted text-muted-foreground",
  trackingTransit: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200",
  trackingDelivered: "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200",
  code: "font-mono text-xs",
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

type Shipment = {
  id: string;
  title: string;
  person: string;
  trackingCode: string | null;
  status: keyof typeof trackingStatus;
  date: { iso: string; label: string } | null;
};

const trackingBadges = {
  none: styles.trackingNone,
  loading: styles.trackingNone,
  unavailable: styles.trackingNone,
  waiting: styles.trackingWaiting,
  transit: styles.trackingTransit,
  delivered: styles.trackingDelivered,
};

const shipmentColumns: TableColumn<Shipment>[] = [
  {
    id: "title",
    accessorFn: ({ title }) => title,
    header: "Tarefa",
    enableSorting: true,
    sortFn: "portugueseText",
    meta: { cellStyle: portalStyles.tableHeading },
  },
  {
    id: "person",
    accessorFn: ({ person }) => person,
    header: "Pessoa",
    enableSorting: true,
    sortFn: "portugueseText",
  },
  {
    id: "trackingCode",
    header: "Código de rastreio",
    cell: ({ row }) => {
      const { trackingCode } = row.original;

      return trackingCode ? <span {...classProps(styles.code)}>{trackingCode}</span> : "—";
    },
  },
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
    header: "Rastreio",
    cell: ({ row }) => {
      const { status } = row.original;

      if (status === "loading") {
        return (
          <>
            <Skeleton aria-hidden="true" className="h-5 w-24 rounded-full" />
            <span className="sr-only">Consultando rastreio</span>
          </>
        );
      }

      return (
        <Badge variant="secondary" {...classProps(styles.badge, trackingBadges[status])}>
          {trackingStatus[status]}
        </Badge>
      );
    },
  },
];

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

const route = getRouteApi("/_portal/bens-e-coleta");

export function EquipmentPage() {
  const navigate = route.useNavigate();

  const urlPagination = listPagination(
    route.useSearch(),
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

  const { data: cases } = useSuspenseQuery(offboardingsQuery);

  const tasks = useMemo(
    () =>
      cases.flatMap((entry) =>
        entry.tasks
          .filter((task) => task.trackingCode)
          .map((task) => ({ task, person: entry.name })),
      ),
    [cases],
  );

  const trackings = useQueries({
    queries: tasks.map(({ task }) => taskTrackingQuery(task.id)),
  });

  const shipments: Shipment[] = tasks.map(({ task, person }, index) => {
    const tracking = trackings[index]?.data?.tracking;
    const iso = tracking?.lastUpdate || task.dueDate;

    return {
      id: task.id,
      title: task.title,
      person,
      trackingCode: task.trackingCode,
      status:
        trackings[index]?.isError && !tracking
          ? "unavailable"
          : getTrackingStatus(task.trackingCode, tracking),
      date: iso ? { iso, label: formatShortDeadline(iso) } : null,
    };
  });

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
      <section className="min-w-0" aria-labelledby="shipments-title">
        <h2 {...classProps(portalStyles.subheading)} id="shipments-title">
          Rastreio dos envios
        </h2>
        <DataTable
          data={shipments}
          emptyText="Nenhum envio com código de rastreio."
          scrollLabel="Tabela de envios"
          columns={shipmentColumns}
          labelledBy="shipments-title"
          getRowId={(entry) => entry.id}
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
