import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { listPagination } from "@/shared/lib/list-pagination";
import { Calendar03Icon, Tick02Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Input } from "@/shared/ui/shadcn/input";
import { classProps } from "../../shared/lib/class-props";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles } from "../../shared/ui/surface.styles";

const styles = {
  planRate: "text-base font-semibold whitespace-nowrap tabular-nums",
  label: "text-sm text-muted-foreground",
  billing: "min-w-lg",
  amount: "whitespace-nowrap tabular-nums",
  badge: "text-xs font-medium text-primary",
  badgeReady: "text-foreground",
  serviceHeader: "flex flex-wrap items-start justify-between gap-2",
  planList: "mt-3 divide-y border-t",
  plan: "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-3 sm:grid-cols-3",
  planName: "text-sm font-semibold",
  planCapacity: "col-span-2 sm:col-span-1 sm:text-right",
  rateUnit: "pt-1",
  billingGrid: "grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
  invoiceList: "divide-y",
  invoice: "grid gap-1 px-3 py-3 sm:px-5",
};

const plans = [
  { name: "Silver", price: 149, active: 12, capacity: 20, area: "Tecnologia" },
  { name: "Gold", price: 249, active: 20, capacity: 30, area: "Marketing" },
  { name: "Platinum", price: 399, active: 12, capacity: 15, area: "Operações" },
  { name: "Platinum Premium", price: 699, active: 4, capacity: 5, area: "Liderança" },
];

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const beneficiaries = [
  { name: "Marina Lopes", plan: "Gold", status: "Ativo", until: "30 abr" },
  { name: "Lucas Almeida", plan: "Silver", status: "Convidado", until: "Após ativação" },
  { name: "Renata Souza", plan: "Platinum", status: "Ativo", until: "22 abr" },
  { name: "Pedro Santos", plan: "Gold", status: "Ativo", until: "31 mar" },
  { name: "Carla Mendes", plan: "Silver", status: "Expirado", until: "31 out" },
];

const beneficiaryColumns: TableColumn<(typeof beneficiaries)[number]>[] = [
  {
    id: "name",
    accessorFn: ({ name }) => name,
    header: "Pessoa",
    enableSorting: true,
    sortFn: "portugueseText",
  },
  { id: "plan", accessorFn: ({ plan }) => plan, header: "Plano" },
  { id: "until", accessorFn: ({ until }) => until, header: "Fim do acesso" },
  { id: "status", accessorFn: ({ status }) => status, header: "Status" },
];

const billingColumns: TableColumn<(typeof plans)[number]>[] = [
  {
    id: "area",
    accessorFn: ({ area }) => area,
    header: "Centro de custo",
    meta: { cellStyle: portalStyles.tableHeading },
  },
  { id: "name", accessorFn: ({ name }) => name, header: "Plano" },
  {
    id: "active",
    accessorFn: ({ active }) => active,
    header: "Acessos",
    meta: { cellStyle: styles.amount },
  },
  {
    id: "subtotal",
    accessorFn: ({ active, price }) => currency.format(active * price),
    header: "Subtotal",
    meta: { cellStyle: styles.amount },
  },
];

const route = getRouteApi("/_portal/planos-e-gastos");

export function PlansPage() {
  const navigate = route.useNavigate();
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const beneficiaryTerm = beneficiarySearch.trim().toLocaleLowerCase("pt-BR");

  const matchingBeneficiaries = beneficiaries.filter(({ name }) =>
    name.toLocaleLowerCase("pt-BR").includes(beneficiaryTerm),
  );

  const urlPagination = listPagination(
    route.useSearch(),
    (patch) =>
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        resetScroll: false,
      }),
  );

  const licensesInUse = plans.reduce((total, plan) => total + plan.active, 0);
  const licensesAvailable = plans.reduce((total, plan) => total + plan.capacity, 0);
  const monthlyTotal = plans.reduce((total, plan) => total + plan.active * plan.price, 0);

  return (
    <ListPage
      title="Planos e gastos"
      breadcrumb={<ListBreadcrumb title="Planos e gastos" />}
      metrics={[
        { label: "Licenças em uso", value: licensesInUse, icon: UserGroupIcon, tone: "success" },
        {
          label: "Licenças disponíveis",
          value: licensesAvailable - licensesInUse,
          icon: UserGroupIcon,
          tone: "primary",
        },
        {
          label: "Beneficiários",
          value: beneficiaries.length,
          icon: Tick02Icon,
          tone: "primary",
        },
        {
          label: "Gasto estimado de novembro",
          value: currency.format(monthlyTotal),
          icon: Calendar03Icon,
          tone: "warning",
        },
      ]}
    >
      <section className="min-w-0" aria-labelledby="beneficiarios-title">
        <DataTable
          urlPagination={urlPagination}
          toolbar={
            <>
              <h2
                {...classProps(portalStyles.subheading, "mr-2 w-full sm:w-auto")}
                id="beneficiarios-title"
              >
                Beneficiários
              </h2>
              <Input
                type="search"
                aria-label="Buscar beneficiários por nome"
                placeholder="Buscar por nome"
                value={beneficiarySearch}
                onChange={(event) => setBeneficiarySearch(event.currentTarget.value)}
                className="w-full max-w-sm"
              />
            </>
          }
          data={matchingBeneficiaries}
          columns={beneficiaryColumns}
          labelledBy="beneficiarios-title"
          scrollLabel="Tabela de beneficiários"
          tableStyle="min-w-lg"
          getRowId={(person) => person.name}
          emptyText="Nenhum beneficiário encontrado."
        />
      </section>
      <div {...classProps(styles.billingGrid)}>
        <section className="min-w-0" aria-labelledby="usage-title">
          <DataTable
            toolbar={
              <h2 {...classProps(portalStyles.subheading)} id="usage-title">
                Consumo de novembro
              </h2>
            }
            data={plans}
            scrollLabel="Tabela de consumo"
            columns={billingColumns}
            labelledBy="usage-title"
            getRowId={(plan) => plan.name}
            tableStyle={styles.billing}
          />
        </section>
        <section
          className="min-w-0 overflow-hidden rounded-2xl border bg-card"
          aria-labelledby="invoices-title"
        >
          <div {...classProps(portalStyles.panelHeader, "min-h-12 px-3 sm:px-5")}>
            <h2 {...classProps(portalStyles.subheading)} id="invoices-title">
              Faturas e histórico
            </h2>
          </div>
          <ul {...classProps(styles.invoiceList)}>
            <li {...classProps(styles.invoice)}>
              <div {...classProps(styles.serviceHeader)}>
                <strong>Novembro</strong>
                <Badge variant="secondary" {...classProps(styles.badge)}>
                  Em apuração
                </Badge>
              </div>
              <span {...classProps(styles.amount)}>{currency.format(monthlyTotal)}</span>
              <p {...classProps(styles.label)}>Fatura prevista para 1 dez 2026.</p>
            </li>
            <li {...classProps(styles.invoice)}>
              <div {...classProps(styles.serviceHeader)}>
                <strong>Outubro</strong>
                <Badge variant="secondary" {...classProps(styles.badge, styles.badgeReady)}>
                  Paga
                </Badge>
              </div>
              <span {...classProps(styles.amount)}>{currency.format(12107)}</span>
              <p {...classProps(styles.label)}>NF 2026-010</p>
            </li>
          </ul>
        </section>
      </div>
      <p {...classProps(styles.label)}>
        Os valores simulados se referem ao benefício contratado pela empresa.
      </p>
    </ListPage>
  );
}
