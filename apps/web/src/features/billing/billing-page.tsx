import {
  Calendar03Icon,
  CreditCardIcon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import {
  invoicesQuery,
  plansQuery,
  subscriptionQuery,
  useCheckout,
  type InvoiceRow,
  type PlanRow,
} from "@/entities/billing";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import { classProps } from "../../shared/lib/class-props";
import { DataTable } from "../../shared/ui/data-table";
import type { TableColumn } from "../../shared/ui/data-table";
import { portalStyles } from "../../shared/ui/surface.styles";

const styles = {
  label: "text-sm text-muted-foreground",
  amount: "whitespace-nowrap tabular-nums",
  badge: "text-xs font-medium",
  serviceHeader: "flex flex-wrap items-start justify-between gap-2",
  billingGrid: "grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
  invoiceList: "divide-y",
  invoice: "grid gap-1 px-3 py-3 sm:px-5",
  invoiceFooter: "flex flex-wrap items-center justify-between gap-2",
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" });

const monthFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const invoiceStatuses = {
  pending: { label: "Pendente", variant: "status-warning" },
  paid: { label: "Paga", variant: "status-success" },
  failed: { label: "Falhou", variant: "status-danger" },
  refunded: { label: "Reembolsada", variant: "secondary" },
} satisfies Record<
  InvoiceRow["status"],
  { label: string; variant: ComponentProps<typeof Badge>["variant"] }
>;

export function formatCents(cents: number) {
  return currency.format(cents / 100);
}

function formatDate(date: string) {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

const planColumns: TableColumn<PlanRow>[] = [
  {
    id: "name",
    accessorFn: ({ name }) => name,
    header: "Plano",
    meta: { cellStyle: portalStyles.tableHeading },
  },
  {
    id: "price",
    accessorFn: ({ monthlyPriceCents }) => formatCents(monthlyPriceCents),
    header: "Valor mensal",
    meta: { cellStyle: styles.amount },
  },
  {
    id: "capacity",
    accessorFn: ({ maxEmployees }) => maxEmployees,
    header: "Capacidade",
    meta: { cellStyle: styles.amount },
  },
  {
    id: "features",
    accessorFn: ({ features }) => features.join(" · "),
    header: "Recursos",
  },
];

export function PlansPage() {
  const { data: plans } = useSuspenseQuery(plansQuery);
  const { data: subscription } = useSuspenseQuery(subscriptionQuery);
  const { data: invoices } = useSuspenseQuery(invoicesQuery);
  const checkout = useCheckout();

  const pending = invoices.filter((invoice) => invoice.status === "pending");
  const pendingTotal = pending.reduce((total, invoice) => total + invoice.amountCents, 0);
  const nextDue = pending.map((invoice) => invoice.dueDate).sort()[0];

  return (
    <ListPage
      title="Planos e gastos"
      breadcrumb={<ListBreadcrumb title="Planos e gastos" />}
      metrics={[
        {
          label: "Plano atual",
          value: subscription?.plan.name ?? "Sem plano",
          icon: CreditCardIcon,
          tone: "primary",
        },
        {
          label: "Capacidade do plano",
          value: subscription?.plan.maxEmployees ?? 0,
          icon: UserGroupIcon,
          tone: "success",
        },
        {
          label: "Valor mensal",
          value: formatCents(subscription?.plan.monthlyPriceCents ?? 0),
          icon: Calendar03Icon,
          tone: "warning",
        },
        {
          label: "Em aberto",
          value: formatCents(pendingTotal),
          icon: Tick02Icon,
          tone: pending.length > 0 ? "danger" : "success",
        },
      ]}
    >
      <div {...classProps(styles.billingGrid)}>
        <section className="min-w-0" aria-labelledby="plans-title">
          <DataTable
            toolbar={
              <h2 {...classProps(portalStyles.subheading)} id="plans-title">
                Planos disponíveis
              </h2>
            }
            data={plans}
            scrollLabel="Tabela de planos"
            columns={planColumns}
            labelledBy="plans-title"
            getRowId={(plan) => plan.id}
            tableStyle="min-w-lg"
            emptyText="Nenhum plano disponível."
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
          {invoices.length === 0 ? (
            <p {...classProps(styles.label, "px-3 py-3 sm:px-5")}>Nenhuma fatura encontrada.</p>
          ) : (
            <ul {...classProps(styles.invoiceList)}>
              {invoices.map((invoice) => (
                <li key={invoice.id} {...classProps(styles.invoice)}>
                  <div {...classProps(styles.serviceHeader)}>
                    <strong className="capitalize">
                      {monthFormat.format(new Date(`${invoice.dueDate}T00:00:00Z`))}
                    </strong>
                    <Badge
                      variant={invoiceStatuses[invoice.status].variant}
                      {...classProps(styles.badge)}
                    >
                      {invoiceStatuses[invoice.status].label}
                    </Badge>
                  </div>
                  <span {...classProps(styles.amount)}>{formatCents(invoice.amountCents)}</span>
                  <div {...classProps(styles.invoiceFooter)}>
                    <p {...classProps(styles.label)}>
                      {invoice.paidAt
                        ? `Paga em ${dateFormat.format(new Date(invoice.paidAt))}`
                        : `Vence em ${formatDate(invoice.dueDate)}`}
                    </p>
                    {(invoice.status === "pending" || invoice.status === "failed") && (
                      <Button
                        size="sm"
                        disabled={checkout.isPending}
                        onClick={() => checkout.mutate()}
                      >
                        Pagar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {checkout.isError && (
        <p role="alert" {...classProps(styles.label, "text-destructive")}>
          Não foi possível gerar o pagamento. Tente novamente.
        </p>
      )}
      {nextDue && <p {...classProps(styles.label)}>Próximo vencimento em {formatDate(nextDue)}.</p>}
    </ListPage>
  );
}
