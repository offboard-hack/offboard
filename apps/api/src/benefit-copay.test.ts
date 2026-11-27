import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  benefitCopays,
  benefitPolicies,
  billingWebhookEvents,
  defaultOrgId,
  organizations,
  plans,
  talentProfiles,
  talentSubscriptions,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createRepositories } from "./repositories.js";
import type { PortalAuth } from "./shared/portal-auth.js";
import { addMonths, saoPauloDate } from "./shared/sao-paulo-date.js";
import { sweepCopays } from "./features/benefit-copay/expiry.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const webhookSecret = "copay-webhook-secret-with-32-chars-ok";
const cronSecret = "copay-cron-secret";
const otherOrgId = "00000000-0000-4000-8000-0000000000b1";

const auth: PortalAuth = {
  handler: () => Promise.resolve(new Response("ok")),
  resolvePrincipal(headers) {
    const talentId = headers.get("x-test-talent-id");

    if (talentId) {
      return Promise.resolve({
        kind: "talent",
        profile: { id: talentId, name: "Pessoa", email: "pessoa@example.com" },
      });
    }

    return Promise.resolve({
      kind: "authenticated",
      principal: {
        id: "test-member",
        name: "Test Member",
        email: "member@example.com",
        role: "admin",
        orgId: headers.get("x-test-org") ?? defaultOrgId,
      },
    });
  },
};

