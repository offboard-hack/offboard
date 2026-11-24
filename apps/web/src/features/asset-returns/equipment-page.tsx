import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { listPagination } from "@/shared/lib/list-pagination";
import {
  Alert02Icon,
  Calendar03Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  Search01Icon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { classProps } from "../../shared/lib/class-props";
import {
  equipmentReturnMethod,
  equipmentStatus,
  equipmentStatusValues,
  getTrackingStatus,
  trackingStatus,
} from "./status";
import { AddEquipmentDialog } from "./add-equipment-dialog";
import type { NewEquipmentInput } from "./add-equipment-dialog";
import { formatShortDeadline, offboardingsQuery, taskTrackingQuery } from "@/entities/offboarding";
import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/shadcn/dropdown-menu";
import { getRouteApi } from "@tanstack/react-router";
import {
  equipmentQuery,
  useCreateEquipment,
  useDeleteEquipment,
  useUpdateEquipment,
} from "@/entities/equipment";
import type { EquipmentRow, EquipmentStatus } from "@/entities/equipment";
import { createPortalAbility } from "@offboard/access";
import { useMemo, useState } from "react";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles } from "../../shared/ui/surface.styles";

const styles = {
  section: "rounded-2xl border bg-card p-4 sm:p-5",
  inventory: "min-w-2xl",
  badge: "text-xs font-medium",
  statusInUse: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200",
  statusPendingReturn: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200",
  statusInTransit: "bg-orange-100 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200",
  statusReceived: "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200",
  statusInInventory: "bg-muted text-muted-foreground",
  statusDecommissioned: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-200",
  trackingNone: "bg-muted text-muted-foreground",
  trackingWaiting: "bg-muted text-muted-foreground",
  trackingTransit: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200",
  trackingDelivered: "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200",
  code: "font-mono text-xs",
  steps: "mt-3 list-decimal space-y-1 pl-5 text-sm",
};

const statusBadges: Record<EquipmentStatus, string> = {
  in_use: styles.statusInUse,
  pending_return: styles.statusPendingReturn,
  in_transit: styles.statusInTransit,
  received: styles.statusReceived,
  in_inventory: styles.statusInInventory,
  decommissioned: styles.statusDecommissioned,
};

const removableStatuses: EquipmentStatus[] = ["in_inventory", "decommissioned"];

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

const route = getRouteApi("/_portal/bens-e-coleta");
const portalRoute = getRouteApi("/_portal");

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

  const [search, setSearch] = useState("");

  const { principal } = portalRoute.useRouteContext();
  const ability = createPortalAbility(principal.role);
  const canUpdate = ability.can("update", "Offboarding");
  const canManage = ability.can("manage", "all");

  function setStatus(next: string) {
    if (next !== status) {
      const nextStatus = equipmentStatusValues.find((value) => value === next);

      void navigate({
        search: (previous) => ({ ...previous, status: nextStatus, page: undefined }),
        resetScroll: false,
      });
    }
  }

  const { data: cases } = useSuspenseQuery(offboardingsQuery);

  const { data: equipment } = useSuspenseQuery(equipmentQuery());

  const create = useCreateEquipment();
  const update = useUpdateEquipment();
  const remove = useDeleteEquipment();

  async function addEquipment({ item, tag, serialNumber }: NewEquipmentInput) {
    await create.mutateAsync({ item, tag, ...(serialNumber && { serialNumber }) });
  }

  function changeStatus(id: string, next: EquipmentStatus) {
    update.mutate({
      id,
      changes:
        next === "in_inventory"
          ? { status: next, assignedTo: null, assignedEmail: null, caseId: null, taskId: null }
          : { status: next },
    });
  }

  const equipmentColumns: TableColumn<EquipmentRow>[] = [
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
      id: "assignedTo",
      accessorFn: ({ assignedTo }) => assignedTo ?? "—",
      header: "Responsável",
      enableSorting: true,
      sortFn: "portugueseText",
    },
    {
      id: "status",
      header: "Situação",
      cell: ({ row }) => {
        const { status: rowStatus } = row.original;

        return (
          <Badge variant="secondary" {...classProps(styles.badge, statusBadges[rowStatus])}>
            {equipmentStatus[rowStatus]}
          </Badge>
        );
      },
    },
    {
      id: "method",
      accessorFn: ({ returnMethod }) => (returnMethod ? equipmentReturnMethod[returnMethod] : "—"),
      header: "Como volta",
    },
    {
      id: "tracking",
      header: "Rastreio",
      cell: ({ row }) => {
        const { trackingCode } = row.original;

        return trackingCode ? <span {...classProps(styles.code)}>{trackingCode}</span> : "—";
      },
    },
    {
      id: "actions",
      header: "Ações",
      cell: ({ row: { original } }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Ações para ${original.item} ${original.tag}`}
                disabled={update.isPending || remove.isPending}
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {equipmentStatusValues
              .filter((value) => value !== original.status)
              .map((value) => (
                <DropdownMenuItem key={value} onClick={() => changeStatus(original.id, value)}>
                  Marcar como {equipmentStatus[value].toLowerCase()}
                </DropdownMenuItem>
              ))}
            {canManage && removableStatuses.includes(original.status) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(original.id)}>
                  <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                  Excluir do inventário
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

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

  const visibleEquipment = useMemo(() => {
    const term = search.trim().toLowerCase();

    return equipment.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!term ||
          entry.item.toLowerCase().includes(term) ||
          entry.tag.toLowerCase().includes(term)),
    );
  }, [equipment, status, search]);

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
          label: "No estoque",
          value: equipment.filter(({ status: value }) => value === "in_inventory").length,
          icon: Tick02Icon,
          tone: "success",
        },
        {
          label: "Devoluções em andamento",
          value: equipment.filter(
            ({ status: value }) => value === "pending_return" || value === "in_transit",
          ).length,
          icon: Calendar03Icon,
          tone: "warning",
        },
        {
          label: "Baixados",
          value: equipment.filter(({ status: value }) => value === "decommissioned").length,
          icon: Alert02Icon,
          tone: "danger",
        },
      ]}
    >
      <section className="min-w-0" aria-labelledby="equipment-title">
        <h2 className="sr-only" id="equipment-title">
          Inventário de equipamentos
        </h2>
        {(create.isError || update.isError || remove.isError) && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            Não foi possível salvar a alteração. Atualize a página e tente novamente.
          </p>
        )}
        <DataTable
          urlPagination={urlPagination}
          data={visibleEquipment}
          toolbar={
            <div className="relative w-full sm:w-72">
              <HugeiconsIcon
                icon={Search01Icon}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label="Buscar por item ou patrimônio"
                placeholder="Buscar por item ou patrimônio"
                value={search}
                onChange={(event) => {
                  setSearch(event.currentTarget.value);
                  urlPagination.onChange({ ...urlPagination, pageIndex: 0 });
                }}
                className="h-9 pl-9"
              />
            </div>
          }
          toolbarEnd={canManage && <AddEquipmentDialog onAdd={addEquipment} />}
          filters={[
            {
              caption: "Situação",
              label: "Situação do equipamento",
              value: status,
              onChange: setStatus,
              items: [
                { value: "", label: "Todas as situações" },
                ...equipmentStatusValues.map((value) => ({ value, label: equipmentStatus[value] })),
              ],
            },
          ]}
          emptyText="Nenhum item corresponde aos filtros."
          scrollLabel="Tabela do inventário"
          columns={
            canUpdate ? equipmentColumns : equipmentColumns.filter(({ id }) => id !== "actions")
          }
          labelledBy="equipment-title"
          getRowId={(entry) => entry.id}
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
