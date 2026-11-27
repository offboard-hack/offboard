import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  benefitInvoices,
  copayProducts,
  defaultOrgId,
  invoices,
  offboardingCases,
  organizations,
  plans,
  subscriptions,
  talentProfiles,
  talentSubscriptions,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { createApp } from "./app.ts";
import { createAbacatePayGateway } from "./features/billing/abacatepay.js";
import { applyWebhookEvent, parseWebhookEvent } from "./features/billing/webhook.js";
import { careerPlanRoutes } from "./features/career-plan/routes.js";
import { createRepositories } from "./repositories.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { addMonths, saoPauloDate } from "./shared/sao-paulo-date.js";
import { talentAccess } from "./shared/talent-access.js";

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
        orgId: headers.get("x-test-org") ?? defaultOrgId,
        orgName: "Test Org",
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
  let requestPath = "";
  let responseStatus = 200;
  let responseBody = "";
  let lookupBody = "";

  const server = createServer((req, res) => {
    requestAuthorization = req.headers.authorization ?? "";
    requestPath = req.url ?? "";
    requestBody = "";
    req.on("data", (chunk) => {
      requestBody += String(chunk);
    });
    req.on("end", () => {
      const lookup =
        requestPath.startsWith("/v2/subscriptions/get") ||
        requestPath.startsWith("/v2/checkouts/get") ||
        requestPath.startsWith("/v2/products/get");

      res.writeHead(lookup ? 200 : responseStatus, { "content-type": "application/json" });
      res.end(lookup ? lookupBody : responseBody);
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

  it("cancels a subscription by its id", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({
      success: true,
      data: { id: "subs_1", status: "CANCELLED" },
      error: null,
    });

    await expect(
      createAbacatePayGateway("secret-key", base).cancelSubscription("subs_1"),
    ).resolves.toBeUndefined();
    expect(requestPath).toBe("/v2/subscriptions/cancel");
    expect(JSON.parse(requestBody)).toEqual({ id: "subs_1" });
  });

  it("treats a subscription already cancelled at AbacatePay as cancelled", async () => {
    responseStatus = 400;
    responseBody = JSON.stringify({ success: false, data: null, error: "already cancelled" });
    lookupBody = JSON.stringify({
      success: true,
      data: { id: "subs_1", status: "CANCELLED" },
      error: null,
    });

    await expect(
      createAbacatePayGateway("secret-key", base).cancelSubscription("subs_1"),
    ).resolves.toBeUndefined();
  });

  it("treats a subscription AbacatePay does not know as cancelled", async () => {
    responseStatus = 400;
    responseBody = JSON.stringify({ success: false, data: null, error: "Subscription not found" });
    lookupBody = JSON.stringify({ success: false, data: null, error: "Subscription not found" });

    await expect(
      createAbacatePayGateway("secret-key", base).cancelSubscription("subs_1"),
    ).resolves.toBeUndefined();
  });

  it("fails when the subscription is still live or the lookup fails", async () => {
    responseStatus = 400;
    responseBody = JSON.stringify({ success: false, data: null, error: "unavailable" });
    lookupBody = JSON.stringify({
      success: true,
      data: { id: "subs_1", status: "ACTIVE" },
      error: null,
    });

    await expect(
      createAbacatePayGateway("secret-key", base).cancelSubscription("subs_1"),
    ).rejects.toThrow("AbacatePay subscription cancel failed: unavailable");

    lookupBody = JSON.stringify({ success: false, data: null, error: "Internal error" });

    await expect(
      createAbacatePayGateway("secret-key", base).cancelSubscription("subs_1"),
    ).rejects.toThrow("AbacatePay subscription cancel failed: unavailable");
  });

  it("refunds a checkout through the refund endpoint", async () => {
    responseStatus = 200;
    responseBody = JSON.stringify({ success: true, data: { id: "bill_1" }, error: null });

    await expect(
      createAbacatePayGateway("secret-key", base).refundCheckout("char_1", "Motivo"),
    ).resolves.toBeUndefined();
    expect(requestPath).toBe("/v2/checkouts/refund");
    expect(JSON.parse(requestBody)).toEqual({ id: "char_1", reason: "Motivo" });
    expect(requestAuthorization).toBe("Bearer secret-key");
  });

  it("fails the refund when AbacatePay rejects it", async () => {
    responseStatus = 400;
    responseBody = JSON.stringify({ success: false, data: null, error: "unavailable" });

    await expect(
      createAbacatePayGateway("secret-key", base).refundCheckout("char_1", "Motivo"),
    ).rejects.toThrow("AbacatePay refund failed: unavailable");
  });

  it("throws on refund when the key is missing", async () => {
    await expect(
      createAbacatePayGateway(undefined).refundCheckout("bill_1", "Motivo"),
    ).rejects.toThrow("ABACATEPAY_API_KEY is not configured");
  });

  it("reads the external id of a product", async () => {
    lookupBody = JSON.stringify({
      success: true,
      data: { id: "prod_1", externalId: "carreira-pro" },
      error: null,
    });

    await expect(
      createAbacatePayGateway("secret-key", base).productExternalId("prod_1"),
    ).resolves.toBe("carreira-pro");
    expect(requestPath).toContain("/v2/products/get");
  });

  it("throws when the product lookup fails", async () => {
    lookupBody = JSON.stringify({ success: false, data: null, error: "Produto não encontrado." });

    await expect(
      createAbacatePayGateway("secret-key", base).productExternalId("prod_1"),
    ).rejects.toThrow("AbacatePay product lookup failed: Produto não encontrado.");
  });

  it("throws when the key is missing", async () => {
    await expect(createAbacatePayGateway(undefined).cancelSubscription("subs_1")).rejects.toThrow(
      "ABACATEPAY_API_KEY is not configured",
    );
  });

  it("throws when AbacatePay rejects the checkout", async () => {
    responseStatus = 400;
    responseBody = JSON.stringify({ success: false, data: null, error: "denied" });

    await expect(
      createAbacatePayGateway("secret-key", base).createSubscriptionCheckout(params),
    ).rejects.toThrow("AbacatePay subscription checkout failed");
  });
});

describe("abacatepay gateway cancel", () => {
  let requestPath = "";
  let requestBody = "";
  let responseBody = "";

  const server = createServer((req, res) => {
    requestPath = req.url ?? "";
    requestBody = "";
    req.on("data", (chunk) => {
      requestBody += String(chunk);
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(responseBody);
    });
  });

  let base = "";

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

  it("cancels a subscription", async () => {
    responseBody = JSON.stringify({ success: true, data: { id: "subs_123" }, error: null });

    await expect(
      createAbacatePayGateway("secret-key", base).cancelSubscription("subs_123"),
    ).resolves.toBeUndefined();
    expect(requestPath).toContain("/subscriptions/cancel");
    expect(JSON.parse(requestBody)).toEqual({ id: "subs_123" });
  });

  it("throws when cancel fails", async () => {
    responseBody = JSON.stringify({ success: false, data: null, error: "not found" });

    await expect(
      createAbacatePayGateway("secret-key", base).cancelSubscription("subs_x"),
    ).rejects.toThrow("AbacatePay subscription cancel failed");
  });

  it("throws when the gateway is not configured", async () => {
    await expect(createAbacatePayGateway(undefined).cancelSubscription("subs_1")).rejects.toThrow(
      "ABACATEPAY_API_KEY is not configured",
    );
  });
});

describe("abacatepay gateway cancel timeout", () => {
  const sockets = new Set<Socket>();
  const server = createServer(() => undefined);
  let base = "";

  beforeAll(async () => {
    server.on("connection", (socket) => {
      sockets.add(socket);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    base = `http://127.0.0.1:${z.object({ port: z.number() }).parse(server.address()).port}/v`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("gives up on a cancel that never answers", async () => {
    const started = Date.now();

    await expect(
      createAbacatePayGateway("secret-key", base, 20).cancelSubscription("subs_1"),
    ).rejects.toThrow("AbacatePay subscription cancel failed");
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe.skipIf(!url)("billing", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  const abacateCalls: string[] = [];

  const abacate = createServer((req, res) => {
    let received = "";

    req.on("data", (chunk) => {
      received += String(chunk);
    });
    req.on("end", () => {
      abacateCalls.push(`${req.url} ${received}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: { id: "bill_test", url: "https://pay.example/bill_test" },
          error: null,
        }),
      );
    });
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
    abacateCalls.length = 0;
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
    expect(plans[1]).toMatchObject({
      monthlyPriceCents: 24900,
      maxEmployees: 30,
      perPersonPriceCents: expect.any(Number),
    });
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
    await db.update(subscriptions).set({ status: "past_due" });

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

  const otherOrgId = "00000000-0000-4000-8000-0000000000b1";

  type IssuedCheckout = {
    externalId: string;
    planSlug: string;
    returnUrl: string;
    completionUrl: string;
  };

  const issued: IssuedCheckout[] = [];
  let gatewayFailure = false;

  const stubGateway = {
    configured: true,
    async createSubscriptionCheckout(params: IssuedCheckout) {
      await new Promise((resolve) => setTimeout(resolve, 30));

      if (gatewayFailure) throw new Error("gateway down");

      issued.push(params);

      return { id: `bill_${issued.length}`, url: `https://pay.example/bill_${issued.length}` };
    },
    refundCheckout: () => Promise.resolve(),
    productExternalId: () => Promise.resolve("prod_x"),
    cancelSubscription: async () => undefined,
  };

  const stubApp = createApp(webOrigin, repos, {
    auth,
    sendEmail: () => Promise.resolve(),
    abacatepay: stubGateway,
    abacatepayWebhookSecret: webhookSecret,
  });

  function stubCall(
    path: string,
    init: {
      body?: { planSlug?: string };
      session?: string;
      org?: string;
      target?: typeof app;
    } = {},
  ) {
    const headers = new Headers({ origin: webOrigin, "content-type": "application/json" });

    if (init.session) headers.set("x-test-session", init.session);

    if (init.org) headers.set("x-test-org", init.org);

    return (init.target ?? stubApp).handle(
      new Request(`http://localhost/api${path}`, {
        method: "POST",
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
      }),
    );
  }

  function subscribe(
    planSlug: string,
    init: { session?: string; org?: string; target?: typeof app } = {},
  ) {
    return stubCall("/billing/subscription", { ...init, body: { planSlug } });
  }

  function pay(init: { session?: string; target?: typeof app } = {}) {
    return stubCall("/billing/checkout", init);
  }

  async function subscriptionsOf(orgId: string) {
    return db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  }

  async function planId(slug: string) {
    const [row] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug));

    return row.id;
  }

  async function ageCheckout() {
    await db.update(subscriptions).set({ updatedAt: new Date(Date.now() - 61 * 60_000) });
  }

  function completion(row: { id: string; checkoutId: string | null }, providerId = "subs_1") {
    return webhook("subscription.completed", {
      subscription: { id: providerId, amount: 24900 },
      checkout: { id: row.checkoutId ?? "", externalId: row.id },
      payment: { id: `pay_completed_${providerId}` },
    });
  }

  function lifecycle(event: string, row: { id: string }, providerId: string) {
    return webhook(event, {
      subscription: { id: providerId, amount: 24900 },
      checkout: { id: "bill_other", externalId: row.id },
      payment: { id: `pay_${event}_${providerId}` },
    });
  }

  describe("company self-serve subscription", () => {
    beforeEach(async () => {
      issued.length = 0;
      gatewayFailure = false;
      await db.delete(subscriptions);
    });

    it("creates a pending subscription, stores its checkout and returns the url", async () => {
      const res = await subscribe("silver");
      const [created] = await subscriptionsOf(defaultOrgId);
      const today = saoPauloDate(new Date());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: "https://pay.example/bill_1" });
      expect(created).toMatchObject({
        status: "pending",
        planId: await planId("silver"),
        currentPeriodStart: today,
        currentPeriodEnd: today,
        checkoutId: "bill_1",
        checkoutUrl: "https://pay.example/bill_1",
        providerSubscriptionId: null,
      });
      expect(issued).toEqual([
        {
          externalId: expect.stringMatching(new RegExp(`^${created.id}:[a-z0-9]+$`)),
          planSlug: "silver",
          returnUrl: `${webOrigin}/planos-e-gastos?aba=plano`,
          completionUrl: `${webOrigin}/planos-e-gastos?aba=plano&plano=ok`,
        },
      ]);
    });

    it("grants no entitlements while pending", async () => {
      const profileId = await talentProfile();

      await subscribe("platinum-premium");

      const standing = () => repos.careerPlan.plan(profileId, new Date());

      expect((await standing())?.company.includesAiApply).toBe(false);
      expect((await standing())?.aiApply.allowedBy).toBeNull();

      await db.update(subscriptions).set({ status: "active" });

      expect((await standing())?.company.includesAiApply).toBe(true);
    });

    it("subscribes again after a cancellation with a fresh row", async () => {
      await subscribe("silver");
      await db.update(subscriptions).set({ status: "canceled" });

      const [old] = await subscriptionsOf(defaultOrgId);
      const res = await subscribe("gold");
      const rows = await subscriptionsOf(defaultOrgId);
      const fresh = rows.find((row) => row.id !== old.id);

      expect(res.status).toBe(200);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === old.id)?.status).toBe("canceled");
      expect(fresh).toMatchObject({ status: "pending", planId: await planId("gold") });

      const current = await (await call("/billing/subscription", { session: "rh" })).json();

      expect(current).toMatchObject({ id: fresh?.id, status: "pending", plan: { slug: "gold" } });
    });

    it("rejects a company that already pays", async () => {
      await db.insert(subscriptions).values({
        orgId: defaultOrgId,
        planId: await planId("gold"),
        status: "active",
        currentPeriodStart: "2026-11-01",
        currentPeriodEnd: "2026-12-01",
      });

      expect((await subscribe("platinum")).status).toBe(409);
      expect(issued).toEqual([]);
      expect((await subscriptionsOf(defaultOrgId))[0].status).toBe("active");
    });

    it("rejects a second subscribe within the hour and swaps the plan afterwards", async () => {
      expect((await subscribe("silver")).status).toBe(200);
      expect((await subscribe("gold")).status).toBe(409);
      expect(issued).toHaveLength(1);

      await ageCheckout();

      expect((await subscribe("gold")).status).toBe(200);

      const rows = await subscriptionsOf(defaultOrgId);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        planId: await planId("gold"),
        checkoutId: "bill_2",
        checkoutUrl: "https://pay.example/bill_2",
      });
    });

    it("treats a pending subscription without a timestamp as stale", async () => {
      await subscribe("silver");
      await db.update(subscriptions).set({ updatedAt: null });

      expect((await subscribe("silver")).status).toBe(200);
    });

    it("rejects unknown plan slugs and malformed bodies", async () => {
      expect((await subscribe("diamond")).status).toBe(422);
      expect((await stubCall("/billing/subscription", { body: {} })).status).toBe(422);
      expect(await subscriptionsOf(defaultOrgId)).toEqual([]);
    });

    it("answers 502 and leaves the row untouched when the gateway fails", async () => {
      gatewayFailure = true;

      expect((await subscribe("silver")).status).toBe(502);
      expect(await subscriptionsOf(defaultOrgId)).toEqual([]);

      gatewayFailure = false;
      await subscribe("silver");
      await ageCheckout();
      gatewayFailure = true;

      expect((await subscribe("gold")).status).toBe(502);
      expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
        planId: await planId("silver"),
        checkoutId: "bill_1",
      });

      gatewayFailure = false;

      expect((await subscribe("gold")).status).toBe(200);
    });

    it("answers 503 when AbacatePay is not configured", async () => {
      expect((await subscribe("silver", { target: unconfigured })).status).toBe(503);
      expect((await pay({ target: unconfigured })).status).toBe(503);
      expect(await subscriptionsOf(defaultOrgId)).toEqual([]);
    });

    it("restricts subscribing and paying to admins", async () => {
      expect((await subscribe("silver", { session: "rh" })).status).toBe(403);
      expect((await pay({ session: "rh" })).status).toBe(403);
    });

    it("issues one checkout when subscribes arrive together", async () => {
      const responses = await Promise.all([subscribe("silver"), subscribe("gold")]);

      expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(issued).toHaveLength(1);
      expect(await subscriptionsOf(defaultOrgId)).toHaveLength(1);
    });

    it("never touches another organization's subscription", async () => {
      await db
        .insert(organizations)
        .values({ id: otherOrgId, name: "Org B", slug: "org-b-billing" })
        .onConflictDoNothing();
      await db.delete(subscriptions).where(eq(subscriptions.orgId, otherOrgId));
      await db.insert(subscriptions).values({
        orgId: defaultOrgId,
        planId: await planId("gold"),
        status: "active",
        currentPeriodStart: "2026-11-01",
        currentPeriodEnd: "2026-12-01",
      });

      const res = await subscribe("silver", { org: otherOrgId });
      const [own] = await subscriptionsOf(defaultOrgId);
      const [other] = await subscriptionsOf(otherOrgId);

      expect(res.status).toBe(200);
      expect(own).toMatchObject({ status: "active", planId: await planId("gold") });
      expect(other).toMatchObject({ status: "pending", planId: await planId("silver") });
      expect(issued[0].externalId).toMatch(new RegExp(`^${other.id}:[a-z0-9]+$`));

      await db.delete(subscriptions).where(eq(subscriptions.orgId, otherOrgId));
    });

    it("exposes whether a pending checkout can be restarted", async () => {
      const state = async () =>
        (await (await call("/billing/subscription", { session: "rh" })).json()).canRestart;

      await subscribe("silver");

      expect(await state()).toBe(false);

      await ageCheckout();

      expect(await state()).toBe(true);

      await db.update(subscriptions).set({ status: "active", updatedAt: new Date(0) });

      expect(await state()).toBe(false);

      await db.update(subscriptions).set({ status: "pending", updatedAt: null });

      expect(await state()).toBe(true);
    });
  });

  describe("paying an existing subscription", () => {
    beforeEach(async () => {
      issued.length = 0;
      gatewayFailure = false;
      await db.delete(subscriptions);
    });

    it("returns the stored checkout for a repeated payment without a new gateway call", async () => {
      await subscribe("silver");

      const first = await pay();
      const second = await pay();

      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({
        checkoutId: "bill_1",
        url: "https://pay.example/bill_1",
      });
      expect(await second.json()).toEqual({
        checkoutId: "bill_1",
        url: "https://pay.example/bill_1",
      });
      expect(issued).toHaveLength(1);
    });

    it("issues one checkout for concurrent payments of a stale pending subscription", async () => {
      await subscribe("silver");
      await ageCheckout();
      issued.length = 0;

      const responses = await Promise.all([pay(), pay(), pay()]);
      const urls = await Promise.all(responses.map(async (res) => (await res.json()).url));

      expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
      expect(new Set(urls).size).toBe(1);
      expect(issued).toHaveLength(1);
    });

    it("issues a new checkout once a pending one is stale", async () => {
      await subscribe("silver");
      await ageCheckout();

      const res = await pay();

      expect(await res.json()).toEqual({ checkoutId: "bill_2", url: "https://pay.example/bill_2" });
      expect((await subscriptionsOf(defaultOrgId))[0].checkoutId).toBe("bill_2");
    });

    it("issues a checkout to recover a past due subscription and reuses it", async () => {
      await db.insert(subscriptions).values({
        orgId: defaultOrgId,
        planId: await planId("gold"),
        status: "past_due",
        currentPeriodStart: "2026-11-01",
        currentPeriodEnd: "2026-12-01",
      });

      const first = await pay();
      const second = await pay();

      expect(first.status).toBe(200);
      expect((await second.json()).url).toBe("https://pay.example/bill_1");
      expect(issued).toHaveLength(1);
    });

    it("gives every new checkout of a past due subscription its own external id", async () => {
      const [row] = await db
        .insert(subscriptions)
        .values({
          orgId: defaultOrgId,
          planId: await planId("gold"),
          status: "past_due",
          currentPeriodStart: "2026-11-01",
          currentPeriodEnd: "2026-12-01",
        })
        .returning();

      await pay();
      await ageCheckout();

      const second = await pay();

      expect(second.status).toBe(200);
      expect(issued).toHaveLength(2);
      expect(issued[0].externalId).toMatch(new RegExp(`^${row.id}:[a-z0-9]+$`));
      expect(issued[1].externalId).toMatch(new RegExp(`^${row.id}:[a-z0-9]+$`));
      expect(issued[1].externalId).not.toBe(issued[0].externalId);

      const [stored] = await subscriptionsOf(defaultOrgId);

      expect(stored.checkoutId).toBe("bill_2");

      await webhook("subscription.completed", {
        subscription: { id: "subs_new", amount: 24900 },
        checkout: { id: "bill_2", externalId: issued[1].externalId },
        payment: { id: "pay_new" },
      });

      expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_new",
      });
    });

    it("keeps routing a legacy checkout reference to its subscription", async () => {
      await subscribe("silver");

      const [row] = await subscriptionsOf(defaultOrgId);

      expect((await completion(row, "subs_legacy")).status).toBe(200);
      expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_legacy",
      });
    });

    it("never lets an attempt suffix redirect a company event", async () => {
      await subscribe("silver");

      const [row] = await subscriptionsOf(defaultOrgId);
      const logged = vi.spyOn(console, "error");

      try {
        const forged = [
          `${row.id}:${row.id}`,
          `${row.id}:a:b`,
          `${row.id}:`,
          `${missingId}:${row.id}`,
          `${missingId}:abc`,
        ];

        for (const externalId of forged) {
          await webhook("subscription.completed", {
            subscription: { id: "subs_forged", amount: 24900 },
            checkout: { id: row.checkoutId ?? "", externalId },
            payment: { id: "pay_forged" },
          });
        }

        await webhook("subscription.completed", {
          subscription: { id: "subs_forged", amount: 24900 },
          checkout: { id: "bill_other", externalId: `${row.id}:abc` },
          payment: { id: "pay_forged" },
        });

        expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
          status: "pending",
          providerSubscriptionId: null,
        });
        expect(await allInvoices()).toEqual([]);
      } finally {
        logged.mockRestore();
      }
    });

    it("refuses to pay subscriptions that are active, trialing or canceled", async () => {
      await db.insert(subscriptions).values({
        orgId: defaultOrgId,
        planId: await planId("gold"),
        status: "active",
        currentPeriodStart: "2026-11-01",
        currentPeriodEnd: "2026-12-01",
      });

      const statuses = [];

      for (const status of ["active", "trialing", "canceled"] as const) {
        await db.update(subscriptions).set({ status });
        statuses.push((await pay()).status);
      }

      expect(statuses).toEqual([409, 409, 409]);
      expect(issued).toEqual([]);
    });

    it("answers 502 and keeps the stored checkout when the gateway fails", async () => {
      await subscribe("silver");
      await ageCheckout();
      gatewayFailure = true;

      expect((await pay()).status).toBe(502);
      expect((await subscriptionsOf(defaultOrgId))[0].checkoutId).toBe("bill_1");

      gatewayFailure = false;

      expect((await pay()).status).toBe(200);
    });

    it("answers 404 without a subscription", async () => {
      expect((await pay()).status).toBe(404);
    });
  });

  describe("company activation from webhooks", () => {
    beforeEach(async () => {
      issued.length = 0;
      gatewayFailure = false;
      await db.delete(subscriptions);
    });

    it("activates a pending subscription on the issued checkout and records the provider id", async () => {
      await subscribe("silver");

      const [row] = await subscriptionsOf(defaultOrgId);

      expect((await completion(row, "subs_9")).status).toBe(200);

      const [activated] = await subscriptionsOf(defaultOrgId);
      const today = saoPauloDate(new Date());

      expect(activated).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_9",
        checkoutId: "bill_1",
        checkoutUrl: null,
        currentPeriodStart: today,
      });
      expect(activated.currentPeriodEnd > today).toBe(true);
      expect((await allInvoices()).map((invoice) => invoice.status)).toEqual(["paid"]);
    });

    it("does not activate when an old checkout link is paid after the plan changed", async () => {
      await subscribe("silver");

      const [silver] = await subscriptionsOf(defaultOrgId);

      await ageCheckout();
      await subscribe("platinum-premium");

      const res = await completion(silver);
      const [row] = await subscriptionsOf(defaultOrgId);

      expect(res.status).toBe(200);
      expect(row).toMatchObject({
        status: "pending",
        planId: await planId("platinum-premium"),
        providerSubscriptionId: null,
      });
      expect(await allInvoices()).toEqual([]);
    });

    it("does not activate a pending subscription without an issued checkout", async () => {
      await subscribe("silver");
      await db.update(subscriptions).set({ checkoutId: null });

      const [row] = await subscriptionsOf(defaultOrgId);

      await webhook("subscription.completed", {
        checkout: { id: "bill_x", externalId: row.id },
      });

      expect((await subscriptionsOf(defaultOrgId))[0].status).toBe("pending");
    });

    it("ignores a trial from an old checkout and accepts the issued one", async () => {
      await subscribe("silver");

      const [silver] = await subscriptionsOf(defaultOrgId);

      await ageCheckout();
      await subscribe("gold");

      const [row] = await subscriptionsOf(defaultOrgId);

      const trial = (source: { id: string; checkoutId: string | null }) =>
        webhook("subscription.trial_started", {
          subscription: { id: "subs_trial", amount: 24900 },
          checkout: { id: source.checkoutId ?? "", externalId: row.id },
        });

      expect((await trial(silver)).status).toBe(200);
      expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
        status: "pending",
        providerSubscriptionId: null,
      });

      await trial(row);

      expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
        status: "trialing",
        providerSubscriptionId: "subs_trial",
        checkoutUrl: null,
      });
    });

    it("ignores a first renewal from an old checkout and accepts the issued one", async () => {
      await subscribe("silver");

      const [silver] = await subscriptionsOf(defaultOrgId);

      await ageCheckout();
      await subscribe("gold");

      const [row] = await subscriptionsOf(defaultOrgId);

      const renewal = (source: { checkoutId: string | null }) =>
        webhook("subscription.renewed", {
          subscription: { id: "subs_renewed", amount: 24900 },
          checkout: { id: source.checkoutId ?? "", externalId: row.id },
          payment: { id: `pay_renewed_${source.checkoutId}` },
        });

      await renewal(silver);

      expect((await subscriptionsOf(defaultOrgId))[0].status).toBe("pending");
      expect(await allInvoices()).toEqual([]);

      await renewal(row);

      expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_renewed",
      });
      expect((await allInvoices()).map((invoice) => invoice.status)).toEqual(["paid"]);
    });

    it("matches later renewals by provider subscription once it is known", async () => {
      await subscribe("silver");

      const [row] = await subscriptionsOf(defaultOrgId);

      await completion(row, "subs_known");
      await webhook("subscription.renewed", {
        subscription: { id: "subs_known", amount: 24900 },
        checkout: { id: "bill_unrelated", externalId: row.id },
        payment: { id: "pay_second_cycle" },
      });

      expect((await allInvoices()).map((invoice) => invoice.status)).toEqual(["paid", "paid"]);
    });

    it("ignores lifecycle events from an older provider subscription", async () => {
      await subscribe("silver");

      const [row] = await subscriptionsOf(defaultOrgId);

      await completion(row, "subs_new");

      const before = await allInvoices();

      const responses = [
        await lifecycle("subscription.cancelled", row, "subs_old"),
        await lifecycle("subscription.payment_failed", row, "subs_old"),
        await lifecycle("subscription.renewed", row, "subs_old"),
      ];

      expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
      expect((await subscriptionsOf(defaultOrgId))[0].status).toBe("active");
      expect(await allInvoices()).toEqual(before);

      await lifecycle("subscription.cancelled", row, "subs_new");

      expect((await subscriptionsOf(defaultOrgId))[0].status).toBe("canceled");
    });

    it("keeps an old subscription's failed invoice out of a new subscription", async () => {
      await subscribe("silver");

      const [old] = await subscriptionsOf(defaultOrgId);

      await completion(old, "subs_old");
      await lifecycle("subscription.payment_failed", old, "subs_old");
      await lifecycle("subscription.cancelled", old, "subs_old");
      await subscribe("gold");

      const fresh = (await subscriptionsOf(defaultOrgId)).find((row) => row.id !== old.id);

      expect(fresh).toBeDefined();

      await completion(fresh ?? old, "subs_fresh");

      const bySubscription = (await allInvoices()).map((invoice) => [
        invoice.subscriptionId === old.id ? "old" : "fresh",
        invoice.status,
      ]);

      expect(bySubscription.sort()).toEqual([
        ["fresh", "paid"],
        ["old", "failed"],
        ["old", "paid"],
      ]);
    });

    it("settles the open invoice when a past due subscription is recovered", async () => {
      await subscribe("silver");

      const [row] = await subscriptionsOf(defaultOrgId);

      await completion(row, "subs_1");
      await lifecycle("subscription.payment_failed", row, "subs_1");
      await pay();

      const [recovering] = await subscriptionsOf(defaultOrgId);

      expect(recovering.status).toBe("past_due");

      await completion(recovering, "subs_2");

      expect((await subscriptionsOf(defaultOrgId))[0]).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_2",
      });
      expect((await allInvoices()).map((invoice) => invoice.status)).toEqual(["paid", "paid"]);
    });
  });

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

    expect(await talentRow(profileId)).toEqual({
      status: "canceled",
      providerSubscriptionId: "subs_t",
      currentPeriodEnd: monthAfter(monthAfter(today)),
    });
    expect(await currentSubscription()).toEqual(company);
    expect(await allInvoices()).toEqual(before);

    await talentWebhook("subscription.cancelled", talent);

    expect((await talentRow(profileId)).currentPeriodEnd).toBe(monthAfter(monthAfter(today)));
  });

  describe("Carreira Pro checkout attempts", () => {
    const talentAuth: PortalAuth = {
      handler: async () => new Response(null),
      resolvePrincipal: (headers) =>
        Promise.resolve({
          kind: "talent",
          profile: {
            id: headers.get("x-test-talent-id") ?? "",
            name: "Test",
            email: "t@example.com",
          },
        }),
    };

    const proApp = new Elysia().use(
      careerPlanRoutes(
        repos.careerPlan,
        talentAccess({
          auth: talentAuth,
          webOrigin,
          talent: repos.talent,
          companyActive: async () => false,
          individualPlan: repos.careerPlan.individual,
        }),
        stubGateway,
        webOrigin,
        repos.benefits,
      ),
    );

    function proCall(path: string, profileId: string) {
      return proApp.handle(
        new Request(`http://localhost/me/plan/${path}`, {
          method: "POST",
          headers: { "x-test-talent-id": profileId, origin: webOrigin },
        }),
      );
    }

    function completed(externalId: string, billId: string, providerId: string) {
      return talentWebhook("subscription.completed", {
        subscription: { id: providerId, amount: 7900 },
        checkout: { id: billId, externalId },
      });
    }

    beforeEach(() => {
      issued.length = 0;
      gatewayFailure = false;
    });

    it("subscribes again after a cancellation with a new external id", async () => {
      const profileId = await talentProfile();

      expect((await proCall("checkout", profileId)).status).toBe(200);
      expect((await completed(issued[0].externalId, "bill_1", "subs_first")).status).toBe(200);
      expect(await talentRow(profileId)).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_first",
      });

      expect((await proCall("cancel", profileId)).status).toBe(200);
      await db
        .update(talentSubscriptions)
        .set({ currentPeriodEnd: "2020-01-01" })
        .where(eq(talentSubscriptions.profileId, profileId));

      expect((await proCall("checkout", profileId)).status).toBe(200);
      expect(issued).toHaveLength(2);
      expect(issued[0].externalId).toMatch(new RegExp(`^talent:${profileId}:[a-z0-9]+$`));
      expect(issued[1].externalId).toMatch(new RegExp(`^talent:${profileId}:[a-z0-9]+$`));
      expect(issued[1].externalId).not.toBe(issued[0].externalId);

      expect((await completed(issued[1].externalId, "bill_2", "subs_second")).status).toBe(200);
      expect(await talentRow(profileId)).toEqual({
        status: "active",
        providerSubscriptionId: "subs_second",
        currentPeriodEnd: monthAfter(saoPauloDate(new Date())),
      });
    });

    function cancelCalls() {
      return abacateCalls.filter((entry) => entry.startsWith("/v2/subscriptions/cancel"));
    }

    function webhookOn(target: typeof app, externalId: string, billId: string, providerId: string) {
      return target.handle(
        new Request(`http://localhost/api/billing/webhook?webhookSecret=${webhookSecret}`, {
          method: "POST",
          body: JSON.stringify({
            id: randomUUID(),
            event: "subscription.completed",
            data: {
              subscription: { id: providerId, amount: 7900 },
              checkout: { id: billId, externalId },
            },
          }),
        }),
      );
    }

    async function agedPendingCheckout(profileId: string) {
      expect((await proCall("checkout", profileId)).status).toBe(200);
      await db
        .update(talentSubscriptions)
        .set({ updatedAt: new Date(Date.now() - 61 * 60_000) })
        .where(eq(talentSubscriptions.profileId, profileId));
    }

    async function lapsedActive(profileId: string) {
      const now = new Date();

      await db.insert(talentSubscriptions).values({
        profileId,
        status: "active",
        providerSubscriptionId: "subs_old",
        currentPeriodEnd: "2020-01-01",
        createdAt: now,
        updatedAt: now,
      });
    }

    it("cancels the first subscription when a second checkout is paid too", async () => {
      const profileId = await talentProfile();

      await agedPendingCheckout(profileId);
      expect((await proCall("checkout", profileId)).status).toBe(200);
      expect(issued).toHaveLength(2);

      await completed(issued[0].externalId, "bill_1", "subs_A");

      expect(cancelCalls()).toEqual([]);

      await completed(issued[1].externalId, "bill_2", "subs_B");

      expect(await talentRow(profileId)).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_B",
      });
      expect(cancelCalls()).toEqual(['/v2/subscriptions/cancel {"id":"subs_A"}']);
    });

    it("cancels the old subscription when an active Carreira Pro whose period ended re-subscribes", async () => {
      const profileId = await talentProfile();

      await lapsedActive(profileId);
      expect((await proCall("checkout", profileId)).status).toBe(200);

      await completed(issued[0].externalId, "bill_1", "subs_new");

      expect(await talentRow(profileId)).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_new",
      });
      expect(cancelCalls()).toEqual(['/v2/subscriptions/cancel {"id":"subs_old"}']);
    });

    it("does not cancel anything on a duplicate or repeated completion", async () => {
      const profileId = await talentProfile();

      await lapsedActive(profileId);
      await proCall("checkout", profileId);

      const body = {
        subscription: { id: "subs_new", amount: 7900 },
        checkout: { id: "bill_1", externalId: issued[0].externalId },
      };

      const sameDelivery = "00000000-0000-4000-8000-0000000000d1";

      await talentWebhook("subscription.completed", body, {}, sameDelivery);
      await talentWebhook("subscription.completed", body, {}, sameDelivery);
      await talentWebhook("subscription.completed", body);

      expect(cancelCalls()).toEqual(['/v2/subscriptions/cancel {"id":"subs_old"}']);
      expect(await talentRow(profileId)).toMatchObject({ providerSubscriptionId: "subs_new" });
    });

    it("logs both ids when billing is not configured or the cancel fails", async () => {
      const logged = vi.spyOn(console, "error");
      const options = { auth, sendEmail: () => Promise.resolve() };

      const unconfiguredApp = createApp(webOrigin, repos, {
        ...options,
        abacatepayWebhookSecret: webhookSecret,
      });

      const failingApp = createApp(webOrigin, repos, {
        ...options,
        abacatepay: {
          ...stubGateway,
          refundCheckout: () => Promise.resolve(),
          productExternalId: () => Promise.resolve("prod_x"),
          cancelSubscription: async () => {
            throw new Error("gateway down");
          },
        },
        abacatepayWebhookSecret: webhookSecret,
      });

      try {
        const cases = [
          { target: unconfiguredApp, providerId: "subs_n1", index: 0 },
          { target: failingApp, providerId: "subs_n2", index: 1 },
        ];

        for (const { target, providerId, index } of cases) {
          const profileId = await pendingTalent(index);

          await db
            .update(talentSubscriptions)
            .set({ providerSubscriptionId: providerId })
            .where(eq(talentSubscriptions.profileId, profileId));

          const response = await webhookOn(target, `talent:${profileId}`, "bill_1", "subs_kept");

          expect(response.status).toBe(200);
          expect(await talentRow(profileId)).toMatchObject({ providerSubscriptionId: "subs_kept" });
        }

        expect(logged).toHaveBeenCalledWith("superseded subscription could not be canceled", {
          superseded: "subs_n1",
          kept: "subs_kept",
        });
        expect(logged).toHaveBeenCalledWith("superseded subscription left active", {
          superseded: "subs_n2",
          kept: "subs_kept",
        });
        expect(abacateCalls).toEqual([]);
      } finally {
        logged.mockRestore();
      }
    });

    it("logs the subscription id of a malformed Carreira Pro reference", async () => {
      const logged = vi.spyOn(console, "error");

      try {
        await completed(`talent:${missingId}:a:b`, "bill_1", "subs_bad");

        expect(logged).toHaveBeenCalledWith("talent webhook ignored", {
          event: "subscription.completed",
          subscriptionId: "subs_bad",
        });
      } finally {
        logged.mockRestore();
      }
    });

    describe("company subscriptions", () => {
      async function bind(patch: Partial<typeof subscriptions.$inferInsert>) {
        await db.update(subscriptions).set(patch);
      }

      it("cancels the subscription of a stale company bill that was paid", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });

        await webhook("subscription.completed", {
          subscription: { id: "subs_stale", amount: 24900 },
          checkout: { id: "bill_old", externalId: `${subscriptionId}:abc` },
        });

        expect(cancelCalls()).toEqual(['/v2/subscriptions/cancel {"id":"subs_stale"}']);
        expect((await currentSubscription()).status).toBe("pending");
      });

      it("leaves a stale renewal alone and never cancels the live subscription", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        await webhook("subscription.renewed", {
          subscription: { id: "subs_stale", amount: 24900 },
          checkout: { id: "bill_old", externalId: subscriptionId },
        });

        await bind({ status: "active", checkoutId: "bill_a", providerSubscriptionId: "subs_live" });
        await webhook("subscription.completed", {
          subscription: { id: "subs_live", amount: 24900 },
          checkout: { id: "bill_b", externalId: subscriptionId },
        });

        expect(cancelCalls()).toEqual([]);
      });

      it("cancels the previous subscription when a company is rebound to a new one", async () => {
        await bind({
          status: "past_due",
          checkoutId: "bill_2",
          providerSubscriptionId: "subs_old",
        });

        await webhook("subscription.completed", {
          subscription: { id: "subs_new", amount: 24900 },
          checkout: { id: "bill_2", externalId: `${subscriptionId}:abc` },
          payment: { id: "pay_rebind" },
        });

        expect(await currentSubscription()).toMatchObject({
          status: "active",
          providerSubscriptionId: "subs_new",
        });
        expect(cancelCalls()).toEqual(['/v2/subscriptions/cancel {"id":"subs_old"}']);
      });
    });

    it("never lets an attempt suffix redirect a Carreira Pro event", async () => {
      const victim = await pendingTalent(1);
      const attacker = await pendingTalent(2);
      const logged = vi.spyOn(console, "error");

      try {
        const forged = [
          `talent:${attacker}:${victim}`,
          `talent:${attacker}:a:${victim}`,
          `talent:${attacker}:`,
          `talent::${victim}`,
        ];

        for (const externalId of forged) {
          expect((await completed(externalId, "bill_x", "subs_forged")).status).toBe(200);
        }

        expect(abacateCalls).toEqual([]);
        expect(await talentRow(victim)).toMatchObject({ status: "pending" });
        expect(await talentRow(attacker)).toMatchObject({ status: "pending" });

        await completed(`talent:${attacker}:abc`, "bill_x", "subs_attacker");

        expect(await talentRow(attacker)).toMatchObject({
          status: "active",
          providerSubscriptionId: "subs_attacker",
        });
        expect(await talentRow(victim)).toMatchObject({ status: "pending" });
      } finally {
        logged.mockRestore();
      }
    });
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

    expect((await repos.careerPlan.allowedBy(profileId, new Date())).allowedBy).toBe("individual");

    await talentWebhook("subscription.payment_failed", talentCheckout(profileId));

    expect((await talentRow(profileId)).status).toBe("past_due");
    expect((await repos.careerPlan.allowedBy(profileId, new Date())).allowedBy).toBeNull();
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
        await talentWebhook("subscription.plan_changed", talentCheckout(missingId)),
        await talentWebhook("subscription.payment_failed", talentCheckout(withoutRow)),
        await talentWebhook("subscription.cancelled", {
          checkout: { id: "bill_talent", externalId: "talent:not-a-uuid" },
        }),
      ];

      expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
      expect(logged).toHaveBeenCalledWith("talent webhook ignored", {
        event: "subscription.payment_failed",
      });
      expect(abacateCalls).toEqual([]);
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

  it("cancels the subscription of a checkout paid after the account was deleted", async () => {
    const logged = vi.spyOn(console, "error");
    const withoutRow = await talentProfile();
    const talent = { subscription: { id: "subs_gone", amount: 7900 } };

    try {
      for (const event of ["subscription.completed", "subscription.renewed"]) {
        abacateCalls.length = 0;

        const response = await talentWebhook(event, { ...talentCheckout(missingId), ...talent });

        expect(response.status).toBe(200);
        expect(abacateCalls.filter((call) => call.startsWith("/v2/subscriptions/cancel"))).toEqual([
          '/v2/subscriptions/cancel {"id":"subs_gone"}',
        ]);
        expect(abacateCalls.filter((call) => call.startsWith("/v2/checkouts/refund"))).toHaveLength(
          event === "subscription.completed" ? 1 : 0,
        );
        expect(logged).toHaveBeenCalledWith("talent subscription of a deleted account canceled", {
          event,
        });
      }

      abacateCalls.length = 0;
      await talentWebhook("subscription.completed", { ...talentCheckout(withoutRow), ...talent });

      expect(abacateCalls.filter((call) => call.startsWith("/v2/subscriptions/cancel"))).toEqual([
        '/v2/subscriptions/cancel {"id":"subs_gone"}',
      ]);
      expect(await db.select().from(talentSubscriptions)).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it("only logs a checkout paid after the account was deleted when billing is not configured", async () => {
    const logged = vi.spyOn(console, "error");

    const withoutBilling = createApp(webOrigin, repos, {
      auth,
      sendEmail: () => Promise.resolve(),
      abacatepayWebhookSecret: webhookSecret,
    });

    try {
      const response = await withoutBilling.handle(
        new Request(`http://localhost/api/billing/webhook?webhookSecret=${webhookSecret}`, {
          method: "POST",
          body: JSON.stringify({
            event: "subscription.completed",
            data: eventData({
              ...talentCheckout(missingId),
              subscription: { id: "subs_gone", amount: 7900 },
            }),
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(logged).toHaveBeenCalledWith(
        "talent webhook for a deleted account could not be canceled",
        { event: "subscription.completed" },
      );
      expect(abacateCalls).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it("keeps a canceled Carreira Pro canceled when renewals and failures arrive late", async () => {
    const profileId = await pendingTalent();
    const today = saoPauloDate(new Date());
    const talent = { ...talentCheckout(profileId), subscription: { id: "subs_t", amount: 7900 } };

    await talentWebhook("subscription.completed", talent);
    await talentWebhook("subscription.cancelled", talent);

    const end = monthAfter(today);

    await talentWebhook("subscription.payment_failed", talent);

    expect(await talentRow(profileId)).toEqual({
      status: "canceled",
      providerSubscriptionId: "subs_t",
      currentPeriodEnd: end,
    });

    await talentWebhook("subscription.renewed", talent);

    expect(await talentRow(profileId)).toEqual({
      status: "canceled",
      providerSubscriptionId: "subs_t",
      currentPeriodEnd: monthAfter(end),
    });
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
  describe("co-pay webhook", () => {
    const cancelled: string[] = [];

    let configured = true;

    const copayApp = createApp(webOrigin, repos, {
      auth,
      sendEmail: () => Promise.resolve(),
      abacatepay: {
        get configured() {
          return configured;
        },
        createSubscriptionCheckout: () => Promise.resolve({ id: "bill_x", url: "https://x" }),
        refundCheckout: () => Promise.resolve(),
        productExternalId: () => Promise.resolve("prod_x"),
        cancelSubscription(id: string) {
          cancelled.push(id);

          return Promise.resolve();
        },
      },
      abacatepayWebhookSecret: webhookSecret,
    });

    let profileId = "";
    let goldId = "";
    let platinumId = "";

    beforeEach(async () => {
      cancelled.length = 0;
      configured = true;
      await db.delete(benefitAssignments);
      await db.delete(copayProducts);

      const rows = await db.select().from(plans).orderBy(plans.monthlyPriceCents);

      goldId = rows[0].id;
      platinumId = rows[rows.length - 1].id;

      const [profile] = await db
        .insert(talentProfiles)
        .values({
          orgId: defaultOrgId,
          personalEmail: `pessoa-${randomUUID()}@exemplo.com`,
          name: "Pessoa Teste",
          sponsoredUntil: "2099-12-31",
        })
        .returning({ id: talentProfiles.id });

      profileId = profile.id;
      await db
        .insert(copayProducts)
        .values({ fromPlanId: goldId, toPlanId: platinumId, abacatePayProductId: "prod_1" });
    });

    async function assign(patch: Partial<typeof benefitAssignments.$inferInsert> = {}) {
      const owned = patch.copaySubscriptionId !== undefined && patch.copaySubscriptionId !== null;

      await db.insert(benefitAssignments).values({
        orgId: defaultOrgId,
        profileId,
        assignedPlanId: goldId,
        effectivePlanId: goldId,
        source: "manual",
        validUntil: "2099-12-31",
        copayCheckoutId: "bill_1",
        copayCheckoutUrl: owned ? null : "https://pay.example/bill_1",
        copayCheckoutAt: owned ? null : new Date(),
        copayPriceCents: 4000,
        ...patch,
      });
    }

    async function assignment() {
      const [row] = await db.select().from(benefitAssignments);

      return row;
    }

    function copayWebhook(
      event: string,
      externalId: string | null,
      subscription = "subs_1",
      checkoutId = "bill_1",
    ) {
      return copayApp.handle(
        new Request(`http://localhost/api/billing/webhook?webhookSecret=${webhookSecret}`, {
          method: "POST",
          body: JSON.stringify({
            id: randomUUID(),
            event,
            apiVersion: 2,
            data: {
              subscription: { id: subscription, amount: 1000 },
              ...(externalId !== null && { checkout: { id: checkoutId, externalId } }),
            },
          }),
        }),
      );
    }

    const monthFromToday = () => addMonths(saoPauloDate(new Date()), 1);

    it("subscription.completed of the issued checkout upgrades the plan and sets the period end", async () => {
      await assign();

      const res = await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}`);

      expect(res.status).toBe(200);
      expect(cancelled).toEqual([]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayCheckoutId: "bill_1",
        copayCheckoutUrl: null,
        copayCheckoutAt: null,
        copayPriceCents: 4000,
        copayPeriodEnd: monthFromToday(),
      });
    });

    it("routes a co-pay reference carrying an attempt suffix", async () => {
      await assign();

      await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}:mwz027`);

      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
      });
    });

    it("cancels a paid bill of another checkout and logs the rejection", async () => {
      await assign();

      const logged = vi.spyOn(console, "error");

      try {
        await copayWebhook(
          "subscription.completed",
          `copay:${profileId}:${platinumId}`,
          "subs_stray",
          "bill_stray",
        );

        expect(cancelled).toEqual(["subs_stray"]);
        expect(logged).toHaveBeenCalledWith("copay subscription rejected", {
          event: "subscription.completed",
          reason: "checkout does not match the issued one",
          profileId,
          subscriptionId: "subs_stray",
          checkoutId: "bill_stray",
        });
        expect(await assignment()).toMatchObject({
          effectivePlanId: goldId,
          copaySubscriptionId: null,
          copayCheckoutId: "bill_1",
        });
      } finally {
        logged.mockRestore();
      }
    });

    it("cancels a paid bill of a checkout that HR voided", async () => {
      await assign({
        copayCheckoutId: null,
        copayCheckoutUrl: null,
        copayCheckoutAt: null,
        copayPriceCents: null,
      });
      await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual(["subs_1"]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
      });
    });

    it("never activates another profile with a checkout that is not its own", async () => {
      await assign();

      const [other] = await db
        .insert(talentProfiles)
        .values({
          orgId: defaultOrgId,
          personalEmail: `pessoa-${randomUUID()}@exemplo.com`,
          name: "Outra Pessoa",
          sponsoredUntil: "2099-12-31",
        })
        .returning({ id: talentProfiles.id });

      await db.insert(benefitAssignments).values({
        orgId: defaultOrgId,
        profileId: other.id,
        assignedPlanId: goldId,
        effectivePlanId: goldId,
        source: "manual",
        validUntil: "2099-12-31",
        copayCheckoutId: "bill_other",
        copayCheckoutAt: new Date(),
      });

      await copayWebhook("subscription.completed", `copay:${other.id}:${platinumId}`);

      expect(cancelled).toEqual(["subs_1"]);

      const rows = await db.select().from(benefitAssignments);

      expect(rows.map((row) => row.copaySubscriptionId)).toEqual([null, null]);
    });

    it("cancels the incoming subscription when the target is already below the effective plan", async () => {
      await assign({ effectivePlanId: platinumId });
      await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual(["subs_1"]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: null,
      });
    });

    it("cancels the incoming subscription, never the owned one, when another is attached", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_2" });
      await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual(["subs_1"]);
      expect(await assignment()).toMatchObject({ copaySubscriptionId: "subs_2" });
    });

    it("logs instead of canceling when the gateway is not configured", async () => {
      await assign();
      configured = false;

      const logged = vi.spyOn(console, "error");

      try {
        await copayWebhook(
          "subscription.completed",
          `copay:${profileId}:${platinumId}`,
          "subs_x",
          "bill_x",
        );

        expect(cancelled).toEqual([]);
        expect(logged).toHaveBeenCalledWith(
          "copay subscription could not be canceled",
          expect.objectContaining({ subscriptionId: "subs_x" }),
        );
      } finally {
        logged.mockRestore();
      }
    });

    describe("when the conditional activation loses", () => {
      function lost(current: string | null | "gone") {
        const stale = {
          assignedPlanId: goldId,
          effectivePlanId: goldId,
          copaySubscriptionId: null,
          copayCheckoutId: "bill_1",
          copayCheckoutAt: new Date(),
          copayPeriodEnd: null,
          validUntil: "2099-12-31",
        };

        let reads = 0;

        return {
          ...repos.benefits,
          async findAssignmentByProfile() {
            reads += 1;

            if (reads === 1) return stale;

            return current === "gone" ? null : { ...stale, copaySubscriptionId: current };
          },
          async activateCopay() {
            return false;
          },
        };
      }

      async function deliver(current: string | null | "gone") {
        const event = parseWebhookEvent(
          JSON.stringify({
            event: "subscription.completed",
            data: {
              subscription: { id: "subs_1", amount: 1000 },
              checkout: { id: "bill_1", externalId: `copay:${profileId}:${platinumId}` },
            },
          }),
        );

        if (!event) throw new Error("invalid event");

        await applyWebhookEvent(
          repos.billing,
          lost(current),
          {
            configured: true,
            cancelSubscription: async (id) => void cancelled.push(id),
            refundCheckout: () => Promise.resolve(),
            productExternalId: () => Promise.resolve("prod_x"),
          },
          event,
          null,
        );
      }

      it("leaves a delivery alone when the winner is the same subscription", async () => {
        await deliver("subs_1");

        expect(cancelled).toEqual([]);
      });

      it("cancels only the incoming subscription when another one won", async () => {
        await deliver("subs_2");

        expect(cancelled).toEqual(["subs_1"]);
      });

      it("cancels the incoming subscription when the assignment vanished", async () => {
        await deliver("gone");

        expect(cancelled).toEqual(["subs_1"]);
      });

      it("cancels the incoming subscription when nobody owns the co-pay", async () => {
        await deliver(null);

        expect(cancelled).toEqual(["subs_1"]);
      });
    });

    it("lets only one of two concurrent deliveries for the checkout own the co-pay", async () => {
      await assign();

      const reference = `copay:${profileId}:${platinumId}`;

      await Promise.all([
        copayWebhook("subscription.completed", reference, "subs_a"),
        copayWebhook("subscription.completed", reference, "subs_b"),
      ]);

      const row = await assignment();

      expect(["subs_a", "subs_b"]).toContain(row.copaySubscriptionId);
      expect(cancelled).toEqual([row.copaySubscriptionId === "subs_a" ? "subs_b" : "subs_a"]);
    });

    it.each(["subscription.renewed", "subscription.trial_started"])(
      "cancels %s of a subscription the co-pay does not own",
      async (event) => {
        await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_2" });

        const logged = vi.spyOn(console, "error");

        try {
          await copayWebhook(event, `copay:${profileId}:${platinumId}`, "subs_stray");

          expect(cancelled).toEqual(["subs_stray"]);
          expect(logged).toHaveBeenCalledWith(
            "copay subscription rejected",
            expect.objectContaining({ event, subscriptionId: "subs_stray" }),
          );
          expect(await assignment()).toMatchObject({ copaySubscriptionId: "subs_2" });
        } finally {
          logged.mockRestore();
        }
      },
    );

    it("cancels a renewal when the co-pay has no owner at all", async () => {
      await assign();
      await copayWebhook("subscription.renewed", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual(["subs_1"]);
      expect(await assignment()).toMatchObject({ copaySubscriptionId: null });
    });

    it("ignores a cancellation or payment failure of a subscription it does not own", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_2" });
      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`, "subs_x");
      await copayWebhook(
        "subscription.payment_failed",
        `copay:${profileId}:${platinumId}`,
        "subs_x",
      );

      expect(cancelled).toEqual([]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_2",
        copayCheckoutAt: null,
      });
    });

    it("ignores co-pay references with a malformed plan, suffix or extra segment", async () => {
      await assign();

      for (const reference of [
        `copay:${profileId}:not-a-uuid`,
        `copay:${profileId}:${platinumId}:`,
        `copay:${profileId}:${platinumId}:a:b`,
        `copay:${profileId}`,
      ]) {
        await copayWebhook("subscription.completed", reference);
      }

      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
      });
    });

    it("ignores events for unknown profiles and malformed ids", async () => {
      const logged = vi.spyOn(console, "error");

      try {
        await assign();
        await copayWebhook("subscription.completed", `copay:${missingId}:${platinumId}`);
        await copayWebhook("subscription.completed", "copay:");

        expect(logged).toHaveBeenCalledTimes(3);
        expect(cancelled).toEqual(["subs_1"]);
        expect(await assignment()).toMatchObject({ effectivePlanId: goldId });
      } finally {
        logged.mockRestore();
      }
    });

    it("subscription.cancelled reverts the plan and clears the co-pay fields", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" });
      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
        copayCheckoutId: null,
        copayPriceCents: null,
        copayPeriodEnd: null,
      });
    });

    it("keeps the tier until the period end when the co-pay was already wound down", async () => {
      const periodEnd = monthFromToday();

      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayCheckoutAt: new Date(),
        copayPeriodEnd: periodEnd,
      });
      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual([]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayPeriodEnd: periodEnd,
      });
    });

    it("reverts a wound-down co-pay whose period end has passed", async () => {
      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayCheckoutAt: new Date(),
        copayPeriodEnd: "2020-01-01",
      });
      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
      });
    });

    it("reverts a co-pay marked before period ends were stored", async () => {
      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayCheckoutAt: new Date(),
      });
      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
      });
    });

    it("ignores a redelivered completion of the subscription it already owns", async () => {
      const periodEnd = "2027-01-01";

      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayPeriodEnd: periodEnd,
      });

      const res = await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}`);

      expect(res.status).toBe(200);
      expect(cancelled).toEqual([]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayPeriodEnd: periodEnd,
      });
    });

    it("stale cancel for wrong subscription is noop", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_2" });
      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_2",
      });
    });

    it("renewal after benefit expiry cancels subscription", async () => {
      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        validUntil: "2020-01-01",
      });
      await copayWebhook("subscription.renewed", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual(["subs_1"]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
      });
    });

    it("renewal within validity extends the period end and restores a wound-down co-pay", async () => {
      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayCheckoutAt: new Date(),
        copayPeriodEnd: "2026-01-01",
      });
      await copayWebhook("subscription.renewed", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual([]);
      expect(await assignment()).toMatchObject({
        copaySubscriptionId: "subs_1",
        copayCheckoutAt: null,
        copayPeriodEnd: monthFromToday(),
      });
    });

    it("payment failure keeps the tier and the subscription and winds the co-pay down", async () => {
      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayPeriodEnd: "2027-01-01",
      });

      const logged = vi.spyOn(console, "error");

      try {
        await copayWebhook("subscription.payment_failed", `copay:${profileId}:${platinumId}`);

        expect(logged).toHaveBeenCalledWith("copay payment failed", { profileId });
        expect(cancelled).toEqual([]);

        const row = await assignment();

        expect(row).toMatchObject({
          effectivePlanId: platinumId,
          copaySubscriptionId: "subs_1",
          copayPeriodEnd: "2027-01-01",
        });
        expect(row.copayCheckoutAt).not.toBeNull();
      } finally {
        logged.mockRestore();
      }
    });

    it("gives a failed payment four days of grace and shows it as pending until it recovers", async () => {
      await assign({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayPeriodEnd: "2020-01-01",
      });
      await copayWebhook("subscription.payment_failed", `copay:${profileId}:${platinumId}`);

      const today = saoPauloDate(new Date());

      const grace = new Date(Date.parse(`${today}T00:00:00Z`) + 4 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      expect(cancelled).toEqual([]);
      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
        copayPeriodEnd: grace,
      });
      expect((await assignment()).copayPaymentFailedAt).not.toBeNull();

      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({ copaySubscriptionId: "subs_1" });

      await copayWebhook("subscription.renewed", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({
        copayCheckoutAt: null,
        copayPaymentFailedAt: null,
        copayPeriodEnd: monthFromToday(),
      });
    });

    it("falls back to the provider subscription id", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" });
      await copayWebhook("subscription.cancelled", null);

      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
      });
    });

    it("does not upgrade from a completed event without an external id", async () => {
      await assign({ copaySubscriptionId: "subs_1" });
      await copayWebhook("subscription.completed", null);

      expect(await assignment()).toMatchObject({ effectivePlanId: goldId });
    });

    it("ignores unknown subscriptions without an external id", async () => {
      await assign({ copaySubscriptionId: "subs_1" });
      await copayWebhook("subscription.cancelled", null, "subs_other");

      expect(await assignment()).toMatchObject({ copaySubscriptionId: "subs_1" });
    });
  });

  describe("co-pay of a deleted account", () => {
    const cancelled: string[] = [];
    let configured = true;

    const orphanApp = createApp(webOrigin, repos, {
      auth,
      sendEmail: () => Promise.resolve(),
      abacatepay: {
        get configured() {
          return configured;
        },
        createSubscriptionCheckout: () => Promise.resolve({ id: "bill_x", url: "https://x" }),
        refundCheckout: () => Promise.resolve(),
        productExternalId: () => Promise.resolve("prod_x"),
        async cancelSubscription(id: string) {
          cancelled.push(id);
        },
      },
      abacatepayWebhookSecret: webhookSecret,
    });

    beforeEach(() => {
      cancelled.length = 0;
      configured = true;
    });

    function deliver(event: string, externalId: string) {
      return orphanApp.handle(
        new Request(`http://localhost/api/billing/webhook?webhookSecret=${webhookSecret}`, {
          method: "POST",
          body: JSON.stringify({
            id: randomUUID(),
            event,
            apiVersion: 2,
            data: {
              subscription: { id: "subs_orphan", amount: 1000 },
              checkout: { id: "bill_1", externalId },
            },
          }),
        }),
      );
    }

    const reference = `copay:${missingId}:${missingId}`;

    it.each(["subscription.completed", "subscription.renewed"])(
      "cancels the subscription of %s when the assignment is gone",
      async (event) => {
        const logged = vi.spyOn(console, "error");

        try {
          expect((await deliver(event, reference)).status).toBe(200);
          expect(cancelled).toEqual(["subs_orphan"]);
          expect(logged).toHaveBeenCalledWith("copay subscription of a deleted account canceled", {
            event,
          });
        } finally {
          logged.mockRestore();
        }
      },
    );

    it("ignores events that do not charge", async () => {
      const logged = vi.spyOn(console, "error");

      try {
        await deliver("subscription.cancelled", reference);

        expect(cancelled).toEqual([]);
        expect(logged).toHaveBeenCalledWith("copay webhook ignored", {
          event: "subscription.cancelled",
        });
      } finally {
        logged.mockRestore();
      }
    });

    it("logs when the gateway is not configured", async () => {
      const logged = vi.spyOn(console, "error");

      configured = false;

      try {
        await deliver("subscription.completed", reference);

        expect(cancelled).toEqual([]);
        expect(logged).toHaveBeenCalledWith(
          "copay webhook for a deleted account could not be canceled",
          { event: "subscription.completed" },
        );
      } finally {
        logged.mockRestore();
      }
    });
  });

  describe("co-pay expiry sweep", () => {
    const cancelled: string[] = [];
    const failing = new Set<string>();
    let configured = true;

    const abacatepay = {
      get configured() {
        return configured;
      },
      createSubscriptionCheckout: () => Promise.resolve({ id: "bill_x", url: "https://x" }),
      refundCheckout: () => Promise.resolve(),
      productExternalId: () => Promise.resolve("prod_x"),
      async cancelSubscription(id: string) {
        if (failing.has(id)) throw new Error("gateway down");

        cancelled.push(id);
      },
    };

    const sweepApp = createApp(webOrigin, repos, {
      auth,
      sendEmail: () => Promise.resolve(),
      cronSecret: "sweep-secret",
      catalog: [],
      abacatepay,
    });

    let goldId = "";
    let platinumId = "";

    beforeEach(async () => {
      cancelled.length = 0;
      failing.clear();
      configured = true;
      await db.delete(benefitAssignments);

      const rows = await db.select().from(plans).orderBy(plans.monthlyPriceCents);

      goldId = rows[0].id;
      platinumId = rows[rows.length - 1].id;
    });

    async function upgraded(
      subscription: string | null,
      validUntil: string,
      effectivePlanId = platinumId,
    ) {
      const [profile] = await db
        .insert(talentProfiles)
        .values({
          orgId: defaultOrgId,
          personalEmail: `pessoa-${randomUUID()}@exemplo.com`,
          name: "Pessoa Teste",
          sponsoredUntil: "2099-12-31",
        })
        .returning({ id: talentProfiles.id });

      await db.insert(benefitAssignments).values({
        orgId: defaultOrgId,
        profileId: profile.id,
        assignedPlanId: goldId,
        effectivePlanId,
        source: "manual",
        validUntil,
        copaySubscriptionId: subscription,
        copayCheckoutAt: subscription === null ? null : new Date(),
      });

      return profile.id;
    }

    async function stateOf(profileId: string) {
      const [row] = await db
        .select()
        .from(benefitAssignments)
        .where(eq(benefitAssignments.profileId, profileId));

      return row;
    }

    function drainWith(instance: { handle: (request: Request) => Promise<Response> }) {
      return instance.handle(
        new Request("http://localhost/api/background/drain", {
          method: "POST",
          headers: { authorization: "Bearer sweep-secret" },
        }),
      );
    }

    const drainNow = () => drainWith(sweepApp);

    it("cancels expired co-pay subscriptions and restores the assigned plan", async () => {
      const today = saoPauloDate(new Date());
      const yesterday = saoPauloDate(new Date(Date.now() - 86_400_000));
      const expired = await upgraded("subs_expired", yesterday);
      const endsToday = await upgraded("subs_today", today);
      const future = await upgraded("subs_future", "2099-12-31");
      const plain = await upgraded(null, yesterday, goldId);

      expect((await drainNow()).status).toBe(200);
      expect(cancelled).toEqual(["subs_expired"]);
      expect(await stateOf(expired)).toMatchObject({
        copaySubscriptionId: null,
        effectivePlanId: goldId,
        copayCheckoutAt: null,
      });
      expect(await stateOf(endsToday)).toMatchObject({ copaySubscriptionId: "subs_today" });
      expect(await stateOf(future)).toMatchObject({ copaySubscriptionId: "subs_future" });
      expect(await stateOf(plain)).toMatchObject({ copaySubscriptionId: null });
    });

    it("reverts wound-down co-pays at their period end and keeps healthy and unfinished ones", async () => {
      const today = saoPauloDate(new Date());
      const yesterday = saoPauloDate(new Date(Date.now() - 86_400_000));
      const ended = await upgraded("subs_ended", "2099-12-31");
      const lasting = await upgraded("subs_lasting", "2099-12-31");
      const renewing = await upgraded("subs_renewing", "2099-12-31");

      const wound = (profileId: string, copayPeriodEnd: string) =>
        db
          .update(benefitAssignments)
          .set({ copayCheckoutAt: new Date(), copayPeriodEnd })
          .where(eq(benefitAssignments.profileId, profileId));

      await wound(ended, yesterday);
      await wound(lasting, today);
      await db
        .update(benefitAssignments)
        .set({ copayCheckoutAt: null, copayPeriodEnd: yesterday })
        .where(eq(benefitAssignments.profileId, renewing));

      await drainNow();

      expect(cancelled).toEqual(["subs_ended"]);
      expect(await stateOf(ended)).toMatchObject({
        copaySubscriptionId: null,
        effectivePlanId: goldId,
        copayPeriodEnd: null,
      });
      expect(await stateOf(lasting)).toMatchObject({ copaySubscriptionId: "subs_lasting" });
      expect(await stateOf(renewing)).toMatchObject({ copaySubscriptionId: "subs_renewing" });
    });

    it("sweeps at most 20 per tick and is idempotent", async () => {
      const profiles = await db
        .insert(talentProfiles)
        .values(
          Array.from({ length: 25 }, () => ({
            orgId: defaultOrgId,
            personalEmail: `pessoa-${randomUUID()}@exemplo.com`,
            name: "Pessoa Teste",
            sponsoredUntil: "2099-12-31",
          })),
        )
        .returning({ id: talentProfiles.id });

      const ids = profiles.map((profile) => profile.id);

      await db.insert(benefitAssignments).values(
        ids.map((profileId, index) => ({
          orgId: defaultOrgId,
          profileId,
          assignedPlanId: goldId,
          effectivePlanId: platinumId,
          source: "manual",
          validUntil: "2000-01-01",
          copaySubscriptionId: `subs_${index}`,
        })) satisfies (typeof benefitAssignments.$inferInsert)[],
      );

      await drainNow();

      expect(cancelled).toHaveLength(20);

      await drainNow();

      expect(cancelled).toHaveLength(25);
      expect(new Set(cancelled).size).toBe(25);

      await drainNow();

      expect(cancelled).toHaveLength(25);

      for (const id of ids) {
        expect(await stateOf(id)).toMatchObject({
          copaySubscriptionId: null,
          effectivePlanId: goldId,
        });
      }
    });

    it("keeps a failing subscription for the next tick without blocking the others", async () => {
      const logged = vi.spyOn(console, "error");
      const broken = await upgraded("subs_broken", "2000-01-01");
      const fine = await upgraded("subs_fine", "2000-01-01");

      failing.add("subs_broken");

      try {
        expect((await drainNow()).status).toBe(200);
        expect(cancelled).toEqual(["subs_fine"]);
        expect(await stateOf(broken)).toMatchObject({
          copaySubscriptionId: "subs_broken",
          effectivePlanId: platinumId,
        });
        expect(await stateOf(fine)).toMatchObject({ copaySubscriptionId: null });
        expect(logged).toHaveBeenCalledWith("co-pay expiry cancellation failed", expect.anything());

        failing.clear();
        await drainNow();

        expect(cancelled).toEqual(["subs_fine", "subs_broken"]);
        expect(await stateOf(broken)).toMatchObject({
          copaySubscriptionId: null,
          effectivePlanId: goldId,
        });
      } finally {
        logged.mockRestore();
      }
    });

    it("stops at the time budget when the gateway hangs and still runs the other drain work", async () => {
      const logged = vi.spyOn(console, "error");
      const attempts: string[] = [];
      let elapsed = 0;

      const hanging = createApp(webOrigin, repos, {
        auth,
        sendEmail: () => Promise.resolve(),
        cronSecret: "sweep-secret",
        catalog: [],
        clock: () => elapsed,
        abacatepay: {
          configured: true,
          createSubscriptionCheckout: () => Promise.resolve({ id: "bill_x", url: "https://x" }),
          refundCheckout: () => Promise.resolve(),
          productExternalId: () => Promise.resolve("prod_x"),
          async cancelSubscription(id: string) {
            attempts.push(id);
            elapsed += 10_000;

            throw new Error("gateway hung");
          },
        },
      });

      for (let index = 0; index < 5; index += 1) {
        await upgraded(`subs_${index}`, "2000-01-01");
      }

      await repos.background.enqueue("score_resume", randomUUID());

      try {
        const res = await drainWith(hanging);

        expect(res.status).toBe(200);
        expect(attempts).toHaveLength(2);
        expect((await res.json()).processed).toBeGreaterThanOrEqual(1);
      } finally {
        logged.mockRestore();
      }
    });

    it("does not let rows that always fail starve the others", async () => {
      const logged = vi.spyOn(console, "error");

      const profiles = await db
        .insert(talentProfiles)
        .values(
          Array.from({ length: 22 }, () => ({
            orgId: defaultOrgId,
            personalEmail: `pessoa-${randomUUID()}@exemplo.com`,
            name: "Pessoa Teste",
            sponsoredUntil: "2099-12-31",
          })),
        )
        .returning({ id: talentProfiles.id });

      await db.insert(benefitAssignments).values(
        profiles.map((profile, index) => ({
          orgId: defaultOrgId,
          profileId: profile.id,
          assignedPlanId: goldId,
          effectivePlanId: platinumId,
          source: "manual",
          validUntil: index < 20 ? "2000-01-01" : "2000-01-02",
          copaySubscriptionId: index < 20 ? `subs_bad_${index}` : `subs_good_${index}`,
        })) satisfies (typeof benefitAssignments.$inferInsert)[],
      );

      for (let index = 0; index < 20; index += 1) failing.add(`subs_bad_${index}`);

      try {
        for (let tick = 0; tick < 12 && cancelled.length < 2; tick += 1) await drainNow();

        expect([...cancelled].sort()).toEqual(["subs_good_20", "subs_good_21"]);
      } finally {
        logged.mockRestore();
      }
    });

    it("still runs the other drain work when the sweep fails", async () => {
      const logged = vi.spyOn(console, "error");

      await upgraded("subs_broken", "2000-01-01");
      failing.add("subs_broken");
      await repos.background.enqueue("score_resume", randomUUID());

      try {
        const res = await drainNow();

        expect(res.status).toBe(200);
        expect((await res.json()).processed).toBeGreaterThanOrEqual(1);
      } finally {
        logged.mockRestore();
      }
    });

    it("survives a failing lookup of expired subscriptions", async () => {
      const logged = vi.spyOn(console, "error");

      const broken = createApp(
        webOrigin,
        {
          ...repos,
          benefits: {
            ...repos.benefits,
            expiredCopays: () => Promise.reject(new Error("db down")),
          },
        },
        {
          auth,
          sendEmail: () => Promise.resolve(),
          cronSecret: "sweep-secret",
          catalog: [],
          abacatepay,
        },
      );

      try {
        expect((await drainWith(broken)).status).toBe(200);
        expect(logged).toHaveBeenCalledWith("co-pay expiry sweep failed", expect.anything());
      } finally {
        logged.mockRestore();
      }
    });

    it("leaves everything alone when billing is not configured", async () => {
      const expired = await upgraded("subs_expired", "2000-01-01");

      configured = false;

      expect((await drainNow()).status).toBe(200);
      expect(cancelled).toEqual([]);
      expect(await stateOf(expired)).toMatchObject({ copaySubscriptionId: "subs_expired" });
    });
  });

  describe("benefit invoices", () => {
    const period = saoPauloDate(new Date()).slice(0, 7);
    let goldId = "";
    let platinumId = "";

    beforeEach(async () => {
      await db.delete(benefitAssignments);
      await db.delete(benefitInvoices);

      const rows = await db.select().from(plans).orderBy(plans.monthlyPriceCents);

      goldId = rows[0].id;
      platinumId = rows[rows.length - 1].id;
    });

    async function assignPlan(planId: string, validUntil = "2099-12-31") {
      const [profile] = await db
        .insert(talentProfiles)
        .values({
          orgId: defaultOrgId,
          personalEmail: `pessoa-${randomUUID()}@exemplo.com`,
          name: "Pessoa Teste",
          sponsoredUntil: "2099-12-31",
        })
        .returning({ id: talentProfiles.id });

      await db.insert(benefitAssignments).values({
        orgId: defaultOrgId,
        profileId: profile.id,
        assignedPlanId: planId,
        effectivePlanId: planId,
        source: "manual",
        validUntil,
      });
    }

    async function priceOf(planId: string) {
      const [row] = await db.select().from(plans).where(eq(plans.id, planId));

      return row.perPersonPriceCents;
    }

    const generate = () => call("/billing/benefit-invoices/generate", { method: "POST" });

    it("generates a benefit invoice for the current month", async () => {
      await assignPlan(goldId);
      await assignPlan(goldId);
      await assignPlan(platinumId);

      const res = await generate();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: expect.any(String),
        period,
        totalCents: (await priceOf(goldId)) * 2 + (await priceOf(platinumId)),
        status: "draft",
      });
    });

    it("generate is idempotent", async () => {
      await assignPlan(goldId);

      const first = await (await generate()).json();
      const second = await (await generate()).json();

      expect(second.id).toBe(first.id);
    });

    it("generate excludes expired assignments", async () => {
      await assignPlan(goldId);
      await assignPlan(platinumId, "2000-01-01");

      expect((await (await generate()).json()).totalCents).toBe(await priceOf(goldId));
    });

    it("restricts generation to admins", async () => {
      const res = await call("/billing/benefit-invoices/generate", {
        method: "POST",
        session: "rh",
      });

      expect(res.status).toBe(403);
    });

    it("lists benefit invoices by period descending", async () => {
      await db.insert(benefitInvoices).values([
        { orgId: defaultOrgId, period: "2026-01", totalCents: 100 },
        { orgId: defaultOrgId, period: "2026-03", totalCents: 300 },
      ]);

      const res = await call("/billing/benefit-invoices", { session: "rh" });
      const list = await res.json();

      expect(res.status).toBe(200);
      expect(list.map((invoice: { period: string }) => invoice.period)).toEqual([
        "2026-03",
        "2026-01",
      ]);
    });

    it("returns empty when no invoices", async () => {
      const res = await call("/billing/benefit-invoices");

      expect(await res.json()).toEqual([]);
    });
  });

  describe("automatic refunds and plan changes", () => {
    type RefundEventData = {
      subscription: { id: string; amount: number };
      checkout?: { id: string; externalId: string };
      payment?: { id: string };
      productId?: string;
      status?: string;
    };

    const duplicateReason = "Cobrança duplicada cancelada automaticamente";
    const planChangeReason = "Troca de plano não suportada cancelada automaticamente";
    const cancels: string[] = [];
    const refunds: { chargeId: string; reason: string }[] = [];
    const products = new Map<string, string>();
    let refundFailure = false;
    let configured = true;
    let logged: MockInstance<typeof console.error>;

    const gateway = {
      get configured() {
        return configured;
      },
      cancelSubscription: async (id: string) => void cancels.push(id),
      refundCheckout: async (chargeId: string, reason: string) => {
        if (refundFailure) throw new Error("refund down");

        refunds.push({ chargeId, reason });
      },
      productExternalId: async (productId: string) => {
        const found = products.get(productId);

        if (found === undefined) throw new Error("unknown product");

        return found;
      },
    };

    const brokenCancel = {
      ...gateway,
      cancelSubscription: async () => {
        throw new Error("cancel down");
      },
    };

    let profileId = "";
    let goldId = "";
    let platinumId = "";

    beforeAll(() => {
      logged = vi.spyOn(console, "error");
    });

    afterAll(() => {
      logged.mockRestore();
    });

    beforeEach(async () => {
      cancels.length = 0;
      refunds.length = 0;
      products.clear();
      refundFailure = false;
      configured = true;
      logged.mockClear();
      await db.delete(benefitAssignments);
      await db.delete(copayProducts);
      await db.delete(talentSubscriptions);

      const rows = await db.select().from(plans).orderBy(plans.monthlyPriceCents);

      goldId = rows[0].id;
      platinumId = rows[rows.length - 1].id;
    });

    async function deliver(event: string, data: RefundEventData, target: typeof gateway = gateway) {
      const parsed = parseWebhookEvent(JSON.stringify({ id: randomUUID(), event, data }));

      if (!parsed) throw new Error("invalid event");

      await applyWebhookEvent(repos.billing, repos.benefits, target, parsed, null);
    }

    function logCalls(message: string) {
      return logged.mock.calls.filter(([first]) => first === message);
    }

    describe("company subscriptions", () => {
      const stale = () => ({
        subscription: { id: "subs_stale", amount: 24900 },
        checkout: { id: "bill_old", externalId: `${subscriptionId}:abc` },
      });

      async function bind(patch: Partial<typeof subscriptions.$inferInsert>) {
        await db.update(subscriptions).set(patch);
      }

      async function current() {
        const [row] = await db.select().from(subscriptions);

        return row;
      }

      it("refunds the charge of a stale checkout that was paid", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        await deliver("subscription.completed", stale());

        expect(cancels).toEqual(["subs_stale"]);
        expect(refunds).toEqual([{ chargeId: "bill_old", reason: duplicateReason }]);
      });

      it("refunds a stale checkout only once when the event is delivered again", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        await deliver("subscription.completed", stale());
        await deliver("subscription.completed", stale());

        expect(cancels).toEqual(["subs_stale", "subs_stale"]);
        expect(refunds).toHaveLength(1);
      });

      it("does not refund a stale renewal", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        await deliver("subscription.renewed", stale());

        expect(cancels).toEqual([]);
        expect(refunds).toEqual([]);
      });

      it("never refunds the live subscription", async () => {
        await bind({ status: "active", checkoutId: "bill_a", providerSubscriptionId: "subs_live" });
        await deliver("subscription.completed", {
          subscription: { id: "subs_live", amount: 24900 },
          checkout: { id: "bill_b", externalId: subscriptionId },
        });

        expect(cancels).toEqual([]);
        expect(refunds).toEqual([]);
      });

      it("cancels the previous subscription of a rebound company without refunding the new one", async () => {
        await bind({
          status: "past_due",
          checkoutId: "bill_2",
          providerSubscriptionId: "subs_old",
        });
        await deliver("subscription.completed", {
          subscription: { id: "subs_new", amount: 24900 },
          checkout: { id: "bill_2", externalId: `${subscriptionId}:abc` },
          payment: { id: "pay_rebind" },
        });

        expect(cancels).toEqual(["subs_old"]);
        expect(refunds).toEqual([]);
      });

      it("keeps the charge when the cancellation fails so a redelivery can retry", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        await deliver("subscription.completed", stale(), brokenCancel);

        expect(refunds).toEqual([]);

        await deliver("subscription.completed", stale());

        expect(refunds).toHaveLength(1);
      });

      it("does not refund when the gateway is not configured", async () => {
        configured = false;
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        await deliver("subscription.completed", stale());

        expect(refunds).toEqual([]);
      });

      it("logs a failed refund with both ids and retries on redelivery", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        refundFailure = true;

        const paid = { ...stale(), payment: { id: "pay_old" } };

        await expect(deliver("subscription.completed", paid)).resolves.toBeUndefined();

        expect(logged).toHaveBeenCalledWith("refund failed", {
          subscriptionId: "subs_stale",
          checkoutId: "bill_old",
          chargeId: "pay_old",
          name: "Error",
          message: "refund down",
        });

        refundFailure = false;
        await deliver("subscription.completed", paid);

        expect(refunds).toEqual([{ chargeId: "pay_old", reason: duplicateReason }]);
      });

      it("refunds the payment of the event instead of the checkout", async () => {
        await bind({ status: "pending", checkoutId: "bill_live", providerSubscriptionId: null });
        await deliver("subscription.completed", { ...stale(), payment: { id: "pay_old" } });

        expect(refunds).toEqual([{ chargeId: "pay_old", reason: duplicateReason }]);
      });

      describe("plan_changed", () => {
        const changed = (
          productId: string | undefined,
          subscription = "subs_live",
          status = "PENDING",
        ) => ({
          subscription: { id: subscription, amount: 24900 },
          checkout: { id: "bill_1", externalId: subscriptionId },
          productId,
          status,
        });

        beforeEach(async () => {
          await bind({
            status: "active",
            checkoutId: "bill_1",
            providerSubscriptionId: "subs_live",
          });
        });

        it("moves the subscription to the plan of the new product and logs it", async () => {
          products.set("prod_silver", "silver");
          await deliver("subscription.plan_changed", changed("prod_silver"));

          expect((await current()).planId).toBe(await planId("silver"));
          expect(logCalls("company plan change")).toHaveLength(1);
        });

        it("matches the plan by product id when the external id is not a slug", async () => {
          products.set("platinum", "ext-1");
          await deliver("subscription.plan_changed", changed("platinum"));

          expect((await current()).planId).toBe(await planId("platinum"));
        });

        it("does nothing when the product is the plan already held", async () => {
          products.set("prod_gold", "gold");
          await deliver("subscription.plan_changed", changed("prod_gold"));

          expect((await current()).planId).toBe(await planId("gold"));
          expect(logCalls("company plan change")).toEqual([]);
        });

        it("logs a product that is none of our plans and keeps the plan", async () => {
          products.set("prod_x", "mystery");
          await deliver("subscription.plan_changed", changed("prod_x"));

          expect((await current()).planId).toBe(await planId("gold"));
          expect(logged).toHaveBeenCalledWith(
            "company plan change",
            expect.objectContaining({ known: false, externalId: "mystery" }),
          );
        });

        it("logs a failed product lookup and keeps the plan", async () => {
          await deliver("subscription.plan_changed", changed("prod_unknown"));

          expect((await current()).planId).toBe(await planId("gold"));
          expect(logCalls("plan change product lookup failed")).toHaveLength(1);
        });

        it("ignores a subscription the company does not own", async () => {
          products.set("prod_silver", "silver");
          await deliver("subscription.plan_changed", changed("prod_silver", "subs_other"));

          expect((await current()).planId).toBe(await planId("gold"));
        });

        it.each([
          ["a cancelled change", "prod_silver", "CANCELLED"],
          ["the applied notice without a product", undefined, "APPLIED"],
        ])("ignores %s", async (_label, productId, status) => {
          products.set("prod_silver", "silver");
          await deliver("subscription.plan_changed", changed(productId, "subs_live", status));

          expect((await current()).planId).toBe(await planId("gold"));
          expect(logCalls("plan change product lookup failed")).toEqual([]);
        });
      });
    });

    describe("Carreira Pro", () => {
      let reference = "";

      async function subscribed(provider: string | null) {
        profileId = await talentProfile();
        reference = `talent:${profileId}`;

        const now = new Date();

        await db.insert(talentSubscriptions).values({
          profileId,
          status: "active",
          providerSubscriptionId: provider,
          currentPeriodEnd: "2099-01-01",
          createdAt: now,
          updatedAt: now,
        });
      }

      const event = (subscription: string, checkout: string | null = "bill_pro") => ({
        subscription: { id: subscription, amount: 7900 },
        ...(checkout !== null && { checkout: { id: checkout, externalId: reference } }),
      });

      it("keeps the new subscription and refunds nothing when the previous one is replaced", async () => {
        await subscribed("subs_old");
        await deliver("subscription.completed", event("subs_new", "bill_new"));

        expect(cancels).toEqual(["subs_old"]);
        expect(refunds).toEqual([]);
      });

      it.each(["subscription.completed", "subscription.renewed"])(
        "refunds %s of a deleted account",
        async (name) => {
          reference = `talent:${missingId}`;
          await deliver(name, {
            ...event("subs_orphan", "bill_orphan"),
            payment: { id: "pay_orphan" },
          });

          expect(cancels).toEqual(["subs_orphan"]);
          expect(refunds).toEqual([{ chargeId: "pay_orphan", reason: duplicateReason }]);
        },
      );

      it("never refunds the checkout of a deleted account's renewal without a payment", async () => {
        reference = `talent:${missingId}`;
        await deliver("subscription.renewed", event("subs_orphan", "bill_orphan"));

        expect(cancels).toEqual(["subs_orphan"]);
        expect(refunds).toEqual([]);
        expect(logged).toHaveBeenCalledWith("refund needs manual action", {
          subscriptionId: "subs_orphan",
          checkoutId: "bill_orphan",
        });
      });

      it("does not refund an event that charges nothing for a deleted account", async () => {
        reference = `talent:${missingId}`;
        await deliver("subscription.cancelled", event("subs_orphan", "bill_orphan"));

        expect(cancels).toEqual([]);
        expect(refunds).toEqual([]);
      });

      it("does not refund the owned subscription renewing", async () => {
        await subscribed("subs_pro");
        await deliver("subscription.renewed", event("subs_pro"));

        expect(cancels).toEqual([]);
        expect(refunds).toEqual([]);
      });

      describe("plan_changed", () => {
        const changed = (
          productId: string,
          subscription = "subs_pro",
          checkout: string | null = "bill_pro",
        ) => ({ ...event(subscription, checkout), productId, status: "PENDING" });

        beforeEach(async () => {
          await subscribed("subs_pro");
        });

        it.each([
          ["its external id", "prod_pro", "carreira-pro"],
          ["its product id", "carreira-pro", "other"],
        ])("accepts the product matched by %s", async (_label, productId, externalId) => {
          products.set(productId, externalId);
          await deliver("subscription.plan_changed", changed(productId));

          expect(cancels).toEqual([]);
          expect(refunds).toEqual([]);
        });

        it("cancels and refunds a change to another product", async () => {
          products.set("prod_other", "enterprise");
          await deliver("subscription.plan_changed", changed("prod_other"));

          expect(cancels).toEqual(["subs_pro"]);
          expect(refunds).toEqual([{ chargeId: "bill_pro", reason: planChangeReason }]);
          expect(logCalls("talent plan change not supported")).toHaveLength(1);
        });

        it("refunds once when the change is delivered again", async () => {
          products.set("prod_other", "enterprise");
          await deliver("subscription.plan_changed", changed("prod_other"));
          await deliver("subscription.plan_changed", changed("prod_other"));

          expect(refunds).toHaveLength(1);
        });

        it("cancels without a refund when the event carries no checkout", async () => {
          products.set("prod_other", "enterprise");
          await deliver("subscription.plan_changed", changed("prod_other", "subs_pro", null));

          expect(cancels).toEqual(["subs_pro"]);
          expect(refunds).toEqual([]);
        });

        it("logs a failed refund and does not throw", async () => {
          products.set("prod_other", "enterprise");
          refundFailure = true;

          await expect(
            deliver("subscription.plan_changed", changed("prod_other")),
          ).resolves.toBeUndefined();

          expect(logged).toHaveBeenCalledWith(
            "refund failed",
            expect.objectContaining({ subscriptionId: "subs_pro", checkoutId: "bill_pro" }),
          );
        });

        it("only logs when the gateway is not configured", async () => {
          configured = false;
          products.set("prod_other", "enterprise");
          await deliver("subscription.plan_changed", changed("prod_other"));

          expect(cancels).toEqual([]);
          expect(refunds).toEqual([]);
          expect(logCalls("talent plan change not supported")).toHaveLength(1);
        });

        it("ignores a subscription the profile does not own", async () => {
          products.set("prod_other", "enterprise");
          await deliver("subscription.plan_changed", changed("prod_other", "subs_stray"));

          expect(cancels).toEqual([]);
          expect(refunds).toEqual([]);
        });

        it("ignores a change whose product cannot be resolved", async () => {
          await deliver("subscription.plan_changed", changed("prod_unknown"));

          expect(cancels).toEqual([]);
        });
      });
    });

    describe("co-pay", () => {
      async function seed(patch: Partial<typeof benefitAssignments.$inferInsert> = {}) {
        const [profile] = await db
          .insert(talentProfiles)
          .values({
            orgId: defaultOrgId,
            personalEmail: `pessoa-${randomUUID()}@exemplo.com`,
            name: "Pessoa Teste",
            sponsoredUntil: "2099-12-31",
          })
          .returning({ id: talentProfiles.id });

        profileId = profile.id;
        await db
          .insert(copayProducts)
          .values({ fromPlanId: goldId, toPlanId: platinumId, abacatePayProductId: "prod_1" });

        const owned = patch.copaySubscriptionId !== undefined && patch.copaySubscriptionId !== null;

        await db.insert(benefitAssignments).values({
          orgId: defaultOrgId,
          profileId,
          assignedPlanId: goldId,
          effectivePlanId: goldId,
          source: "manual",
          validUntil: "2099-12-31",
          copayCheckoutId: "bill_1",
          copayCheckoutUrl: owned ? null : "https://pay.example/bill_1",
          copayCheckoutAt: owned ? null : new Date(),
          copayPriceCents: 4000,
          ...patch,
        });
      }

      async function assignment() {
        const [row] = await db.select().from(benefitAssignments);

        return row;
      }

      const event = (
        subscription: string,
        checkout: string,
        extra: { productId?: string; status?: string } = {},
      ) => ({
        subscription: { id: subscription, amount: 1000 },
        checkout: { id: checkout, externalId: `copay:${profileId}:${platinumId}` },
        ...extra,
      });

      it("refunds a paid bill whose checkout is not the issued one", async () => {
        await seed();
        await deliver("subscription.completed", event("subs_stray", "bill_stray"));

        expect(cancels).toEqual(["subs_stray"]);
        expect(refunds).toEqual([{ chargeId: "bill_stray", reason: duplicateReason }]);
        expect(logCalls("copay subscription rejected")).toHaveLength(1);
      });

      it("refunds a bill that is not an upgrade", async () => {
        await seed({ assignedPlanId: platinumId, effectivePlanId: platinumId });
        await deliver("subscription.completed", event("subs_1", "bill_1"));

        expect(cancels).toEqual(["subs_1"]);
        expect(refunds).toEqual([{ chargeId: "bill_1", reason: duplicateReason }]);
      });

      it("refunds a stray renewal but not a stray trial", async () => {
        await seed({ effectivePlanId: platinumId, copaySubscriptionId: "subs_2" });
        await deliver("subscription.renewed", {
          ...event("subs_stray", "bill_stray"),
          payment: { id: "pay_stray" },
        });
        await deliver("subscription.trial_started", event("subs_trial", "bill_trial"));

        expect(cancels).toEqual(["subs_stray", "subs_trial"]);
        expect(refunds).toEqual([{ chargeId: "pay_stray", reason: duplicateReason }]);
      });

      it("skips a stray renewal without a payment and logs it for manual action", async () => {
        await seed({ effectivePlanId: platinumId, copaySubscriptionId: "subs_2" });
        await deliver("subscription.renewed", event("subs_stray", "bill_stray"));

        expect(cancels).toEqual(["subs_stray"]);
        expect(refunds).toEqual([]);
        expect(logged).toHaveBeenCalledWith("refund needs manual action", {
          subscriptionId: "subs_stray",
          checkoutId: "bill_stray",
        });
      });

      it("falls back to the checkout when a stray completed has no payment", async () => {
        await seed();
        await deliver("subscription.completed", event("subs_stray", "bill_stray"));

        expect(refunds).toEqual([{ chargeId: "bill_stray", reason: duplicateReason }]);
      });

      it("never refunds the checkout of the owned subscription", async () => {
        await seed({ effectivePlanId: platinumId, copaySubscriptionId: "subs_2" });
        await deliver("subscription.renewed", {
          ...event("subs_stray", "bill_1"),
          payment: { id: "pay_stray" },
        });
        await deliver("subscription.completed", event("subs_dup", "bill_1"));

        expect(cancels).toEqual(["subs_stray", "subs_dup"]);
        expect(refunds).toEqual([]);
      });

      it("never refunds the owned subscription renewing", async () => {
        await seed({ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" });
        await deliver("subscription.renewed", event("subs_1", "bill_1"));

        expect(cancels).toEqual([]);
        expect(refunds).toEqual([]);
      });

      it("does not refund the winner's checkout when the activation race is lost", async () => {
        await seed();

        const racing = {
          ...repos.benefits,
          async activateCopay() {
            await db
              .update(benefitAssignments)
              .set({ copaySubscriptionId: "subs_winner", effectivePlanId: platinumId });

            return false;
          },
        };

        const parsed = parseWebhookEvent(
          JSON.stringify({
            event: "subscription.completed",
            data: event("subs_loser", "bill_1"),
          }),
        );

        if (!parsed) throw new Error("invalid event");

        await applyWebhookEvent(repos.billing, racing, gateway, parsed, null);

        expect(cancels).toEqual(["subs_loser"]);
        expect(refunds).toEqual([]);
      });

      it("refunds a renewal after the benefit expired", async () => {
        await seed({
          effectivePlanId: platinumId,
          copaySubscriptionId: "subs_1",
          validUntil: "2020-01-01",
        });
        await deliver("subscription.renewed", {
          ...event("subs_1", "bill_renewal"),
          payment: { id: "pay_renewal" },
        });

        expect(cancels).toEqual(["subs_1"]);
        expect(refunds).toEqual([{ chargeId: "pay_renewal", reason: duplicateReason }]);
      });

      it.each(["subscription.completed", "subscription.renewed"])(
        "refunds %s of a deleted account",
        async (name) => {
          profileId = missingId;
          await deliver(name, {
            ...event("subs_orphan", "bill_orphan"),
            payment: { id: "pay_orphan" },
          });

          expect(cancels).toEqual(["subs_orphan"]);
          expect(refunds).toEqual([{ chargeId: "pay_orphan", reason: duplicateReason }]);
        },
      );

      it("refunds a redelivered stray bill once and survives a refund failure", async () => {
        await seed();
        refundFailure = true;

        await expect(
          deliver("subscription.completed", event("subs_stray", "bill_stray")),
        ).resolves.toBeUndefined();

        expect(logged).toHaveBeenCalledWith(
          "refund failed",
          expect.objectContaining({ subscriptionId: "subs_stray", checkoutId: "bill_stray" }),
        );

        refundFailure = false;
        await deliver("subscription.completed", event("subs_stray", "bill_stray"));
        await deliver("subscription.completed", event("subs_stray", "bill_stray"));

        expect(refunds).toHaveLength(1);
      });

      describe("plan_changed", () => {
        const changed = (productId: string, subscription = "subs_1") =>
          event(subscription, "bill_1", { productId, status: "PENDING" });

        beforeEach(async () => {
          await seed({ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" });
        });

        it.each([
          ["its external id", "prod_z", "prod_1"],
          ["its product id", "prod_1", "other"],
        ])("accepts the product matched by %s", async (_label, productId, externalId) => {
          products.set(productId, externalId);
          await deliver("subscription.plan_changed", changed(productId));

          expect(cancels).toEqual([]);
          expect(refunds).toEqual([]);
        });

        it("cancels, reverts and refunds a change to another product", async () => {
          products.set("prod_other", "elsewhere");
          await deliver("subscription.plan_changed", changed("prod_other"));

          expect(cancels).toEqual(["subs_1"]);
          expect(refunds).toEqual([{ chargeId: "bill_1", reason: planChangeReason }]);
          expect(await assignment()).toMatchObject({
            effectivePlanId: goldId,
            copaySubscriptionId: null,
          });
          expect(logCalls("copay plan change not supported")).toHaveLength(1);
        });

        it("only logs when the gateway is not configured", async () => {
          configured = false;
          products.set("prod_other", "elsewhere");
          await deliver("subscription.plan_changed", changed("prod_other"));

          expect(cancels).toEqual([]);
          expect(await assignment()).toMatchObject({ copaySubscriptionId: "subs_1" });
        });

        it("ignores a subscription the co-pay does not own", async () => {
          products.set("prod_other", "elsewhere");
          await deliver("subscription.plan_changed", changed("prod_other", "subs_stray"));

          expect(cancels).toEqual([]);
          expect(refunds).toEqual([]);
        });

        it("ignores the change when no co-pay product is registered for the pair", async () => {
          await db.delete(copayProducts);
          products.set("prod_other", "elsewhere");
          await deliver("subscription.plan_changed", changed("prod_other"));

          expect(cancels).toEqual([]);
        });

        it("ignores a change whose product cannot be resolved", async () => {
          await deliver("subscription.plan_changed", changed("prod_unknown"));

          expect(cancels).toEqual([]);
        });
      });
    });
  });
});
