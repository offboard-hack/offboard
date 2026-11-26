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

  async function getSubscription(orgId: string) {
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
      .where(eq(subscriptions.orgId, orgId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    return row ?? null;
  }

  async function companyPlan(orgId: string) {
    const subscription = await getSubscription(orgId);

    return subscription && { slug: subscription.plan.slug, status: subscription.status };
  }

  async function listInvoices(orgId: string) {
    const rows = await db
      .select(invoiceColumns)
      .from(invoices)
      .where(eq(invoices.orgId, orgId))
      .orderBy(desc(invoices.dueDate), desc(invoices.createdAt));

    return rows.map(serializeInvoice);
  }

  async function findOpenInvoice(orgId: string, subscriptionId: string) {
    const [row] = await db
      .select(invoiceColumns)
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, orgId),
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
      .select({ id: subscriptions.id, planId: subscriptions.planId, orgId: subscriptions.orgId })
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);

    return row ?? null;
  }

  async function updateSubscription(
    orgId: string,
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
      .where(and(eq(subscriptions.id, id), eq(subscriptions.orgId, orgId)));
  }

  async function getInvoiceByBillingId(orgId: string, abacatepayBillingId: string) {
    const [row] = await db
      .select(invoiceColumns)
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.abacatepayBillingId, abacatepayBillingId)))
      .limit(1);

    return row ? serializeInvoice(row) : null;
  }

  async function createInvoice(
    orgId: string,
    subscriptionId: string,
    amountCents: number,
    dueDate: string,
  ) {
    const [row] = await db
      .insert(invoices)
      .values({ orgId, subscriptionId, amountCents, dueDate, status: "pending" })
      .returning(invoiceColumns);

    return serializeInvoice(row);
  }

  async function updateInvoiceStatus(
    orgId: string,
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
      .where(and(eq(invoices.id, id), eq(invoices.orgId, orgId)))
      .returning(invoiceColumns);

    return row ? serializeInvoice(row) : null;
  }

  return {
    listPlans,
    getSubscription,
    companyPlan,
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
