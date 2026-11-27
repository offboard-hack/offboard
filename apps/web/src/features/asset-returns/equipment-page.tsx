import { Skeleton } from "@/shared/ui/shadcn/skeleton";
import { listPagination } from "@/shared/lib/list-pagination";
import { Alert02Icon, Calendar03Icon, Tick02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { classProps } from "../../shared/lib/class-props";
import { getTrackingStatus, trackingStatus } from "./status";
import { formatShortDeadline, offboardingsQuery, taskTrackingQuery } from "@/entities/offboarding";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles } from "../../shared/ui/surface.styles";

import { createPortalAbility } from "@offboard/access";
import { employeeDate } from "@offboard/employee";
import {
  collectionAddressQuery,
  equipmentReturnsQuery,
  equipmentStatus,
  getEquipmentStatus,
  updateEquipmentReceipt,
  type EquipmentReturn,
} from "@/entities/equipment-returns";
import { Button } from "@/shared/ui/shadcn/button";
import { AssignEquipmentDialog, EquipmentDialog, RemoveEquipmentDialog } from "./equipment-dialog";
import { EquipmentImportDialog } from "./equipment-import-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/shadcn/dialog";

const styles = {
  section: "rounded-2xl border bg-card p-4 sm:p-5",
  inventory: "min-w-2xl",
  badge: "text-xs font-medium text-primary",
  badgeNeutral: "text-muted-foreground",
  badgeReady: "text-foreground",
  trackingNone: "bg-muted text-muted-foreground",
  trackingWaiting: "bg-muted text-muted-foreground",
  trackingTransit: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200",
  trackingDelivered: "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-200",
  code: "font-mono text-xs",
  steps: "mt-3 list-decimal space-y-1 pl-5 text-sm",
};

const assetBadges = {
  scheduled: null,
  received: styles.badgeReady,
  inventory: styles.badgeReady,
  transit: styles.badgeReady,
  failed: "text-destructive",
  withPerson: styles.badgeNeutral,
};

const methods = { pickup: "Coleta em casa", office: "Entrega no escritório" };
const slots = { morning: "9h às 12h", afternoon: "13h às 17h" };

function CollectionAddress({ caseId }: { caseId: string }) {
  const address = useQuery(collectionAddressQuery(caseId));

  if (address.isPending) return <p role="status">Carregando endereço…</p>;

  if (address.isError)
    return (
      <div className="space-y-2">
        <p role="alert">Não foi possível carregar o endereço.</p>
        <Button variant="outline" onClick={() => void address.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );

  return <p className="wrap-anywhere">{address.data.address ?? "Endereço indisponível."}</p>;
}

function CollectionDetails({ item, caseId }: { item: EquipmentReturn; caseId: string }) {
  const [open, setOpen] = useState(false);
  const { person, schedule } = item;

  if (!schedule) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            aria-label={`Ver agendamento de ${item.code}`}
          />
        }
      >
        {methods[schedule.method]}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{methods[schedule.method]}</DialogTitle>
          <DialogDescription>{person}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <p className="font-semibold">
            {employeeDate(schedule.day, { day: "numeric", month: "long", year: "numeric" })}
            {" · "}
            {schedule.slot ? slots[schedule.slot] : null}
          </p>
          {open ? <CollectionAddress caseId={caseId} /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptAction({ item, caseId }: { item: EquipmentReturn; caseId: string }) {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => updateEquipmentReceipt({ caseId, code: item.code, received: !item.received }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: equipmentReturnsQuery.queryKey }),
        client.invalidateQueries({ queryKey: offboardingsQuery.queryKey }),
      ]);
    },
  });

  const label = item.received ? "Desfazer recebimento" : "Confirmar recebimento";

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        aria-label={`${label} de ${item.code}`}
      >
        {mutation.isPending ? "Salvando…" : label}
      </Button>
      {mutation.isError ? (
        <p role="alert" className="max-w-44 whitespace-normal text-destructive">
          {mutation.error.message}
        </p>
      ) : null}
    </div>
  );
}

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

type CaseOption = { id: string; name: string };

