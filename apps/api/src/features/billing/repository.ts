import type { Database } from "@offboard/db/client";
import { invoices, plans, subscriptions } from "@offboard/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

type InvoiceStatus = (typeof invoices.$inferSelect)["status"];

type SubscriptionStatus = (typeof subscriptions.$inferSelect)["status"];

const invoiceColumns = {
  id: invoices.id,
  subscriptionId: invoices.subscriptionId,
  amountCents: invoices.amountCents,
  status: invoices.status,
  abacatepayBillingId: invoices.abacatepayBillingId,
  paidAt: invoices.paidAt,
  dueDate: invoices.dueDate,
};

function serializeInvoice<Row extends { paidAt: Date | null }>(row: Row) {
  return { ...row, paidAt: row.paidAt?.toISOString() ?? null };
}

export function createBillingRepository(db: Database) {
  async function listPlans() {
    return db
      .select({
        id: plans.id,
        name: plans.name,
        slug: plans.slug,
        monthlyPriceCents: plans.monthlyPriceCents,
        maxEmployees: plans.maxEmployees,
        features: plans.features,
      })
      .from(plans)
      .orderBy(asc(plans.monthlyPriceCents));
  }

  async function getSubscription() {
    const [row] = await db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        plan: {
          id: plans.id,
          name: plans.name,
          slug: plans.slug,
          monthlyPriceCents: plans.monthlyPriceCents,
          maxEmployees: plans.maxEmployees,
          features: plans.features,
        },
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    return row ?? null;
  }

  async function listInvoices() {
    const rows = await db
      .select(invoiceColumns)
      .from(invoices)
      .orderBy(desc(invoices.dueDate), desc(invoices.createdAt));

    return rows.map(serializeInvoice);
  }

  async function findOpenInvoice(subscriptionId: string) {
    const [row] = await db
      .select(invoiceColumns)
      .from(invoices)
      .where(
        and(
          eq(invoices.subscriptionId, subscriptionId),
          inArray(invoices.status, ["pending", "failed"]),
        ),
      )
      .orderBy(asc(invoices.dueDate))
      .limit(1);

    return row ? serializeInvoice(row) : null;
  }

  async function getSubscriptionById(id: string) {
    const [row] = await db
      .select({ id: subscriptions.id, planId: subscriptions.planId })
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);

    return row ?? null;
  }

  async function updateSubscription(
    id: string,
    patch: {
      status: SubscriptionStatus;
      currentPeriodStart?: string;
      currentPeriodEnd?: string;
    },
  ) {
    await db
      .update(subscriptions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(subscriptions.id, id));
  }

  async function getInvoiceByBillingId(abacatepayBillingId: string) {
    const [row] = await db
      .select(invoiceColumns)
      .from(invoices)
      .where(eq(invoices.abacatepayBillingId, abacatepayBillingId))
      .limit(1);

    return row ? serializeInvoice(row) : null;
  }

  async function createInvoice(subscriptionId: string, amountCents: number, dueDate: string) {
    const [row] = await db
      .insert(invoices)
      .values({ subscriptionId, amountCents, dueDate, status: "pending" })
      .returning(invoiceColumns);

    return serializeInvoice(row);
  }

  async function updateInvoiceStatus(
    id: string,
    status: InvoiceStatus,
    abacatepayBillingId?: string,
    paidAt?: Date,
  ) {
    const changes: Partial<typeof invoices.$inferInsert> = { status, updatedAt: new Date() };

    if (abacatepayBillingId !== undefined) changes.abacatepayBillingId = abacatepayBillingId;

    if (paidAt !== undefined) changes.paidAt = paidAt;

    const [row] = await db
      .update(invoices)
      .set(changes)
      .where(eq(invoices.id, id))
      .returning(invoiceColumns);

    return row ? serializeInvoice(row) : null;
  }

  return {
    listPlans,
    getSubscription,
    listInvoices,
    findOpenInvoice,
    getSubscriptionById,
    updateSubscription,
    getInvoiceByBillingId,
    createInvoice,
    updateInvoiceStatus,
  };
}

export type BillingRepository = ReturnType<typeof createBillingRepository>;
