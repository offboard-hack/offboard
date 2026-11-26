import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  defaultOrgId,
  invoices,
  offboardingCases,
  subscriptions,
  talentSubscriptions,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { createAbacatePayGateway } from "./features/billing/abacatepay.js";
import { createRepositories } from "./repositories.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { saoPauloDate } from "./shared/sao-paulo-date.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const webhookSecret = "abacatepay-test-secret-with-32-chars";
const missingId = "00000000-0000-4000-8000-000000000000";

const auth: PortalAuth = {
  handler: () => Promise.resolve(new Response("ok")),
  resolvePrincipal(headers) {
    const role = headers.get("x-test-session") === "rh" ? "rh" : "admin";

    return Promise.resolve({
      kind: "authenticated",
      principal: {
        id: "test-member",
        name: "Test Member",
        email: "member@example.com",
        role,
        orgId: defaultOrgId,
      },
    });
  },
};

type WebhookData = {
  subscription: { id: string; amount: number };
  checkout?: { id: string; externalId: string | null };
  payment?: { id: string };
};

type CheckoutRequest = {
  items: { id: string; quantity: number }[];
  methods: string[];
  externalId: string;
  returnUrl: string;
  completionUrl: string;
  retryPolicy: { maxRetry: number; retryEvery: number };
};

describe("abacatepay gateway", () => {
  let requestBody = "";
  let requestAuthorization = "";
  let responseStatus = 200;
  let responseBody = "";

  const server = createServer((req, res) => {
    requestAuthorization = req.headers.authorization ?? "";
    requestBody = "";
    req.on("data", (chunk) => {
      requestBody += String(chunk);
    });
    req.on("end", () => {
      res.writeHead(responseStatus, { "content-type": "application/json" });
      res.end(responseBody);
    });
  });

  let base = "";

  const params = {
    externalId: "sub-1",
    planSlug: "gold",
    returnUrl: "http://return",
    completionUrl: "http://done",
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    // WARNING: listen(0) guarantees AddressInfo with a port
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("throws when the api key is missing", async () => {
    const gateway = createAbacatePayGateway(undefined);

    expect(gateway.configured).toBe(false);
    await expect(gateway.createSubscriptionCheckout(params)).rejects.toThrow(
      "ABACATEPAY_API_KEY is not configured",
    );
  });

  it("creates a Pix and card subscription checkout with a retry policy", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      success: true,
      data: { id: "bill_1", url: "https://pay.example/bill_1" },
      error: null,
    });

    const gateway = createAbacatePayGateway("secret-key", base);

    expect(gateway.configured).toBe(true);
    await expect(gateway.createSubscriptionCheckout(params)).resolves.toEqual({
      id: "bill_1",
      url: "https://pay.example/bill_1",
    });
    expect(requestAuthorization).toBe("Bearer secret-key");

    const sent: CheckoutRequest = JSON.parse(requestBody);

    expect(sent).toEqual({
      items: [{ id: "gold", quantity: 1 }],
      methods: ["PIX", "CARD"],
      externalId: "sub-1",
      returnUrl: "http://return",
      completionUrl: "http://done",
      retryPolicy: { maxRetry: 3, retryEvery: 1 },
    });
  });

  it("throws when AbacatePay rejects the checkout", async () => {
    responseStatus = 400;
    responseBody = JSON.stringify({ success: false, data: null, error: "denied" });

    await expect(
      createAbacatePayGateway("secret-key", base).createSubscriptionCheckout(params),
    ).rejects.toThrow("AbacatePay subscription checkout failed");
  });
});