function day(offset: number) {
  return saoPauloDate(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
}

type WebhookPayload = {
  id?: string;
  event?: string;
  apiVersion?: number;
  data: {
    subscription: { id: string; amount: number };
    checkout?: { id: string; externalId: string | null };
    payment?: { id: string };
  };
};

type Gateway = {
  configured: boolean;
  products: { from: string; to: string; priceCents: number }[];
  checkouts: { externalId: string; planSlug: string; returnUrl: string; completionUrl: string }[];
  cancels: string[];
  failCancel: boolean;
  failCheckout: boolean;
  failProduct: boolean;
};

describe.skipIf(!url)("benefit co-pay", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  const gateway: Gateway = {
    configured: true,
    products: [],
    checkouts: [],
    cancels: [],
    failCancel: false,
    failCheckout: false,
    failProduct: false,
  };

  const abacatepay = {
    get configured() {
      return gateway.configured;
    },
    async ensureCopayProduct(from: string, to: string, priceCents: number) {
      if (gateway.failProduct) throw new Error("product down");

      gateway.products.push({ from, to, priceCents });

      return { id: `prod_${from}_${to}` };
    },
    async createSubscriptionCheckout(params: Gateway["checkouts"][number]) {
      await new Promise((resolve) => setTimeout(resolve, 25));

      if (gateway.failCheckout) throw new Error("checkout down");

      gateway.checkouts.push(params);

      return {
        id: `bill_${gateway.checkouts.length}`,
        url: `https://pay.example/bill_${gateway.checkouts.length}`,
      };
    },
    async cancelSubscription(id: string) {
      if (gateway.failCancel) throw new Error("cancel down");

      gateway.cancels.push(id);
    },
  };

  const app = createApp(webOrigin, repos, {
    auth,
    sendEmail: () => Promise.resolve(),
    abacatepay,
    abacatepayWebhookSecret: webhookSecret,
    cronSecret,
    catalog: [],
  });

  function request(
    path: string,
    init: {
      method?: string;
      talent?: string;
      org?: string;
      origin?: string;
      headers?: Record<string, string>;
      body?: string;
    } = {},
  ) {
    const headers = new Headers({ origin: init.origin ?? webOrigin, ...init.headers });

    if (init.talent) headers.set("x-test-talent-id", init.talent);

    if (init.org) headers.set("x-test-org", init.org);

    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
      }),
    );
  }

  const checkout = (talent: string) =>
    request("/me/benefit/copay/checkout", { method: "POST", talent });

  const cancel = (talent: string) =>
    request("/me/benefit/copay/cancel", { method: "POST", talent });

  const plan = async (talent: string) => (await request("/me/plan", { talent })).json();

  function event(
    name: string | undefined,
    assignmentId: string | null,
    overrides: { subscription?: string; checkout?: string; id?: string } = {},
  ) {
    return {
      id: overrides.id,
      event: name,
      apiVersion: 2,
      data: {
        subscription: { id: overrides.subscription ?? "subs_copay_1", amount: 2900 },
        checkout: assignmentId
          ? { id: overrides.checkout ?? "bill_1", externalId: `copay:${assignmentId}:attempt` }
          : undefined,
        payment: { id: `pay_${randomUUID()}` },
      },
    } satisfies WebhookPayload;
  }

  function deliver(payload: WebhookPayload, deliveryId: string | null = randomUUID()) {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {};

    if (deliveryId) {
      const digest = createHmac("sha256", webhookSecret)
        .update(`${deliveryId}.${timestamp}.${body}`)
        .digest("base64");

      headers["webhook-id"] = deliveryId;
      headers["webhook-timestamp"] = String(timestamp);
      headers["webhook-signature"] = `v1,${digest}`;
    }

    return app.handle(
      new Request(
        `http://localhost/api/billing/webhook${deliveryId ? "" : `?webhookSecret=${webhookSecret}`}`,
        { method: "POST", headers, body },
      ),
    );
  }

  async function planId(slug: string) {
    const [row] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug));

    return row.id;
  }

  async function person(
    slug = "silver",
    options: { orgId?: string; validUntil?: string; email?: string } = {},
  ) {
    const orgId = options.orgId ?? defaultOrgId;
    const assigned = await planId(slug);

    const [profile] = await db
      .insert(talentProfiles)
      .values({
        orgId,
        personalEmail: options.email ?? `pessoa-${randomUUID()}@exemplo.com`,
        name: "Marina",
        sponsoredUntil: "2099-12-31",
        termsAcceptedAt: new Date(),
      })
      .returning({ id: talentProfiles.id });

    const [assignment] = await db
      .insert(benefitAssignments)
      .values({
        orgId,
        profileId: profile.id,
        assignedPlanId: assigned,
        effectivePlanId: assigned,
        source: "default",
        validUntil: options.validUntil ?? day(120),
      })
      .returning({ id: benefitAssignments.id });

    return { profileId: profile.id, assignmentId: assignment.id };
  }

  async function copay(assignmentId: string) {
    const [row] = await db
      .select()
      .from(benefitCopays)
      .where(eq(benefitCopays.assignmentId, assignmentId));

    return row;
  }

  async function effective(assignmentId: string) {
    const [row] = await db
      .select({ slug: plans.slug })
      .from(benefitAssignments)
      .innerJoin(plans, eq(plans.id, benefitAssignments.effectivePlanId))
      .where(eq(benefitAssignments.id, assignmentId));

    return row.slug;
  }

  async function activate(profileId: string, assignmentId: string) {
    expect((await checkout(profileId)).status).toBe(200);
    expect((await deliver(event("subscription.completed", assignmentId))).status).toBe(200);
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });
  });

  async function reset() {
    await db.delete(benefitCopays);
    await db.delete(benefitAssignments);
    await db.delete(benefitPolicies);
    await seedDatabase(db, testSeedFixtures);
    await db
      .insert(organizations)
      .values({ id: otherOrgId, name: "Org B", slug: "org-b-copay" })
      .onConflictDoNothing();
  }

  beforeEach(async () => {
    await reset();
    gateway.configured = true;
    gateway.products.length = 0;
    gateway.checkouts.length = 0;
    gateway.cancels.length = 0;
    gateway.failCancel = false;
    gateway.failCheckout = false;
    gateway.failProduct = false;
  });

  afterAll(async () => {
    await db.delete(benefitCopays);
    await db.delete(benefitAssignments);
    await db.$client.end();
  });

  describe("upgrade and activation", () => {
    it("charges the difference and makes the next tier effective once the signed completed webhook arrives", async () => {
      const { profileId, assignmentId } = await person("silver");

      const before = await plan(profileId);

      expect(before.copay).toEqual({
        offer: { planName: "Gold", priceCents: 2900 },
        subscription: null,
      });
      expect(before.upgrade.offered).toBe(false);

      const response = await checkout(profileId);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        url: "https://pay.example/bill_1",
        checkoutId: "bill_1",
      });
      expect(gateway.products).toEqual([{ from: "silver", to: "gold", priceCents: 2900 }]);
      expect(gateway.checkouts).toEqual([
        {
          externalId: expect.stringMatching(new RegExp(`^copay:${assignmentId}:[0-9a-f]{8}$`)),
          planSlug: "prod_silver_gold",
          returnUrl: `${webOrigin}/colaborador?tela=carreira`,
          completionUrl: `${webOrigin}/colaborador?tela=carreira&plano=ok`,
        },
      ]);
      expect(await effective(assignmentId)).toBe("silver");
      expect((await copay(assignmentId)).status).toBe("pending");

      expect((await deliver(event("subscription.completed", assignmentId))).status).toBe(200);

      const row = await copay(assignmentId);

      expect(row).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_copay_1",
        checkoutId: "bill_1",
      });
      expect(row.currentPeriodEnd).toBe(addMonths(saoPauloDate(new Date()), 1));
      expect(await effective(assignmentId)).toBe("gold");

      const after = await plan(profileId);

      expect(after.benefit.planName).toBe("Gold");
      expect(after.copay).toEqual({
        offer: null,
        subscription: {
          status: "active",
          planName: "Gold",
          priceCents: 2900,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelable: true,
        },
      });
      expect(after.upgrade.offered).toBe(false);

      const listed = await (await request("/benefit-assignments")).json();

      expect(listed).toMatchObject([
        { assignedPlanName: "Silver", effectivePlanName: "Gold", copay: true },
      ]);
    });

    it("charges the gap between adjacent tiers other than silver", async () => {
      const { profileId } = await person("gold");

      expect((await plan(profileId)).copay.offer).toEqual({
        planName: "Platinum",
        priceCents: 3000,
      });

      await checkout(profileId);

      expect(gateway.products).toEqual([{ from: "gold", to: "platinum", priceCents: 3000 }]);
    });

    it("returns the same checkout url on a repeat request and calls the gateway once", async () => {
      const { profileId } = await person();

      const first = await (await checkout(profileId)).json();
      const second = await (await checkout(profileId)).json();

      expect(second).toEqual(first);
      expect(gateway.checkouts).toHaveLength(1);
      expect(gateway.products).toHaveLength(1);
    });

    it("produces a single gateway call for concurrent checkouts", async () => {
      const { profileId } = await person();

      const responses = await Promise.all([
        checkout(profileId),
        checkout(profileId),
        checkout(profileId),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(
        new Set(await Promise.all(responses.map(async (response) => (await response.json()).url))),
      ).toEqual(new Set(["https://pay.example/bill_1"]));
      expect(gateway.checkouts).toHaveLength(1);
    });

    it("issues a new checkout once the previous one is stale and ignores the old one", async () => {
      const { profileId, assignmentId } = await person();

      await checkout(profileId);
      await db
        .update(benefitCopays)
        .set({ updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
        .where(eq(benefitCopays.assignmentId, assignmentId));

      expect(await (await checkout(profileId)).json()).toEqual({
        url: "https://pay.example/bill_2",
        checkoutId: "bill_2",
      });

      await deliver(event("subscription.completed", assignmentId, { checkout: "bill_1" }));

      expect((await copay(assignmentId)).status).toBe("pending");
      expect(await effective(assignmentId)).toBe("silver");

      await deliver(event("subscription.completed", assignmentId, { checkout: "bill_2" }));

      expect((await copay(assignmentId)).status).toBe("active");
      expect(await effective(assignmentId)).toBe("gold");
    });

    it("ignores an activation that does not match the issued checkout", async () => {
      const { profileId, assignmentId } = await person();

      await checkout(profileId);
      await deliver(event("subscription.completed", assignmentId, { checkout: "bill_other" }));
      await deliver({
        event: "subscription.completed",
        data: {
          subscription: { id: "subs_x", amount: 1 },
          checkout: { id: "bill_1", externalId: `copay:${assignmentId}:attempt` },
        },
      });

      const row = await copay(assignmentId);

      expect(row.status).toBe("active");
      expect(row.providerSubscriptionId).toBe("subs_x");
    });

    it("binds on a trial start and on the first renewal", async () => {
      const first = await person();

      await checkout(first.profileId);
      await deliver(event("subscription.trial_started", first.assignmentId));

      expect((await copay(first.assignmentId)).status).toBe("active");

      const second = await person();

      await checkout(second.profileId);
      await deliver(event("subscription.renewed", second.assignmentId, { checkout: "bill_2" }));

      expect(await effective(second.assignmentId)).toBe("gold");
    });

    it("applies a redelivered event only once", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      const renewed = event("subscription.renewed", null, { id: "evt_renew_1" });
      const end = (await copay(assignmentId)).currentPeriodEnd ?? "";

      await deliver(renewed, "delivery-1");
      await deliver(renewed, "delivery-1");

      expect((await copay(assignmentId)).currentPeriodEnd).toBe(addMonths(end, 1));
    });

    it("extends from today when the period already ended and handles deliveries without an id", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await db
        .update(benefitCopays)
        .set({ currentPeriodEnd: day(-5) })
        .where(eq(benefitCopays.assignmentId, assignmentId));

      await deliver(event("subscription.renewed", null), null);

      expect((await copay(assignmentId)).currentPeriodEnd).toBe(addMonths(day(0), 1));
    });

    it("does not store an event id twice across copays", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      expect(await db.select().from(billingWebhookEvents)).toHaveLength(1);
    });
  });

  describe("eligibility", () => {
    it("refuses the top tier, a missing benefit and an expired one", async () => {
      const top = await person("platinum-premium");

      expect((await plan(top.profileId)).copay.offer).toBeNull();

      const refused = await checkout(top.profileId);

      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({ error: "Already on the top tier" });

      const bare = await db
        .insert(talentProfiles)
        .values({
          orgId: defaultOrgId,
          personalEmail: "sem-beneficio@exemplo.com",
          name: "Sem",
          sponsoredUntil: "2099-12-31",
        })
        .returning({ id: talentProfiles.id });

      expect((await checkout(bare[0].id)).status).toBe(409);
      expect((await plan(bare[0].id)).upgrade.offered).toBe(true);
      expect((await plan(bare[0].id)).copay.offer).toBeNull();

      const expired = await person("silver", { validUntil: day(-1) });

      expect(await (await checkout(expired.profileId)).json()).toEqual({
        error: "No active benefit",
      });
      expect(gateway.checkouts).toHaveLength(0);
    });

    it("keeps Carreira Pro as the single upgrade for the top tier and offers it only without a benefit tier above", async () => {
      const top = await person("platinum-premium");

      expect((await plan(top.profileId)).upgrade.offered).toBe(true);

      const below = await person("silver");

      expect((await plan(below.profileId)).upgrade.offered).toBe(false);
    });

    it("does not offer the co-pay to someone with Carreira Pro", async () => {
      const { profileId } = await person();

      await db.insert(talentSubscriptions).values({
        profileId,
        status: "active",
        providerSubscriptionId: "subs_pro",
        currentPeriodEnd: day(10),
      });

      const current = await plan(profileId);

      expect(current.copay.offer).toBeNull();
      expect(current.upgrade.offered).toBe(false);

      const refused = await checkout(profileId);

      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({ error: "Carreira Pro is active" });
    });

    it("refuses a second upgrade while one is active or canceled inside its period", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      const refused = await checkout(profileId);

      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({ error: "An upgrade is already active" });

      await cancel(profileId);

      expect((await checkout(profileId)).status).toBe(409);
    });

    it("offers nothing when payments are not configured", async () => {
      const { profileId } = await person();

      gateway.configured = false;

      expect((await plan(profileId)).copay.offer).toBeNull();
      expect((await checkout(profileId)).status).toBe(503);
      expect((await cancel(profileId)).status).toBe(503);
    });

    it("requires a signed-in collaborator from the web origin", async () => {
      const { profileId } = await person();

      expect(
        (
          await request("/me/benefit/copay/checkout", {
            method: "POST",
            talent: profileId,
            origin: "https://evil.example",
          })
        ).status,
      ).toBe(403);
      expect((await request("/me/benefit/copay/checkout", { method: "POST" })).status).toBe(403);
      expect(gateway.checkouts).toHaveLength(0);
    });

    it("answers 502 and stores nothing when the gateway fails", async () => {
      const { profileId, assignmentId } = await person();

      gateway.failCheckout = true;

      expect((await checkout(profileId)).status).toBe(502);
      expect(await copay(assignmentId)).toBeUndefined();

      gateway.failCheckout = false;
      gateway.failProduct = true;

      expect((await checkout(profileId)).status).toBe(502);

      gateway.failProduct = false;

      expect((await checkout(profileId)).status).toBe(200);
    });
  });

  describe("cancel", () => {
    it("keeps access until the period end and then reverts", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      const response = await cancel(profileId);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ currentPeriodEnd: addMonths(day(0), 1) });
      expect(gateway.cancels).toEqual(["subs_copay_1"]);
      expect((await copay(assignmentId)).status).toBe("canceled");
      expect(await effective(assignmentId)).toBe("gold");

      const during = await plan(profileId);

      expect(during.copay.subscription).toMatchObject({ status: "canceled", cancelable: false });
      expect(during.copay.offer).toBeNull();

      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect(await effective(assignmentId)).toBe("gold");

      await db
        .update(benefitCopays)
        .set({ currentPeriodEnd: day(-1) })
        .where(eq(benefitCopays.assignmentId, assignmentId));
      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect(await effective(assignmentId)).toBe("silver");

      const after = await plan(profileId);

      expect(after.benefit.planName).toBe("Silver");
      expect(after.copay).toEqual({
        offer: { planName: "Gold", priceCents: 2900 },
        subscription: null,
      });
    });

    it("lets the person upgrade again after a canceled upgrade ended", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await cancel(profileId);
      await db
        .update(benefitCopays)
        .set({ currentPeriodEnd: day(-1) })
        .where(eq(benefitCopays.assignmentId, assignmentId));

      expect(await (await checkout(profileId)).json()).toEqual({
        url: "https://pay.example/bill_2",
        checkoutId: "bill_2",
      });
      expect(gateway.cancels).toEqual(["subs_copay_1"]);
      expect(gateway.checkouts).toHaveLength(2);
      expect(gateway.checkouts[1].externalId).not.toBe(gateway.checkouts[0].externalId);
      expect(gateway.checkouts[1].externalId.startsWith(`copay:${assignmentId}:`)).toBe(true);

      await deliver(
        event("subscription.completed", assignmentId, {
          subscription: "subs_copay_2",
          checkout: "bill_2",
        }),
      );

      expect(await effective(assignmentId)).toBe("gold");
      expect((await copay(assignmentId)).providerSubscriptionId).toBe("subs_copay_2");
    });

    it("answers 409 when there is nothing to cancel and 502 when the gateway fails", async () => {
      const { profileId, assignmentId } = await person();

      expect((await cancel(profileId)).status).toBe(409);

      await activate(profileId, assignmentId);

      gateway.failCancel = true;

      expect((await cancel(profileId)).status).toBe(502);
      expect((await copay(assignmentId)).status).toBe("active");

      gateway.failCancel = false;

      expect((await cancel(profileId)).status).toBe(200);
      expect((await cancel(profileId)).status).toBe(409);
    });

    it("keeps a canceled upgrade canceled when late events arrive", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await cancel(profileId);
      await deliver(event("subscription.payment_failed", null));

      expect((await copay(assignmentId)).status).toBe("canceled");

      const end = (await copay(assignmentId)).currentPeriodEnd ?? "";

      await deliver(event("subscription.renewed", null));

      expect((await copay(assignmentId)).currentPeriodEnd).toBe(addMonths(end, 1));
      expect((await copay(assignmentId)).status).toBe("canceled");
    });
  });

  describe("payment failure and gateway events", () => {
    it("keeps access until the period end after a failed payment, then reverts", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await deliver(event("subscription.payment_failed", null));

      expect((await copay(assignmentId)).status).toBe("past_due");
      expect(await effective(assignmentId)).toBe("gold");
      expect((await plan(profileId)).copay.subscription).toMatchObject({
        status: "past_due",
        cancelable: true,
      });

      await db
        .update(benefitCopays)
        .set({ currentPeriodEnd: day(-1) })
        .where(eq(benefitCopays.assignmentId, assignmentId));
      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect(await effective(assignmentId)).toBe("silver");
      expect((await plan(profileId)).copay.subscription).toBeNull();
    });

    it("cancels the old subscription before charging again after a past due period ended", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await deliver(event("subscription.payment_failed", null));
      await db
        .update(benefitCopays)
        .set({ currentPeriodEnd: day(-1) })
        .where(eq(benefitCopays.assignmentId, assignmentId));

      expect((await checkout(profileId)).status).toBe(200);
      expect(gateway.cancels).toEqual(["subs_copay_1"]);
      expect((await copay(assignmentId)).providerSubscriptionId).toBeNull();
    });

    it("recovers to active when a past due upgrade renews", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await deliver(event("subscription.payment_failed", null));
      await deliver(event("subscription.renewed", null));

      expect((await copay(assignmentId)).status).toBe("active");
    });

    it("ignores a failure before activation and a gateway cancellation keeps the period", async () => {
      const { profileId, assignmentId } = await person();

      await checkout(profileId);
      await deliver(event("subscription.payment_failed", assignmentId));
      await deliver(event("subscription.cancelled", assignmentId));
      await deliver(event("subscription.renewed", null));

      expect((await copay(assignmentId)).status).toBe("pending");

      await deliver(event("subscription.completed", assignmentId));
      await deliver(event("subscription.cancelled", null));

      const row = await copay(assignmentId);

      expect(row.status).toBe("canceled");
      expect(await effective(assignmentId)).toBe("gold");
      expect(row.currentPeriodEnd).not.toBeNull();
    });

    it("ignores events of a replaced subscription and unknown events", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      for (const name of [
        "subscription.renewed",
        "subscription.payment_failed",
        "subscription.cancelled",
      ]) {
        await deliver(event(name, assignmentId, { subscription: "subs_old" }));
      }

      await deliver(event("subscription.something_else", assignmentId));
      await deliver(event(undefined, assignmentId));

      expect(await copay(assignmentId)).toMatchObject({
        status: "active",
        providerSubscriptionId: "subs_copay_1",
      });
    });

    it("ignores an activation redelivered after the upgrade is already active", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      const end = (await copay(assignmentId)).currentPeriodEnd;

      await deliver(event("subscription.completed", assignmentId));

      expect((await copay(assignmentId)).currentPeriodEnd).toBe(end);
    });

    it("routes events without a checkout by their subscription id and never crosses into Carreira Pro", async () => {
      const { profileId, assignmentId } = await person();
      const other = await person();

      await db.insert(talentSubscriptions).values({
        profileId: other.profileId,
        status: "active",
        providerSubscriptionId: "subs_pro_other",
        currentPeriodEnd: day(10),
      });

      await activate(profileId, assignmentId);
      await deliver(event("subscription.payment_failed", null, { subscription: "subs_pro_other" }));

      const [pro] = await db
        .select()
        .from(talentSubscriptions)
        .where(eq(talentSubscriptions.profileId, other.profileId));

      expect(pro.status).toBe("past_due");
      expect((await copay(assignmentId)).status).toBe("active");

      await deliver(event("subscription.payment_failed", null));

      expect((await copay(assignmentId)).status).toBe("past_due");
      expect(
        (
          await db
            .select()
            .from(talentSubscriptions)
            .where(eq(talentSubscriptions.profileId, other.profileId))
        )[0].status,
      ).toBe("past_due");
    });
  });

  describe("orphans and unknown ids", () => {
    it("cancels a charge that arrives for a deleted assignment", async () => {
      const missing = randomUUID();

      await deliver(event("subscription.completed", missing, { subscription: "subs_orphan" }));
      await deliver(event("subscription.renewed", missing, { subscription: "subs_orphan_2" }));
      await deliver(event("subscription.payment_failed", missing, { subscription: "subs_x" }));

      expect(gateway.cancels).toEqual(["subs_orphan", "subs_orphan_2"]);
    });

    it("cannot cancel an orphan when payments are not configured", async () => {
      gateway.configured = false;

      await deliver(event("subscription.completed", randomUUID(), { subscription: "subs_orphan" }));

      expect(gateway.cancels).toEqual([]);
    });

    it("ignores an id that is not an assignment id", async () => {
      await deliver({
        ...event("subscription.completed", null),
        data: {
          subscription: { id: "subs_garbage", amount: 1 },
          checkout: { id: "bill_1", externalId: "copay:not-a-uuid" },
        },
      });

      expect(gateway.cancels).toEqual([]);
    });

    it("cancels a subscription paid after the upgrade was ended elsewhere", async () => {
      const { profileId, assignmentId } = await person();

      await checkout(profileId);

      const hr = await request("/benefit-assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId, planId: await planId("gold") }),
      });

      expect(hr.status).toBe(201);
      expect((await copay(assignmentId)).status).toBe("canceled");

      await deliver(event("subscription.completed", assignmentId, { subscription: "subs_late" }));

      expect(gateway.cancels).toEqual(["subs_late"]);
      expect((await copay(assignmentId)).status).toBe("canceled");
      expect(await effective(assignmentId)).toBe("gold");
    });
  });

  describe("data export", () => {
    it("exports the upgrade without provider ids", async () => {
      const { profileId, assignmentId } = await person();

      expect(
        (await (await request("/me/export", { talent: profileId })).json()).benefitUpgrade,
      ).toBeNull();

      await activate(profileId, assignmentId);

      const response = await request("/me/export", { talent: profileId });
      const exported = await response.json();

      expect(exported.benefitUpgrade).toEqual({
        status: "active",
        targetPlan: "Gold",
        currentPeriodEnd: addMonths(day(0), 1),
      });
      expect(JSON.stringify(exported)).not.toContain("subs_copay_1");
      expect(JSON.stringify(exported)).not.toContain("bill_1");
    });
  });

  describe("expiry", () => {
    it("cancels the upgrade and reverts when the benefit expires", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await db
        .update(benefitAssignments)
        .set({ validUntil: day(-1) })
        .where(eq(benefitAssignments.id, assignmentId));

      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect(gateway.cancels).toEqual(["subs_copay_1"]);
      expect(await copay(assignmentId)).toMatchObject({
        status: "canceled",
        currentPeriodEnd: null,
      });
      expect(await effective(assignmentId)).toBe("silver");

      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect(gateway.cancels).toEqual(["subs_copay_1"]);
    });

    it("ends a pending upgrade without calling the gateway", async () => {
      const { profileId, assignmentId } = await person();

      await checkout(profileId);
      await db
        .update(benefitAssignments)
        .set({ validUntil: day(-1) })
        .where(eq(benefitAssignments.id, assignmentId));
      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect(gateway.cancels).toEqual([]);
      expect((await copay(assignmentId)).status).toBe("canceled");
    });

    it("retries on the next sweep when the gateway fails", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await db
        .update(benefitAssignments)
        .set({ validUntil: day(-1) })
        .where(eq(benefitAssignments.id, assignmentId));

      gateway.failCancel = true;
      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect((await copay(assignmentId)).status).toBe("active");

      gateway.failCancel = false;
      await sweepCopays(repos.benefitCopay, abacatepay, new Date());

      expect((await copay(assignmentId)).status).toBe("canceled");
    });

    it("runs with the scheduled drain", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);
      await db
        .update(benefitAssignments)
        .set({ validUntil: day(-1) })
        .where(eq(benefitAssignments.id, assignmentId));

      const drained = await app.handle(
        new Request("http://localhost/api/background/drain", {
          method: "POST",
          headers: { authorization: `Bearer ${cronSecret}` },
        }),
      );

      expect(drained.status).toBe(200);
      expect(gateway.cancels).toEqual(["subs_copay_1"]);
    });
  });

  describe("HR assignments", () => {
    function assign(init: { profileId: string; planId: string; assignmentId?: string }) {
      return request(
        init.assignmentId ? `/benefit-assignments/${init.assignmentId}` : "/benefit-assignments",
        {
          method: init.assignmentId ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            init.assignmentId
              ? { planId: init.planId }
              : { profileId: init.profileId, planId: init.planId },
          ),
        },
      );
    }

    it("cancels the upgrade at once when HR assigns the same tier or higher", async () => {
      const first = await person();

      await activate(first.profileId, first.assignmentId);

      expect(
        (await assign({ profileId: first.profileId, planId: await planId("gold") })).status,
      ).toBe(201);
      expect(gateway.cancels).toEqual(["subs_copay_1"]);
      expect(await copay(first.assignmentId)).toMatchObject({
        status: "canceled",
        currentPeriodEnd: null,
      });
      expect(await effective(first.assignmentId)).toBe("gold");
      expect((await plan(first.profileId)).copay.subscription).toBeNull();

      await deliver(event("subscription.renewed", null));

      expect(await copay(first.assignmentId)).toMatchObject({
        status: "canceled",
        currentPeriodEnd: null,
      });

      const second = await person();

      await activate(second.profileId, second.assignmentId);

      expect(
        (
          await assign({
            profileId: second.profileId,
            assignmentId: second.assignmentId,
            planId: await planId("platinum"),
          })
        ).status,
      ).toBe(200);
      expect(await effective(second.assignmentId)).toBe("platinum");
      expect((await copay(second.assignmentId)).status).toBe("canceled");
    });

    it("keeps the upgrade when HR assigns a lower tier", async () => {
      const { profileId, assignmentId } = await person("gold");

      await db.update(benefitAssignments).set({ validUntil: day(120) });
      await activate(profileId, assignmentId);

      expect(await effective(assignmentId)).toBe("platinum");

      const lower = await assign({ profileId, assignmentId, planId: await planId("silver") });

      expect(lower.status).toBe(200);
      expect(gateway.cancels).toEqual([]);
      expect((await copay(assignmentId)).status).toBe("active");
      expect(await effective(assignmentId)).toBe("platinum");
    });

    it("keeps the assignment unchanged and answers 502 when the gateway cannot cancel", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      gateway.failCancel = true;

      expect((await assign({ profileId, planId: await planId("gold") })).status).toBe(502);
      expect(
        (await assign({ profileId, assignmentId, planId: await planId("platinum") })).status,
      ).toBe(502);
      expect((await copay(assignmentId)).status).toBe("active");
      expect(await effective(assignmentId)).toBe("gold");
    });

    it("never touches an upgrade of another organization", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      expect(
        await repos.benefits.copaySubscriptionsAtOrBelow(
          profileId,
          otherOrgId,
          await planId("platinum"),
        ),
      ).toEqual([]);
      expect(
        await repos.benefits.copaySubscriptionsAtOrBelow(
          profileId,
          defaultOrgId,
          await planId("platinum"),
        ),
      ).toEqual(["subs_copay_1"]);
    });
  });

  describe("account deletion", () => {
    function deleteAccount(profileId: string) {
      return request("/me", { method: "DELETE", talent: profileId });
    }

    it("cancels the upgrade first", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      expect((await deleteAccount(profileId)).status).toBe(204);
      expect(gateway.cancels).toEqual(["subs_copay_1"]);
      expect(await copay(assignmentId)).toBeUndefined();
    });

    it("blocks the deletion with 502 when the gateway fails and 503 when it is not configured", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      gateway.failCancel = true;

      expect((await deleteAccount(profileId)).status).toBe(502);
      expect((await copay(assignmentId)).status).toBe("active");

      gateway.failCancel = false;
      gateway.configured = false;

      expect((await deleteAccount(profileId)).status).toBe(503);
      expect(
        await db.select().from(talentProfiles).where(eq(talentProfiles.id, profileId)),
      ).toHaveLength(1);
    });

    it("keeps the paid period when deletion stops after the upgrade was canceled", async () => {
      const { profileId, assignmentId } = await person();

      await activate(profileId, assignmentId);

      await repos.account.markCopayCanceled(assignmentId, "subs_copay_1");

      expect((await copay(assignmentId)).status).toBe("canceled");
      expect(await effective(assignmentId)).toBe("gold");
    });

    it("deletes a person without an upgrade", async () => {
      const { profileId } = await person();

      expect((await deleteAccount(profileId)).status).toBe(204);
      expect(gateway.cancels).toEqual([]);
    });
  });

  describe("isolation", () => {
    it("keeps organizations and people apart", async () => {
      const a = await person();
      const b = await person("silver", { orgId: otherOrgId });
      const c = await person();

      await activate(a.profileId, a.assignmentId);

      expect((await cancel(b.profileId)).status).toBe(409);
      expect((await cancel(c.profileId)).status).toBe(409);
      expect((await plan(b.profileId)).copay.subscription).toBeNull();
      expect((await plan(c.profileId)).copay.subscription).toBeNull();

      expect((await checkout(b.profileId)).status).toBe(200);
      expect((await copay(b.assignmentId)).orgId).toBe(otherOrgId);
      expect((await copay(a.assignmentId)).status).toBe("active");

      expect(await repos.benefitCopay.cancelable(a.profileId, otherOrgId)).toBeNull();
      expect(await repos.benefitCopay.cancelable(a.profileId, defaultOrgId)).toMatchObject({
        assignmentId: a.assignmentId,
      });

      await deliver(event("subscription.payment_failed", a.assignmentId));

      expect((await copay(a.assignmentId)).status).toBe("past_due");
      expect((await copay(b.assignmentId)).status).toBe("pending");
      expect(
        await db
          .select()
          .from(benefitCopays)
          .where(and(eq(benefitCopays.orgId, otherOrgId))),
      ).toHaveLength(1);
    });

    it("starts no checkout for an assignment that belongs to another organization", async () => {
      const a = await person();

      expect(
        await repos.benefitCopay.startCheckout(a.profileId, otherOrgId, new Date(), {
          ensureProduct: abacatepay.ensureCopayProduct,
          createCheckout: abacatepay.createSubscriptionCheckout,
          cancelSubscription: abacatepay.cancelSubscription,
        }),
      ).toEqual({ outcome: "no_benefit" });
    });
  });
});
