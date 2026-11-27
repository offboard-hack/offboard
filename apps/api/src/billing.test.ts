import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
        orgId: headers.get("x-test-org") ?? defaultOrgId,
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
    async cancelSubscription() {
      throw new Error("not implemented in stub");
    },
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
          externalId: created.id,
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
      expect(issued[0].externalId).toBe(other.id);

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
  describe("co-pay webhook", () => {
    const cancelled: string[] = [];

    const copayApp = createApp(webOrigin, repos, {
      auth,
      sendEmail: () => Promise.resolve(),
      abacatepay: {
        configured: true,
        createSubscriptionCheckout: () => Promise.resolve({ id: "bill_x", url: "https://x" }),
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
      await db.insert(benefitAssignments).values({
        orgId: defaultOrgId,
        profileId,
        assignedPlanId: goldId,
        effectivePlanId: goldId,
        source: "manual",
        validUntil: "2099-12-31",
        ...patch,
      });
    }

    async function assignment() {
      const [row] = await db.select().from(benefitAssignments);

      return row;
    }

    function copayWebhook(event: string, externalId: string | null, subscription = "subs_1") {
      return copayApp.handle(
        new Request(`http://localhost/api/billing/webhook?webhookSecret=${webhookSecret}`, {
          method: "POST",
          body: JSON.stringify({
            id: randomUUID(),
            event,
            apiVersion: 2,
            data: {
              subscription: { id: subscription, amount: 1000 },
              ...(externalId !== null && { checkout: { id: "bill_1", externalId } }),
            },
          }),
        }),
      );
    }

    it("subscription.completed upgrades effectivePlanId", async () => {
      await assign();

      const res = await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}`);

      expect(res.status).toBe(200);
      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: "subs_1",
      });
    });

    it("subscription.completed is noop when HR already upgraded", async () => {
      await assign({ effectivePlanId: platinumId });
      await copayWebhook("subscription.completed", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({
        effectivePlanId: platinumId,
        copaySubscriptionId: null,
      });
    });

    it("ignores events for unknown profiles and malformed ids", async () => {
      const logged = vi.spyOn(console, "error");

      try {
        await assign();
        await copayWebhook("subscription.completed", `copay:${missingId}:${platinumId}`);
        await copayWebhook("subscription.completed", "copay:");

        expect(logged).toHaveBeenCalledTimes(2);
        expect(await assignment()).toMatchObject({ effectivePlanId: goldId });
      } finally {
        logged.mockRestore();
      }
    });

    it("subscription.cancelled reverts effectivePlanId", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" });
      await copayWebhook("subscription.cancelled", `copay:${profileId}:${platinumId}`);

      expect(await assignment()).toMatchObject({
        effectivePlanId: goldId,
        copaySubscriptionId: null,
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
      expect(await assignment()).toMatchObject({ copaySubscriptionId: null });
    });

    it("renewal within validity is noop", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" });
      await copayWebhook("subscription.renewed", `copay:${profileId}:${platinumId}`);

      expect(cancelled).toEqual([]);
      expect(await assignment()).toMatchObject({ copaySubscriptionId: "subs_1" });
    });

    it("payment failure keeps the current tier", async () => {
      await assign({ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" });

      const logged = vi.spyOn(console, "error");

      try {
        await copayWebhook("subscription.payment_failed", `copay:${profileId}:${platinumId}`);

        expect(logged).toHaveBeenCalledWith("copay payment failed", { profileId });
        expect(await assignment()).toMatchObject({
          effectivePlanId: platinumId,
          copaySubscriptionId: "subs_1",
        });
      } finally {
        logged.mockRestore();
      }
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
});