describe.skipIf(!url)("billing", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  const abacate = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        data: { id: "bill_test", url: "https://pay.example/bill_test" },
        error: null,
      }),
    );
  });

  let app = createApp(webOrigin, repos, { auth, sendEmail: () => Promise.resolve() });

  const unconfigured = createApp(webOrigin, repos, { auth, sendEmail: () => Promise.resolve() });

  function call(path: string, init: { method?: string; session?: string; body?: string } = {}) {
    const headers = new Headers({ origin: webOrigin });

    if (init.session) headers.set("x-test-session", init.session);

    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
      }),
    );
  }

  let subscriptionId = "";

  function eventData(overrides: Partial<WebhookData> = {}) {
    const data = {
      subscription: { id: "subs_1", amount: 24900 },
      checkout: { id: "bill_1", externalId: subscriptionId },
      payment: { id: "pay_1" },
      ...overrides,
    } satisfies WebhookData;

    return data;
  }

  function webhook(event: string, overrides: Partial<WebhookData> = {}) {
    return call(`/billing/webhook?webhookSecret=${webhookSecret}`, {
      method: "POST",
      body: JSON.stringify({ id: "log_1", event, apiVersion: 2, data: eventData(overrides) }),
    });
  }

  function talentWebhook(
    event: string,
    overrides: Partial<WebhookData> = {},
    headers: Record<string, string> = {},
    id: string | null = randomUUID(),
  ) {
    return app.handle(
      new Request(`http://localhost/api/billing/webhook?webhookSecret=${webhookSecret}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: id ?? undefined,
          event,
          apiVersion: 2,
          data: eventData(overrides),
        }),
      }),
    );
  }

  function allInvoices() {
    return db.select().from(invoices).orderBy(invoices.dueDate);
  }

  async function currentSubscription() {
    const [row] = await db.select().from(subscriptions);

    return row;
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });

    await new Promise<void>((resolve) => {
      abacate.listen(0, "127.0.0.1", resolve);
    });

    // WARNING: listen(0) guarantees AddressInfo with a port
    const base = `http://127.0.0.1:${(abacate.address() as AddressInfo).port}/v`;

    app = createApp(webOrigin, repos, {
      auth,
      sendEmail: () => Promise.resolve(),
      abacatepay: createAbacatePayGateway("secret-key", base),
      abacatepayWebhookSecret: webhookSecret,
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
    subscriptionId = (await currentSubscription()).id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      abacate.close(() => resolve());
    });

    await db.$client.end();
  });

  it("seeds four plans ordered by price", async () => {
    const res = await call("/billing/plans", { session: "rh" });
    const plans = await res.json();

    expect(res.status).toBe(200);
    expect(plans.map((plan: { name: string }) => plan.name)).toEqual([
      "Silver",
      "Gold",
      "Platinum",
      "Platinum Premium",
    ]);
    expect(plans[1]).toMatchObject({ monthlyPriceCents: 24900, maxEmployees: 30 });
    expect(plans[1].features.length).toBeGreaterThan(0);
  });

  it("returns the current subscription with its plan", async () => {
    const res = await call("/billing/subscription", { session: "rh" });

    expect(await res.json()).toMatchObject({
      status: "active",
      plan: { slug: "gold", name: "Gold" },
    });
  });

  it("returns 404 without a subscription", async () => {
    await db.delete(subscriptions);

    expect((await call("/billing/subscription")).status).toBe(404);
  });

  it("lists invoices for admins only, newest due date first", async () => {
    const res = await call("/billing/invoices");
    const list = await res.json();

    expect(list.map((invoice: { status: string }) => invoice.status)).toEqual(["pending", "paid"]);
    expect(list[1].paidAt).toBe("2026-10-01T12:00:00.000Z");
    expect(list[0].paidAt).toBeNull();
    expect((await call("/billing/invoices", { session: "rh" })).status).toBe(403);
  });

  it("creates a subscription checkout and returns the hosted url", async () => {
    const res = await call("/billing/checkout", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      checkoutId: "bill_test",
      url: "https://pay.example/bill_test",
    });
  });

  it("restricts checkout to admins", async () => {
    expect((await call("/billing/checkout", { method: "POST", session: "rh" })).status).toBe(403);
  });

  it("returns 503 when AbacatePay is not configured", async () => {
    const res = await unconfigured.handle(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { origin: webOrigin },
      }),
    );

    expect(res.status).toBe(503);
  });

  it("returns 404 on checkout without a subscription", async () => {
    await db.delete(subscriptions);

    expect((await call("/billing/checkout", { method: "POST" })).status).toBe(404);
  });

  it("rejects webhooks without valid credentials", async () => {
    const body = JSON.stringify({ event: "subscription.completed", data: eventData() });

    const wrongSecret = await call("/billing/webhook?webhookSecret=nope", {
      method: "POST",
      body,
    });

    const noSecretConfigured = await unconfigured.handle(
      new Request("http://localhost/api/billing/webhook?webhookSecret=x", {
        method: "POST",
        body,
      }),
    );

    expect((await call("/billing/webhook", { method: "POST", body })).status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    expect(noSecretConfigured.status).toBe(401);
  });

  it("accepts Standard Webhooks signatures and rejects invalid ones", async () => {
    const body = JSON.stringify({ type: "subscription.cancelled", data: eventData() });
    const timestamp = String(Math.floor(Date.now() / 1000));

    function sign(id: string, ts: string) {
      return createHmac("sha256", webhookSecret).update(`${id}.${ts}.${body}`).digest("base64");
    }

    function send(headers: Record<string, string>) {
      return app.handle(
        new Request("http://localhost/api/billing/webhook", { method: "POST", headers, body }),
      );
    }

    const valid = await send({
      "webhook-id": "msg_1",
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,other v1,${sign("msg_1", timestamp)}`,
    });

    expect(valid.status).toBe(200);
    expect((await currentSubscription()).status).toBe("canceled");

    const rejected = [
      await send({
        "webhook-id": "msg_1",
        "webhook-timestamp": timestamp,
        "webhook-signature": "v1,bogus",
      }),
      await send({
        "webhook-id": "msg_1",
        "webhook-timestamp": "1",
        "webhook-signature": `v1,${sign("msg_1", "1")}`,
      }),
      await send({
        "webhook-id": "msg_1",
        "webhook-timestamp": "abc",
        "webhook-signature": "v1,bogus",
      }),
      await send({ "webhook-id": "msg_1" }),
    ];

    expect(rejected.map((res) => res.status)).toEqual([401, 401, 401, 401]);
  });

  it("rejects malformed webhook bodies", async () => {
    const invalidJson = await call(`/billing/webhook?webhookSecret=${webhookSecret}`, {
      method: "POST",
      body: "{",
    });

    const missingSubscription = await call(`/billing/webhook?webhookSecret=${webhookSecret}`, {
      method: "POST",
      body: JSON.stringify({ event: "subscription.completed", data: {} }),
    });

    expect(invalidJson.status).toBe(422);
    expect(missingSubscription.status).toBe(422);
  });

  it("settles the open invoice when the subscription completes and is idempotent", async () => {
    expect((await webhook("subscription.completed")).status).toBe(200);

    const settled = (await allInvoices()).find((invoice) => invoice.dueDate === "2026-12-01");

    expect(settled).toMatchObject({ status: "paid", abacatepayBillingId: "pay_1" });
    expect(settled?.paidAt).toBeInstanceOf(Date);
    expect((await currentSubscription()).status).toBe("active");

    await webhook("subscription.completed");

    expect(await allInvoices()).toHaveLength(2);
  });

  it("creates a paid invoice on renewal when nothing is open", async () => {
    await db.delete(invoices).where(eq(invoices.status, "pending"));

    await webhook("subscription.renewed", { payment: undefined });

    const created = (await allInvoices()).find(
      (invoice) => invoice.abacatepayBillingId === "log_1",
    );

    expect(created).toMatchObject({ status: "paid", amountCents: 24900 });
  });

  it("falls back to the subscription id when the event has no payment or delivery id", async () => {
    await call(`/billing/webhook?webhookSecret=${webhookSecret}`, {
      method: "POST",
      body: JSON.stringify({
        event: "subscription.renewed",
        data: eventData({ payment: undefined }),
      }),
    });

    expect((await allInvoices()).some((row) => row.abacatepayBillingId === "subs_1")).toBe(true);
  });

  it("marks the open invoice failed and the subscription past due", async () => {
    await webhook("subscription.payment_failed");

    expect((await allInvoices()).map((invoice) => invoice.status)).toEqual(["paid", "failed"]);
    expect((await currentSubscription()).status).toBe("past_due");
  });

  it("records a failed invoice when none is open", async () => {
    await db.delete(invoices).where(eq(invoices.status, "pending"));

    await webhook("subscription.payment_failed");

    expect((await allInvoices()).map((invoice) => invoice.status)).toEqual(["paid", "failed"]);
  });

  it("tracks trials and cancellations", async () => {
    await webhook("subscription.trial_started");

    expect((await currentSubscription()).status).toBe("trialing");

    await webhook("subscription.cancelled");

    expect((await currentSubscription()).status).toBe("canceled");
  });

  it("acknowledges events it does not act on", async () => {
    const before = await allInvoices();

    const responses = [
      await webhook("subscription.plan_changed"),
      await webhook("subscription.completed", { checkout: undefined }),
      await webhook("subscription.completed", {
        checkout: { id: "bill_1", externalId: missingId },
      }),
      await call(`/billing/webhook?webhookSecret=${webhookSecret}`, {
        method: "POST",
        body: JSON.stringify({ data: eventData() }),
      }),
    ];

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    expect(await allInvoices()).toEqual(before);
  });

  async function talentProfile(index = 0) {
    const [chosen] = await db
      .select({ id: offboardingCases.id })
      .from(offboardingCases)
      .orderBy(offboardingCases.id)
      .offset(index)
      .limit(1);

    const created = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId: chosen.id,
      personalEmail: `pessoa-${index}@exemplo.com`,
      sponsoredUntil: "2099-12-31",
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    return created.id;
  }

  async function pendingTalent(index = 0) {
    const profileId = await talentProfile(index);
    const now = new Date();

    await db
      .insert(talentSubscriptions)
      .values({ profileId, status: "pending", createdAt: now, updatedAt: now });

    return profileId;
  }

  async function talentRow(profileId: string) {
    const [row] = await db
      .select({
        status: talentSubscriptions.status,
        providerSubscriptionId: talentSubscriptions.providerSubscriptionId,
        currentPeriodEnd: talentSubscriptions.currentPeriodEnd,
      })
      .from(talentSubscriptions)
      .where(eq(talentSubscriptions.profileId, profileId));

    return row;
  }

  function monthAfter(date: string) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);

    return next.toISOString().slice(0, 10);
  }

  function talentCheckout(profileId: string) {
    return { checkout: { id: "bill_talent", externalId: `talent:${profileId}` } };
  }

  it("activates, renews and cancels a Carreira Pro without touching the company", async () => {
    const profileId = await pendingTalent();
    const company = await currentSubscription();
    const before = await allInvoices();
    const today = saoPauloDate(new Date());
    const talent = { ...talentCheckout(profileId), subscription: { id: "subs_t", amount: 7900 } };

    expect((await talentWebhook("subscription.completed", talent)).status).toBe(200);
    expect(await talentRow(profileId)).toEqual({
      status: "active",
      providerSubscriptionId: "subs_t",
      currentPeriodEnd: monthAfter(today),
    });

    await talentWebhook("subscription.renewed", talent);

    expect(await talentRow(profileId)).toEqual({
      status: "active",
      providerSubscriptionId: "subs_t",
      currentPeriodEnd: monthAfter(monthAfter(today)),
    });

    await talentWebhook("subscription.cancelled", talent);

    expect((await talentRow(profileId)).status).toBe("canceled");
    expect(await currentSubscription()).toEqual(company);
    expect(await allInvoices()).toEqual(before);
  });

  it("renews from today when the Carreira Pro period has no end or already ended", async () => {
    const today = saoPauloDate(new Date());
    const open = await pendingTalent();

    await talentWebhook("subscription.renewed", talentCheckout(open));

    expect((await talentRow(open)).currentPeriodEnd).toBe(monthAfter(today));

    await db
      .update(talentSubscriptions)
      .set({ currentPeriodEnd: "2020-01-15" })
      .where(eq(talentSubscriptions.profileId, open));

    await talentWebhook("subscription.renewed", talentCheckout(open));

    expect((await talentRow(open)).currentPeriodEnd).toBe(monthAfter(today));
  });

  it("routes renewals without a checkout to the Carreira Pro holding that subscription", async () => {
    const profileId = await pendingTalent();
    const company = await currentSubscription();
    const today = saoPauloDate(new Date());

    await talentWebhook("subscription.completed", {
      ...talentCheckout(profileId),
      subscription: { id: "subs_t", amount: 7900 },
    });

    await talentWebhook("subscription.renewed", {
      checkout: undefined,
      subscription: { id: "subs_t", amount: 7900 },
    });

    expect((await talentRow(profileId)).currentPeriodEnd).toBe(monthAfter(monthAfter(today)));

    await talentWebhook("subscription.cancelled", {
      checkout: { id: "bill_talent", externalId: null },
      subscription: { id: "subs_t", amount: 7900 },
    });

    expect((await talentRow(profileId)).status).toBe("canceled");
    expect(await currentSubscription()).toEqual(company);
  });

  it("keeps Carreira Pro untouched by company events sharing its subscription id", async () => {
    const profileId = await pendingTalent();

    await db
      .update(talentSubscriptions)
      .set({ providerSubscriptionId: "subs_1" })
      .where(eq(talentSubscriptions.profileId, profileId));

    const talent = await talentRow(profileId);

    await webhook("subscription.cancelled");

    expect((await currentSubscription()).status).toBe("canceled");
    expect(await talentRow(profileId)).toEqual(talent);
  });

  it("applies a redelivered Carreira Pro event only once", async () => {
    const profileId = await pendingTalent();
    const today = saoPauloDate(new Date());

    await talentWebhook("subscription.completed", talentCheckout(profileId), {}, "log_once");
    await talentWebhook("subscription.renewed", talentCheckout(profileId), {}, "log_renew");
    await talentWebhook("subscription.renewed", talentCheckout(profileId), {}, "log_renew");

    expect((await talentRow(profileId)).currentPeriodEnd).toBe(monthAfter(monthAfter(today)));

    const delivery = { "webhook-id": "msg_renew" };

    await talentWebhook("subscription.renewed", talentCheckout(profileId), delivery, null);
    await talentWebhook("subscription.renewed", talentCheckout(profileId), delivery, null);

    expect((await talentRow(profileId)).currentPeriodEnd).toBe(
      monthAfter(monthAfter(monthAfter(today))),
    );
  });

  it("extends on every renewal that carries no event id", async () => {
    const profileId = await pendingTalent();
    const today = saoPauloDate(new Date());

    await talentWebhook("subscription.renewed", talentCheckout(profileId), {}, null);
    await talentWebhook("subscription.renewed", talentCheckout(profileId), {}, null);

    expect((await talentRow(profileId)).currentPeriodEnd).toBe(monthAfter(monthAfter(today)));
  });

  it("marks a Carreira Pro past due when a payment fails and stops AI Apply", async () => {
    const profileId = await pendingTalent();
    const company = await currentSubscription();
    const before = await allInvoices();

    await talentWebhook("subscription.completed", talentCheckout(profileId));

    expect(await repos.careerPlan.allowedBy(profileId, new Date())).toBe("individual");

    await talentWebhook("subscription.payment_failed", talentCheckout(profileId));

    expect((await talentRow(profileId)).status).toBe("past_due");
    expect(await repos.careerPlan.allowedBy(profileId, new Date())).toBeNull();
    expect(await currentSubscription()).toEqual(company);
    expect(await allInvoices()).toEqual(before);
  });

  it("ignores talent events for unknown profiles or events it does not act on", async () => {
    const logged = vi.spyOn(console, "error");
    const company = await currentSubscription();
    const before = await allInvoices();
    const withoutRow = await talentProfile();

    try {
      const responses = [
        await talentWebhook("subscription.completed", talentCheckout(missingId)),
        await talentWebhook("subscription.completed", talentCheckout(withoutRow)),
        await talentWebhook("subscription.completed", {
          checkout: { id: "bill_talent", externalId: "talent:not-a-uuid" },
        }),
      ];

      expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
      expect(logged).toHaveBeenCalledWith("talent webhook ignored", {
        event: "subscription.completed",
      });
      expect(await db.select().from(talentSubscriptions)).toEqual([]);
    } finally {
      logged.mockRestore();
    }

    const pending = await pendingTalent(1);

    const quiet = [
      await talentWebhook("subscription.plan_changed", talentCheckout(pending)),
      await call(`/billing/webhook?webhookSecret=${webhookSecret}`, {
        method: "POST",
        body: JSON.stringify({ data: eventData(talentCheckout(pending)) }),
      }),
    ];

    expect(quiet.map((res) => res.status)).toEqual([200, 200]);
    expect(await talentRow(pending)).toEqual({
      status: "pending",
      providerSubscriptionId: null,
      currentPeriodEnd: null,
    });
    expect(await currentSubscription()).toEqual(company);
    expect(await allInvoices()).toEqual(before);
  });

  it("ignores events of a replaced Carreira Pro subscription", async () => {
    const logged = vi.spyOn(console, "error");
    const profileId = await pendingTalent();
    const today = saoPauloDate(new Date());
    const first = { ...talentCheckout(profileId), subscription: { id: "subs_a", amount: 7900 } };
    const second = { ...talentCheckout(profileId), subscription: { id: "subs_b", amount: 7900 } };

    try {
      await talentWebhook("subscription.completed", first);
      await talentWebhook("subscription.payment_failed", first);

      expect((await talentRow(profileId)).status).toBe("past_due");

      await talentWebhook("subscription.completed", second);

      expect(await talentRow(profileId)).toEqual({
        status: "active",
        providerSubscriptionId: "subs_b",
        currentPeriodEnd: monthAfter(today),
      });

      const stale = [
        await talentWebhook("subscription.cancelled", first),
        await talentWebhook("subscription.renewed", first),
        await talentWebhook("subscription.payment_failed", first),
      ];

      expect(stale.map((res) => res.status)).toEqual([200, 200, 200]);
      expect(logged).toHaveBeenCalledWith("talent webhook ignored", {
        event: "subscription.cancelled",
      });
      expect(await talentRow(profileId)).toEqual({
        status: "active",
        providerSubscriptionId: "subs_b",
        currentPeriodEnd: monthAfter(today),
      });
    } finally {
      logged.mockRestore();
    }
  });

  it("creates invoices and updates their status through the repository", async () => {
    const created = await repos.billing.createInvoice(
      defaultOrgId,
      subscriptionId,
      100,
      "2027-01-01",
    );

    expect(created).toMatchObject({ status: "pending", amountCents: 100, paidAt: null });

    const refunded = await repos.billing.updateInvoiceStatus(defaultOrgId, created.id, "refunded");

    expect(refunded).toMatchObject({ status: "refunded", abacatepayBillingId: null });
    expect(await repos.billing.updateInvoiceStatus(defaultOrgId, missingId, "paid")).toBeNull();
    expect(await repos.billing.getInvoiceByBillingId(defaultOrgId, "missing")).toBeNull();
  });
});
