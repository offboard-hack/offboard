import { equipmentStatus } from "./status";
import * as stylex from "@stylexjs/stylex";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { PortalFilter } from "../../shared/ui/select";
import { Metrics, PageHeading as ModuleHeading } from "../../shared/ui/page";
import { portalStyles } from "../../shared/ui/surface.styles";
import { colors } from "../../shared/ui/theme.stylex";

const styles = stylex.create({
  section: {
    padding: "1rem",
  },
  separated: {
    marginTop: "1rem",
  },
  inventory: {
    minWidth: "42rem",
  },
  badge: {
    display: "inline-block",
    borderRadius: "1rem",
    padding: "0.25rem 0.5rem",
    color: colors.brandHover,
    backgroundColor: colors.lavenderSoft,
    fontSize: "0.75rem",
    fontWeight: 650,
    lineHeight: 1.3,
  },
  badgeNeutral: {
    color: colors.muted,
    backgroundColor: colors.wash,
  },
  badgeReady: {
    color: colors.successInk,
    backgroundColor: colors.successSurface,
  },
  badgeTransit: {
    color: colors.infoInk,
    backgroundColor: colors.infoSurface,
  },
  badgeWarning: {
    color: colors.dangerInk,
    backgroundColor: colors.dangerSurface,
  },
  steps: {
    paddingInlineStart: "1.25rem",
    marginBlock: "0.75rem 0",
    lineHeight: 1.65,
    fontSize: "0.875rem",
  },
});

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
        <span {...stylex.props(styles.badge, assetBadges[status])}>{equipmentStatus[status]}</span>
      );
    },
  },
];

const route = getRouteApi("/bens-e-coleta");

export function EquipmentPage() {
  const { status: requestedStatus } = route.useSearch();
  const navigate = route.useNavigate();

  const status = requestedStatus ?? "";

  function setStatus(next: string) {
    if (next !== status) {
      void navigate({ search: { status: next || undefined }, resetScroll: false });
    }
  }

  const visibleEquipment = useMemo(
    () => (status ? equipment.filter((entry) => entry.status === status) : equipment),
    [status],
  );

  return (
    <>
      <ModuleHeading
        title="Bens e coleta"
        description="Acompanhe a devolução dos equipamentos até a conferência no estoque."
      />
      <Metrics
        items={[
          { label: "Itens a recuperar", value: 41, detail: "R$ 168 mil em bens" },
          { label: "Recebidos", value: 18, detail: "11 já conferidos no estoque" },
          { label: "Coletas agendadas", value: 12 },
          { label: "Com problema", value: 2, tone: "danger" },
        ]}
      />
      <section {...stylex.props(portalStyles.panel)} aria-labelledby="equipment-title">
        <div {...stylex.props(portalStyles.panelHeader)}>
          <h2 {...stylex.props(portalStyles.subheading)} id="equipment-title">
            Amostra do inventário
          </h2>
          <span role="status" {...stylex.props(portalStyles.resultCount)}>
            {visibleEquipment.length} {visibleEquipment.length === 1 ? "item" : "itens"}
          </span>
        </div>
        <div {...stylex.props(portalStyles.filterBar)}>
          <PortalFilter
            label="Status da devolução"
            value={status}
            onChange={setStatus}
            items={[
              { value: "", label: "Todos os status" },
              ...Object.entries(equipmentStatus).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        <DataTable
          data={visibleEquipment}
          emptyText="Nenhum item neste status."
          scrollLabel="Tabela do inventário"
          columns={equipmentColumns}
          labelledBy="equipment-title"
          getRowId={(entry) => entry.tag}
          tableStyle={styles.inventory}
        />
      </section>
      <section
        {...stylex.props(portalStyles.panel, styles.section, styles.separated)}
        aria-labelledby="collection-title"
      >
        <h2 {...stylex.props(portalStyles.subheading)} id="collection-title">
          Como a coleta funciona
        </h2>
        <ol {...stylex.props(styles.steps)}>
          <li>A pessoa confirma os itens e escolhe o horário no app.</li>
          <li>A transportadora leva embalagem e etiqueta e retira o equipamento.</li>
          <li>A equipe de TI confere os itens, apaga os dados e devolve os bens ao estoque.</li>
          <li>A pessoa recebe o comprovante no app. O RH recebe um aviso.</li>
        </ol>
      </section>
    </>
  );
}
