import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { invoices, subscriptions } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createAbacatePayGateway } from "./features/billing/abacatepay.js";
import { createRepositories } from "./repositories.js";
import type { PortalAuth } from "./shared/portal-auth.js";

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
      principal: { id: "test-member", name: "Test Member", email: "member@example.com", role },
    });
  },
};

type WebhookData = {
  subscription: { id: string; amount: number };
  checkout?: { id: string; externalId: string };
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

  let app = createApp(webOrigin, repos, { auth });

  const unconfigured = createApp(webOrigin, repos, { auth });

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

  it("creates invoices and updates their status through the repository", async () => {
    const created = await repos.billing.createInvoice(subscriptionId, 100, "2027-01-01");

    expect(created).toMatchObject({ status: "pending", amountCents: 100, paidAt: null });

    const refunded = await repos.billing.updateInvoiceStatus(created.id, "refunded");

    expect(refunded).toMatchObject({ status: "refunded", abacatepayBillingId: null });
    expect(await repos.billing.updateInvoiceStatus(missingId, "paid")).toBeNull();
    expect(await repos.billing.getInvoiceByBillingId("missing")).toBeNull();
  });
});