function equipmentColumns(canUpdate: boolean, cases: CaseOption[]) {
  const columns: TableColumn<EquipmentReturn>[] = [
    {
      id: "item",
      accessorFn: ({ title, model }) => [title, model].filter(Boolean).join(" · "),
      header: "Item",
      enableSorting: true,
      sortFn: "portugueseText",
      meta: { cellStyle: portalStyles.tableHeading },
    },
    { id: "tag", accessorFn: ({ code }) => code, header: "Patrimônio" },
    {
      id: "person",
      accessorFn: ({ person, holderEmail }) => person ?? holderEmail ?? "",
      header: "Pessoa",
      enableSorting: true,
      sortFn: "portugueseText",
      cell: ({ row: { original } }) =>
        original.caseId ? (
          <Link
            className="underline-offset-4 hover:underline"
            to="/desligamentos/$caseId"
            params={{ caseId: original.caseId }}
          >
            {original.person}
          </Link>
        ) : (
          <span className="text-muted-foreground">
            {original.holderEmail ? `Aguardando ${original.holderEmail}` : "Em estoque"}
          </span>
        ),
    },
    {
      id: "method",
      header: "Como volta",
      cell: ({ row: { original } }) =>
        original.caseId && original.schedule && original.addressAvailable && canUpdate ? (
          <CollectionDetails item={original} caseId={original.caseId} />
        ) : (
          methods[original.method]
        ),
    },
    {
      id: "date",
      header: "Agendamento",
      cell: ({
        row: {
          original: { schedule },
        },
      }) =>
        schedule ? (
          <time dateTime={schedule.day}>
            {formatShortDeadline(schedule.day)}
            {schedule.slot ? ` · ${slots[schedule.slot]}` : null}
          </time>
        ) : (
          "Sem data"
        ),
    },
    {
      id: "status",
      header: "Situação",
      cell: ({ row }) => {
        const status = getEquipmentStatus(row.original);

        return (
          <Badge variant="secondary" {...classProps(styles.badge, assetBadges[status])}>
            {!row.original.caseId && status === "withPerson"
              ? "Sem desligamento"
              : equipmentStatus[status]}
          </Badge>
        );
      },
    },
    ...(canUpdate
      ? [
          {
            id: "receipt",
            header: "Recebimento",
            cell: ({ row }) =>
              row.original.status === "inventory" || !row.original.caseId ? null : (
                <ReceiptAction item={row.original} caseId={row.original.caseId} />
              ),
          } satisfies TableColumn<EquipmentReturn>,
          {
            id: "manage",
            header: "Cadastro",
            cell: ({ row: { original } }) =>
              original.fromEmployeePlan ? (
                <span className="text-xs text-muted-foreground">Plano da pessoa</span>
              ) : (
                <div className="flex gap-1">
                  {!original.caseId && <AssignEquipmentDialog item={original} />}
                  <EquipmentDialog cases={cases} item={original} />
                  <RemoveEquipmentDialog item={original} />
                </div>
              ),
          } satisfies TableColumn<EquipmentReturn>,
        ]
      : []),
  ];

  return columns;
}

const route = getRouteApi("/_portal/bens-e-coleta");

export function EquipmentPage() {
  const navigate = route.useNavigate();
  const { principal } = route.useRouteContext();
  const canUpdate = createPortalAbility(principal.role).can("update", "Offboarding");

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
  const { data: equipment } = useSuspenseQuery(equipmentReturnsQuery);

  const caseOptions = useMemo(
    () =>
      cases
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [cases],
  );

  const columns = useMemo(() => equipmentColumns(canUpdate, caseOptions), [canUpdate, caseOptions]);

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
    () => (status ? equipment.filter((entry) => getEquipmentStatus(entry) === status) : equipment),
    [equipment, status],
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
          value: equipment.filter(({ received }) => received).length,
          icon: Tick02Icon,
          tone: "success",
        },
        {
          label: "Devoluções agendadas",
          value: equipment.filter((item) => getEquipmentStatus(item) === "scheduled").length,
          icon: Calendar03Icon,
          tone: "warning",
        },
        {
          label: "Com problema",
          value: equipment.filter((item) => item.status === "failed").length,
          icon: Alert02Icon,
          tone: "danger",
        },
      ]}
    >
      <section className="min-w-0" aria-labelledby="equipment-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 {...classProps(portalStyles.subheading)} id="equipment-title">
            Inventário de bens
          </h2>
          {canUpdate && (
            <div className="flex flex-wrap gap-2">
              <EquipmentImportDialog />
              <EquipmentDialog cases={caseOptions} />
            </div>
          )}
        </div>
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
          emptyText={
            status
              ? "Nenhum item neste status."
              : canUpdate
                ? "Nenhum bem cadastrado. Use “Adicionar bem” para registrar um item e vinculá-lo a um desligamento."
                : "O inventário mostra os bens vinculados aos desligamentos."
          }
          scrollLabel="Tabela do inventário"
          columns={columns}
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
          <li>O RH informa os itens e disponibiliza datas na área do colaborador do caso.</li>
          <li>A pessoa escolhe uma data para coleta em casa ou entrega no escritório.</li>
          <li>A equipe confere os bens e registra cada recebimento no inventário.</li>
        </ol>
      </section>
    </ListPage>
  );
}
