import type { Database } from "@offboard/db/client";
import {
  billingWebhookEvents,
  invoices,
  plans,
  subscriptions,
  talentSubscriptions,
} from "@offboard/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { checkoutRetryMs } from "../../shared/career-pro.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";

type InvoiceStatus = (typeof invoices.$inferSelect)["status"];

type SubscriptionStatus = (typeof subscriptions.$inferSelect)["status"];

type TalentSubscriptionStatus = (typeof talentSubscriptions.$inferSelect)["status"];

const talentSubscriptionColumns = {
  profileId: talentSubscriptions.profileId,
  providerSubscriptionId: talentSubscriptions.providerSubscriptionId,
  currentPeriodEnd: talentSubscriptions.currentPeriodEnd,
};

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
        perPersonPriceCents: plans.perPersonPriceCents,
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
          perPersonPriceCents: plans.perPersonPriceCents,
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

  async function startSubscription(orgId: string, planSlug: string, now: Date) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);

      const [plan] = await tx
        .select({ id: plans.id, slug: plans.slug })
        .from(plans)
        .where(eq(plans.slug, planSlug));

      if (!plan) return { outcome: "unknown_plan" } as const;

      const [current] = await tx
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          updatedAt: subscriptions.updatedAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.orgId, orgId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

      if (current && current.status !== "canceled" && current.status !== "pending") {
        return { outcome: "subscribed" } as const;
      }

      if (
        current?.status === "pending" &&
        current.updatedAt !== null &&
        current.updatedAt.getTime() > now.getTime() - checkoutRetryMs
      ) {
        return { outcome: "in_progress" } as const;
      }

      const today = saoPauloDate(now);

      const patch = {
        planId: plan.id,
        status: "pending",
        currentPeriodStart: today,
        currentPeriodEnd: today,
        updatedAt: now,
      } as const;

      if (current) {
        await tx.update(subscriptions).set(patch).where(eq(subscriptions.id, current.id));

        return { outcome: "started", id: current.id, planSlug: plan.slug } as const;
      }

      const [created] = await tx
        .insert(subscriptions)
        .values({ orgId, ...patch, createdAt: now })
        .returning({ id: subscriptions.id });

      return { outcome: "started", id: created.id, planSlug: plan.slug } as const;
    });
  }

  async function releaseSubscription(orgId: string, id: string) {
    await db
      .update(subscriptions)
      .set({ updatedAt: new Date(0) })
      .where(
        and(
          eq(subscriptions.id, id),
          eq(subscriptions.orgId, orgId),
          eq(subscriptions.status, "pending"),
        ),
      );
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

  async function findTalentSubscription(profileId: string) {
    const [row] = await db
      .select(talentSubscriptionColumns)
      .from(talentSubscriptions)
      .where(eq(talentSubscriptions.profileId, profileId));

    return row ?? null;
  }

  async function findTalentSubscriptionByProvider(providerSubscriptionId: string) {
    const [row] = await db
      .select(talentSubscriptionColumns)
      .from(talentSubscriptions)
      .where(eq(talentSubscriptions.providerSubscriptionId, providerSubscriptionId))
      .limit(1);

    return row ?? null;
  }

  async function updateTalentSubscription(
    profileId: string,
    patch: {
      status: TalentSubscriptionStatus;
      providerSubscriptionId?: string;
      currentPeriodEnd?: string;
    },
    eventId: string | null,
    now: Date,
  ) {
    return db.transaction(async (tx) => {
      if (eventId !== null) {
        const [fresh] = await tx
          .insert(billingWebhookEvents)
          .values({ id: eventId, receivedAt: now })
          .onConflictDoNothing()
          .returning({ id: billingWebhookEvents.id });

        if (!fresh) return false;
      }

      await tx
        .update(talentSubscriptions)
        .set({ ...patch, updatedAt: now })
        .where(eq(talentSubscriptions.profileId, profileId));

      return true;
    });
  }

  return {
    listPlans,
    getSubscription,
    startSubscription,
    releaseSubscription,
    listInvoices,
    findOpenInvoice,
    getSubscriptionById,
    updateSubscription,
    getInvoiceByBillingId,
    createInvoice,
    updateInvoiceStatus,
    findTalentSubscription,
    findTalentSubscriptionByProvider,
    updateTalentSubscription,
  };
}

export type BillingRepository = ReturnType<typeof createBillingRepository>;
