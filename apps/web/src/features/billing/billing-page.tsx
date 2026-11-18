import * as stylex from "@stylexjs/stylex";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { Metrics, PageHeading as ModuleHeading } from "../../shared/ui/page";
import { portalStyles } from "../../shared/ui/surface.styles";
import { colors } from "../../shared/ui/theme.stylex";

const styles = stylex.create({
  planRate: {
    color: colors.ink,
    fontSize: "1.125rem",
    fontWeight: 680,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  label: {
    color: colors.muted,
    fontSize: "0.8125rem",
    lineHeight: 1.45,
  },
  separated: {
    marginTop: "1rem",
  },
  billing: {
    minWidth: "30rem",
  },
  amount: {
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
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
  badgeReady: {
    color: colors.successInk,
    backgroundColor: colors.successSurface,
  },
  serviceHeader: {
    display: "flex",
    alignItems: "start",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  planList: {
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colors.border,
    paddingBlockStart: "0.5rem",
  },
  plan: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) minmax(0, 1.25fr) minmax(0, 1fr)",
      "@media (max-width: 37rem)": "minmax(0, 1fr) auto",
    },
    alignItems: "baseline",
    rowGap: "0.25rem",
    columnGap: "1rem",
    paddingBlock: "0.75rem",
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: colors.border,
  },
  planName: { fontSize: "0.9375rem", fontWeight: 650 },
  planCapacity: {
    textAlign: { default: "end", "@media (max-width: 37rem)": "start" },
    gridColumn: { default: "auto", "@media (max-width: 37rem)": "1 / -1" },
  },
  rateUnit: { paddingBlockStart: "0.25rem" },
  billingNote: { paddingBlockStart: "1rem" },
  billingGrid: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1.65fr) minmax(0, 1fr)",
      "@media (max-width: 70rem)": "minmax(0, 1fr)",
    },
    alignItems: "start",
    gap: "1rem",
  },
  invoiceList: {
    display: "grid",
    padding: 0,
    margin: 0,
    listStyle: "none",
  },
  invoice: {
    display: "grid",
    gap: "0.4rem",
    padding: "0.875rem 1rem",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
});

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

export function PlansPage() {
  const licensesInUse = plans.reduce((total, plan) => total + plan.active, 0);
  const licensesAvailable = plans.reduce((total, plan) => total + plan.capacity, 0);
  const monthlyTotal = plans.reduce((total, plan) => total + plan.active * plan.price, 0);

  return (
    <>
      <ModuleHeading
        title="Planos e gastos"
        description="Consulte o contrato, as licenças e os valores simulados dos acessos ativados."
      />
      <Metrics
        items={[
          { label: "Contrato Aurora", value: "Vigente", detail: "1 nov 2026 a 31 out 2027" },
          {
            label: "Licenças em uso",
            value: `${licensesInUse} de ${licensesAvailable}`,
            detail: `${licensesAvailable - licensesInUse} disponíveis`,
          },
          {
            label: "Gasto de novembro",
            value: currency.format(monthlyTotal),
            detail: "Estimativa ilustrativa",
          },
        ]}
      />
      <section aria-labelledby="plans-title">
        <h2 {...stylex.props(portalStyles.subheading)} id="plans-title">
          Planos contratados
        </h2>
        <p {...stylex.props(styles.label, styles.rateUnit)}>Tarifa mensal por acesso ativado.</p>
        <dl {...stylex.props(styles.planList)}>
          {plans.map((plan) => (
            <div {...stylex.props(styles.plan)} key={plan.name}>
              <dt {...stylex.props(styles.planName)}>{plan.name}</dt>
              <dd {...stylex.props(styles.planRate)}>{currency.format(plan.price)}</dd>
              <dd {...stylex.props(styles.label, styles.planCapacity)}>
                {plan.active} em uso · {plan.capacity - plan.active} disponíveis
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <div {...stylex.props(styles.billingGrid, styles.separated)}>
        <section {...stylex.props(portalStyles.panel)} aria-labelledby="usage-title">
          <div {...stylex.props(portalStyles.panelHeader)}>
            <h2 {...stylex.props(portalStyles.subheading)} id="usage-title">
              Consumo de novembro
            </h2>
          </div>
          <DataTable
            data={plans}
            scrollLabel="Tabela de consumo"
            columns={billingColumns}
            labelledBy="usage-title"
            getRowId={(plan) => plan.name}
            tableStyle={styles.billing}
          />
        </section>
        <section {...stylex.props(portalStyles.panel)} aria-labelledby="invoices-title">
          <div {...stylex.props(portalStyles.panelHeader)}>
            <h2 {...stylex.props(portalStyles.subheading)} id="invoices-title">
              Faturas e histórico
            </h2>
          </div>
          <ul {...stylex.props(styles.invoiceList)}>
            <li {...stylex.props(styles.invoice)}>
              <div {...stylex.props(styles.serviceHeader)}>
                <strong>Novembro</strong>
                <span {...stylex.props(styles.badge)}>Em apuração</span>
              </div>
              <span {...stylex.props(styles.amount)}>{currency.format(monthlyTotal)}</span>
              <p {...stylex.props(styles.label)}>Fatura prevista para 1 dez 2026.</p>
            </li>
            <li {...stylex.props(styles.invoice)}>
              <div {...stylex.props(styles.serviceHeader)}>
                <strong>Outubro</strong>
                <span {...stylex.props(styles.badge, styles.badgeReady)}>Paga</span>
              </div>
              <span {...stylex.props(styles.amount)}>{currency.format(12107)}</span>
              <p {...stylex.props(styles.label)}>NF 2026-010</p>
            </li>
          </ul>
        </section>
      </div>
      <p {...stylex.props(styles.label, styles.billingNote)}>
        Os valores simulados se referem ao benefício contratado pela empresa.
      </p>
    </>
  );
}
