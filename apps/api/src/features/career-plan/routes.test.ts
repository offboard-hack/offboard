import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  copayProducts,
  defaultOrgId,
  employeeAccess,
  offboardingCases,
  plans,
  subscriptions,
  talentSubscriptions,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { emptyEmployeePlan } from "@offboard/employee";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Elysia } from "elysia";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "../../repositories.js";
import type { PortalAuth } from "../../shared/portal-auth.js";
import { addMonths, saoPauloDate } from "../../shared/sao-paulo-date.js";
import { talentAccess } from "../../shared/talent-access.js";
import { careerPlanRoutes } from "./routes.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const missingPlan = "00000000-0000-4000-8000-000000000000";

const auth: PortalAuth = {
  handler: async () => new Response(null),
  resolvePrincipal: (headers) =>
    Promise.resolve({
      kind: "talent",
      profile: { id: headers.get("x-test-talent-id") ?? "", name: "Test", email: "t@example.com" },
    }),
};

type CheckoutParams = {
  externalId: string;
  planSlug: string;
  returnUrl: string;
  completionUrl: string;
};

describe.skipIf(!url)("career plan route", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const checkouts: CheckoutParams[] = [];
  const cancellations: string[] = [];

  const gateway = {
    configured: true,
    async createSubscriptionCheckout(params: CheckoutParams) {
      checkouts.push(params);

      return { id: "bill_pro", url: "https://pay.example/bill_pro" };
    },
    async cancelSubscription(id: string) {
      cancellations.push(id);
    },
  };

  function planApp(checkout = gateway, companyActive = true) {
    return new Elysia().use(
      careerPlanRoutes(
        repos.careerPlan,
        talentAccess({
          auth,
          webOrigin,
          talent: repos.talent,
          companyActive: async () => companyActive,
          individualPlan: repos.careerPlan.individual,
        }),
        checkout,
        webOrigin,
        repos.benefits,
      ),
    );
  }

  const app = planApp();

  const get = (profileId: string, target = app) =>
    target.handle(
      new Request("http://localhost/me/plan", { headers: { "x-test-talent-id": profileId } }),
    );

  const checkout = (profileId: string, target = app) =>
    target.handle(
      new Request("http://localhost/me/plan/checkout", {
        method: "POST",
        headers: { "x-test-talent-id": profileId, origin: webOrigin },
      }),
    );

  async function subscription(profileId: string) {
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

  async function subscribed(
    profileId: string,
    status: "active" | "canceled" | "past_due" | "pending",
    end: string | null,
    updatedAt = new Date(),
  ) {
    await db.insert(talentSubscriptions).values({
      profileId,
      status,
      providerSubscriptionId: "subs_pro",
      currentPeriodEnd: end,
      createdAt: updatedAt,
      updatedAt,
    });
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
    checkouts.length = 0;
    cancellations.length = 0;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function onPlan(slug: string) {
    const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug));

    await db
      .update(subscriptions)
      .set({ planId: plan.id, status: "active" })
      .where(eq(subscriptions.orgId, defaultOrgId));
  }

  async function profile(sponsoredUntil: string, terms = true) {
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    const created = await repos.talent.enable({
      orgId: defaultOrgId,
      caseId: first.id,
      personalEmail: "pessoa@exemplo.com",
      sponsoredUntil,
    });

    if (
      created === "case_not_found" ||
      created === "already_enabled" ||
      created === "email_taken"
    ) {
      throw new Error(created);
    }

    if (terms) await repos.talent.acceptTerms(created.id);

    return created.id;
  }

  it("shows the company plan sponsoring AI Apply until its date", async () => {
    await onPlan("platinum-premium");

    const profileId = await profile("2099-12-31");
    const response = await get(profileId);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: "2099-12-31" },
      individual: null,
      benefit: null,
      aiApply: { allowedBy: "company", dailyLimit: 10 },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
      copay: null,
    });
  });

  it("offers the upgrade once the sponsorship date has passed", async () => {
    await onPlan("platinum-premium");

    const profileId = await profile("2099-12-31");
    const yesterday = saoPauloDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const [first] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

    await db.insert(employeeAccess).values({
      caseId: first.id,
      orgId: defaultOrgId,
      email: "bia@example.com",
      plan: emptyEmployeePlan,
      careerSponsoredUntil: yesterday,
    });

    expect(await (await get(profileId)).json()).toEqual({
      company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: yesterday },
      individual: null,
      benefit: null,
      aiApply: { allowedBy: null, dailyLimit: 10 },
      upgrade: { offered: true, priceCents: 7900, dailyLimit: 10 },
      copay: null,
    });
  });

  it("shows a company without a plan and the person's Carreira Pro", async () => {
    await db.delete(subscriptions).where(eq(subscriptions.orgId, defaultOrgId));

    const profileId = await profile("2099-12-31");

    await db
      .insert(talentSubscriptions)
      .values({ profileId, status: "pending", createdAt: new Date(), updatedAt: new Date() });

    expect(await (await get(profileId)).json()).toEqual({
      company: { name: null, includesAiApply: false, sponsoredUntil: "2099-12-31" },
      individual: {
        plan: "carreira-pro",
        status: "pending",
        currentPeriodEnd: null,
        cancelable: false,
      },
      benefit: null,
      aiApply: { allowedBy: null, dailyLimit: 10 },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
      copay: null,
    });

    await db
      .update(talentSubscriptions)
      .set({ status: "active", currentPeriodEnd: "2099-01-01" })
      .where(eq(talentSubscriptions.profileId, profileId));

    expect(await (await get(profileId)).json()).toEqual({
      company: { name: null, includesAiApply: false, sponsoredUntil: "2099-12-31" },
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: "2099-01-01",
        cancelable: false,
      },
      benefit: null,
      aiApply: { allowedBy: "individual", dailyLimit: 10 },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
      copay: null,
    });
  });

  it("does not offer the upgrade while a checkout is in flight or payment is past due", async () => {
    const profileId = await profile("2020-01-01");

    await subscribed(profileId, "past_due", "2099-01-01");

    expect(await (await get(profileId)).json()).toMatchObject({ upgrade: { offered: false } });

    await db
      .update(talentSubscriptions)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(talentSubscriptions.profileId, profileId));

    expect(await (await get(profileId)).json()).toMatchObject({ upgrade: { offered: false } });

    await db
      .update(talentSubscriptions)
      .set({ updatedAt: new Date(Date.now() - 61 * 60_000) })
      .where(eq(talentSubscriptions.profileId, profileId));

    expect(await (await get(profileId)).json()).toMatchObject({ upgrade: { offered: true } });
  });

  it("does not offer the upgrade while billing is not configured", async () => {
    const profileId = await profile("2020-01-01");
    const response = await get(profileId, planApp({ ...gateway, configured: false }));

    expect(await response.json()).toMatchObject({ upgrade: { offered: false } });
  });

  it("answers 404 when the profile disappears while reading the plan", async () => {
    const vanishing = new Elysia().use(
      careerPlanRoutes(
        { ...repos.careerPlan, plan: async () => undefined },
        talentAccess({
          auth,
          webOrigin,
          talent: repos.talent,
          companyActive: async () => true,
          individualPlan: repos.careerPlan.individual,
        }),
        gateway,
        webOrigin,
        repos.benefits,
      ),
    );

    const response = await vanishing.handle(
      new Request("http://localhost/me/plan", {
        headers: { "x-test-talent-id": await profile("2099-12-31") },
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Profile not found" });
  });

  it("shows the plan before the terms are accepted", async () => {
    const profileId = await profile("2099-12-31", false);

    expect((await get(profileId)).status).toBe(200);
  });

  it("shows the plan and offers the upgrade to a person whose access lapsed", async () => {
    const profileId = await profile("2020-01-01");
    const response = await get(profileId, planApp(gateway, false));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      aiApply: { allowedBy: null },
      upgrade: { offered: true },
    });
  });

  it("starts a Carreira Pro checkout as a pending subscription", async () => {
    const profileId = await profile("2020-01-01", false);
    const response = await checkout(profileId, planApp(gateway, false));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://pay.example/bill_pro" });
    expect(checkouts).toEqual([
      {
        externalId: expect.stringMatching(new RegExp(`^talent:${profileId}:[a-z0-9]+$`)),
        planSlug: "carreira-pro",
        returnUrl: `${webOrigin}/colaborador?tela=carreira`,
        completionUrl: `${webOrigin}/colaborador?tela=carreira&plano=ok`,
      },
    ]);
    expect(await subscription(profileId)).toEqual({
      status: "pending",
      providerSubscriptionId: null,
      currentPeriodEnd: null,
    });
  });

  it("restarts the checkout of a canceled or expired Carreira Pro", async () => {
    const profileId = await profile("2099-12-31");

    await subscribed(profileId, "canceled", "2020-01-01");

    expect((await checkout(profileId)).status).toBe(200);
    expect(await subscription(profileId)).toEqual({
      status: "pending",
      providerSubscriptionId: null,
      currentPeriodEnd: "2020-01-01",
    });

    await db
      .update(talentSubscriptions)
      .set({ status: "active", currentPeriodEnd: "2020-01-01" })
      .where(eq(talentSubscriptions.profileId, profileId));

    expect((await checkout(profileId)).status).toBe(200);
    expect(await subscription(profileId)).toMatchObject({
      status: "pending",
      providerSubscriptionId: null,
    });
    expect(checkouts).toHaveLength(2);
    expect(checkouts[0].externalId).not.toBe(checkouts[1].externalId);
  });

  it("restarts the checkout of a canceled Carreira Pro without a period end", async () => {
    const profileId = await profile("2099-12-31");

    await subscribed(profileId, "canceled", null);

    expect((await checkout(profileId)).status).toBe(200);
  });

  it("refuses a new checkout while a canceled Carreira Pro still has access", async () => {
    const profileId = await profile("2099-12-31");
    const today = saoPauloDate(new Date());

    await subscribed(profileId, "canceled", today);

    const refused = await checkout(profileId);

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: `Carreira Pro canceled until ${today}` });
    expect(checkouts).toEqual([]);
  });

  it("keeps the provider subscription of an active Carreira Pro whose period lapsed", async () => {
    const profileId = await profile("2099-12-31");

    await subscribed(profileId, "active", "2020-01-01");

    expect((await checkout(profileId)).status).toBe(200);
    expect(await subscription(profileId)).toMatchObject({
      status: "pending",
      providerSubscriptionId: "subs_pro",
    });
  });

  describe("cancel", () => {
    const cancel = (profileId: string, target = app) =>
      target.handle(
        new Request("http://localhost/me/plan/cancel", {
          method: "POST",
          headers: { "x-test-talent-id": profileId, origin: webOrigin },
        }),
      );

    it("cancels at AbacatePay and keeps access until the period ends", async () => {
      const profileId = await profile("2020-01-01");

      await subscribed(profileId, "active", "2099-01-01");

      const response = await cancel(profileId);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ currentPeriodEnd: "2099-01-01" });
      expect(cancellations).toEqual(["subs_pro"]);
      expect(await subscription(profileId)).toEqual({
        status: "canceled",
        providerSubscriptionId: "subs_pro",
        currentPeriodEnd: "2099-01-01",
      });
      expect(await (await get(profileId)).json()).toMatchObject({
        individual: { status: "canceled", currentPeriodEnd: "2099-01-01" },
        aiApply: { allowedBy: "individual", dailyLimit: 10 },
        upgrade: { offered: false },
      });
    });

    it("keeps access on the last day and offers the upgrade again the day after", async () => {
      const profileId = await profile("2020-01-01");
      const today = saoPauloDate(new Date());
      const yesterday = saoPauloDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

      await subscribed(profileId, "canceled", today);

      expect(await (await get(profileId)).json()).toMatchObject({
        aiApply: { allowedBy: "individual" },
        upgrade: { offered: false },
      });

      await db
        .update(talentSubscriptions)
        .set({ currentPeriodEnd: yesterday })
        .where(eq(talentSubscriptions.profileId, profileId));

      expect(await (await get(profileId)).json()).toMatchObject({
        aiApply: { allowedBy: null },
        upgrade: { offered: true },
      });
    });

    it("answers 409 without an active Carreira Pro", async () => {
      const none = await profile("2099-12-31");

      expect((await cancel(none)).status).toBe(409);
      expect(await (await cancel(none)).json()).toEqual({ error: "No active Carreira Pro" });

      await subscribed(none, "pending", null);
      expect((await cancel(none)).status).toBe(409);

      await db
        .update(talentSubscriptions)
        .set({ status: "canceled" })
        .where(eq(talentSubscriptions.profileId, none));
      expect((await cancel(none)).status).toBe(409);

      for (const status of ["active", "past_due"] as const) {
        await db
          .update(talentSubscriptions)
          .set({ status, providerSubscriptionId: null })
          .where(eq(talentSubscriptions.profileId, none));
        expect((await cancel(none)).status).toBe(409);
      }

      expect(cancellations).toEqual([]);
    });

    it("cancels a past-due Carreira Pro", async () => {
      const profileId = await profile("2020-01-01");

      await subscribed(profileId, "past_due", "2099-01-01");

      expect((await cancel(profileId)).status).toBe(200);
      expect(cancellations).toEqual(["subs_pro"]);
      expect((await subscription(profileId)).status).toBe("canceled");
    });

    it("marks only the subscription it canceled", async () => {
      const profileId = await profile("2020-01-01");

      await subscribed(profileId, "active", "2099-01-01");
      await repos.careerPlan.markCanceled(profileId, "subs_replaced", new Date());

      expect((await subscription(profileId)).status).toBe("active");

      await repos.careerPlan.markCanceled(profileId, "subs_pro", new Date());

      expect((await subscription(profileId)).status).toBe("canceled");
    });

    it("exposes whether the plan can be canceled", async () => {
      const profileId = await profile("2020-01-01");

      await subscribed(profileId, "past_due", "2099-01-01");

      expect(await (await get(profileId)).json()).toMatchObject({
        individual: { status: "past_due", cancelable: true },
      });

      await db
        .update(talentSubscriptions)
        .set({ status: "canceled" })
        .where(eq(talentSubscriptions.profileId, profileId));

      expect(await (await get(profileId)).json()).toMatchObject({
        individual: { status: "canceled", cancelable: false },
      });
    });

    it("answers 502 and changes nothing when AbacatePay fails", async () => {
      const logged = vi.spyOn(console, "error");
      const profileId = await profile("2020-01-01");

      await subscribed(profileId, "active", "2099-01-01");

      const failing = planApp({
        ...gateway,
        cancelSubscription: async () => {
          throw new TypeError("secret provider detail");
        },
      });

      try {
        const response = await cancel(profileId, failing);

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "Could not cancel Carreira Pro" });
        expect(logged).toHaveBeenCalledWith("Carreira Pro cancellation failed", {
          name: "TypeError",
        });
        expect(await subscription(profileId)).toEqual({
          status: "active",
          providerSubscriptionId: "subs_pro",
          currentPeriodEnd: "2099-01-01",
        });
      } finally {
        logged.mockRestore();
      }
    });

    it("answers 503 without AbacatePay and changes nothing", async () => {
      const profileId = await profile("2020-01-01");

      await subscribed(profileId, "active", "2099-01-01");

      const response = await cancel(profileId, planApp({ ...gateway, configured: false }));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Billing not configured" });
      expect((await subscription(profileId)).status).toBe("active");
    });

    it("only cancels the subscription of the signed-in person", async () => {
      const mine = await profile("2020-01-01");
      const [, second] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

      const other = await repos.talent.enable({
        orgId: defaultOrgId,
        caseId: second.id,
        personalEmail: "outra@exemplo.com",
        sponsoredUntil: "2020-01-01",
      });

      if (other === "case_not_found" || other === "already_enabled" || other === "email_taken") {
        throw new Error(other);
      }

      await subscribed(mine, "active", "2099-01-01");
      await db.insert(talentSubscriptions).values({
        profileId: other.id,
        status: "active",
        providerSubscriptionId: "subs_other",
        currentPeriodEnd: "2099-01-01",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect((await cancel(mine)).status).toBe(200);
      expect(cancellations).toEqual(["subs_pro"]);
      expect((await subscription(other.id)).status).toBe("active");
      expect((await cancel(other.id)).status).toBe(200);
      expect(cancellations).toEqual(["subs_pro", "subs_other"]);
      expect((await subscription(mine)).providerSubscriptionId).toBe("subs_pro");
    });
  });

  it("refuses a second checkout while Carreira Pro is active", async () => {
    const profileId = await profile("2099-12-31");

    await subscribed(profileId, "active", null);

    const open = await checkout(profileId);

    expect(open.status).toBe(409);
    expect(await open.json()).toEqual({ error: "Already subscribed" });

    await db
      .update(talentSubscriptions)
      .set({ currentPeriodEnd: saoPauloDate(new Date()) })
      .where(eq(talentSubscriptions.profileId, profileId));

    expect((await checkout(profileId)).status).toBe(409);
    expect((await subscription(profileId)).status).toBe("active");
    expect(checkouts).toEqual([]);
  });

  it("refuses a second checkout while Carreira Pro is past due", async () => {
    const profileId = await profile("2099-12-31");

    await subscribed(profileId, "past_due", "2099-01-01");

    const duplicate = await checkout(profileId);

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "Already subscribed" });
    expect((await subscription(profileId)).status).toBe("past_due");
    expect(checkouts).toEqual([]);
  });

  it("refuses a second checkout while the first one is recent", async () => {
    const profileId = await profile("2099-12-31");

    await subscribed(profileId, "pending", null, new Date(Date.now() - 30 * 60_000));

    expect((await checkout(profileId)).status).toBe(409);
    expect(checkouts).toEqual([]);
  });

  it("restarts a checkout that stayed pending for over an hour", async () => {
    const profileId = await profile("2099-12-31");

    await subscribed(profileId, "pending", null, new Date(Date.now() - 61 * 60_000));

    expect((await checkout(profileId)).status).toBe(200);
    expect(checkouts).toHaveLength(1);
  });

  it("answers 503 without AbacatePay and stores nothing", async () => {
    const profileId = await profile("2099-12-31");
    const response = await checkout(profileId, planApp({ ...gateway, configured: false }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Billing not configured" });
    expect(await subscription(profileId)).toBeUndefined();
  });

  it("answers 502 when AbacatePay fails and logs only the error name", async () => {
    const logged = vi.spyOn(console, "error");
    const profileId = await profile("2099-12-31");

    const failing = planApp({
      ...gateway,
      createSubscriptionCheckout: async () => {
        throw new TypeError("secret provider detail");
      },
      cancelSubscription: async () => {
        throw new Error("not implemented");
      },
    });

    try {
      const response = await checkout(profileId, failing);

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Could not start the checkout" });
      expect(logged).toHaveBeenCalledWith("Carreira Pro checkout failed", { name: "TypeError" });
      expect((await checkout(profileId)).status).toBe(200);
    } finally {
      logged.mockRestore();
    }
  });

  describe("co-pay checkout", () => {
    const copay = (profileId: string, targetPlanId: string, target = app) =>
      target.handle(
        new Request("http://localhost/me/plan/copay-checkout", {
          method: "POST",
          headers: {
            "x-test-talent-id": profileId,
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify({ targetPlanId }),
        }),
      );

    async function planId(slug: string) {
      const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug));

      return plan.id;
    }

    async function assigned(profileId: string, slug = "gold") {
      const id = await planId(slug);

      await db.insert(benefitAssignments).values({
        orgId: defaultOrgId,
        profileId,
        assignedPlanId: id,
        effectivePlanId: id,
        source: "default",
        validUntil: "2099-12-31",
        updatedAt: new Date(0),
      });
    }

    async function stored(profileId: string) {
      const [row] = await db
        .select()
        .from(benefitAssignments)
        .where(eq(benefitAssignments.profileId, profileId));

      return row;
    }

    async function registered(from: string, to: string) {
      await db.insert(copayProducts).values({
        fromPlanId: await planId(from),
        toPlanId: await planId(to),
        abacatePayProductId: `prod_${from}_${to}`,
      });
    }

    it("reports the cheapest co-pay upgrade on the plan", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum-premium");
      await registered("gold", "platinum");
      await registered("gold", "silver");

      const body = await (await get(profileId)).json();

      expect(body.copay).toEqual({
        offered: true,
        targetPlanId: await planId("platinum"),
        targetPlanName: "Platinum",
        priceCents: expect.any(Number),
        active: false,
        checkoutOpen: false,
        endsAt: null,
        checkoutUrl: null,
        paymentFailed: false,
      });
      expect(body.copay.priceCents).toBeGreaterThan(0);
    });

    it("reports no co-pay without a product or an assignment", async () => {
      const profileId = await profile("2099-12-31");

      expect((await (await get(profileId)).json()).copay).toBeNull();

      await assigned(profileId);

      expect((await (await get(profileId)).json()).copay).toBeNull();

      await registered("gold", "silver");

      expect((await (await get(profileId)).json()).copay).toBeNull();
    });

    it("marks the co-pay active and not offered once subscribed", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db.update(benefitAssignments).set({ copaySubscriptionId: "subs_copay" });

      expect((await (await get(profileId)).json()).copay).toMatchObject({
        offered: false,
        active: true,
        checkoutOpen: false,
      });
    });

    it("shows the price the person agreed to once the co-pay exists", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db.update(benefitAssignments).set({
        effectivePlanId: await planId("platinum"),
        copaySubscriptionId: "subs_copay",
        copayPriceCents: 1234,
      });

      expect((await (await get(profileId)).json()).copay).toMatchObject({
        active: true,
        priceCents: 1234,
        targetPlanName: "Platinum",
      });
    });

    it("reports a legacy marked co-pay without a period end as not ending", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db
        .update(benefitAssignments)
        .set({ copaySubscriptionId: "subs_copay", copayCheckoutAt: new Date() });

      expect((await (await get(profileId)).json()).copay).toMatchObject({
        active: true,
        endsAt: null,
      });
    });

    it("quotes the current price again once an open checkout has expired", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db.update(benefitAssignments).set({
        copayCheckoutAt: new Date(Date.now() - 2 * 60 * 60_000),
        copayCheckoutId: "bill_old",
        copayPriceCents: 1,
      });

      const { copay: reported } = await (await get(profileId)).json();

      expect(reported).toMatchObject({ checkoutOpen: false });
      expect(reported.priceCents).toBeGreaterThan(1);
    });

    it("falls back to the current price for an open checkout without a stored price", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db
        .update(benefitAssignments)
        .set({ copayCheckoutAt: new Date(), copayTargetPlanId: await planId("platinum") });

      const { copay: reported } = await (await get(profileId)).json();

      expect(reported.checkoutOpen).toBe(true);
      expect(reported.priceCents).toBeGreaterThan(1);
    });

    it("reports no co-pay once the benefit assignment has expired", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db.update(benefitAssignments).set({ validUntil: "2020-01-01" });

      expect((await (await get(profileId)).json()).copay).toBeNull();
    });

    it("does not offer the co-pay when billing is not configured", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");

      const off = planApp({ ...gateway, configured: false });

      expect((await (await get(profileId, off)).json()).copay).toMatchObject({ offered: false });
    });

    it("starts a co-pay checkout for a valid upgrade", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");

      const response = await copay(profileId, await planId("platinum"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ url: "https://pay.example/bill_pro" });
      expect(checkouts).toEqual([
        {
          externalId: expect.stringMatching(
            new RegExp(`^copay:${profileId}:${await planId("platinum")}:[a-z0-9]+$`),
          ),
          planSlug: "prod_gold_platinum",
          returnUrl: `${webOrigin}/colaborador?tela=carreira`,
          completionUrl: `${webOrigin}/colaborador?tela=carreira&copay=ok`,
        },
      ]);
    });

    it("stores the issued checkout with the price the person agreed to", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await copay(profileId, await planId("platinum"));

      const [gold, platinum] = [await planId("gold"), await planId("platinum")];
      const prices = await repos.benefits.planPriceMap();

      expect(await stored(profileId)).toMatchObject({
        copayCheckoutId: "bill_pro",
        copayCheckoutUrl: "https://pay.example/bill_pro",
        copayPriceCents: prices.get(platinum)! - prices.get(gold)!,
        copayTargetPlanId: platinum,
        copaySubscriptionId: null,
      });
      expect((await (await get(profileId)).json()).copay).toMatchObject({
        checkoutOpen: true,
        checkoutUrl: "https://pay.example/bill_pro",
        active: false,
        priceCents: prices.get(platinum)! - prices.get(gold)!,
      });
    });

    it("returns the same URL for a repeat checkout inside the window without calling the gateway", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");

      const target = await planId("platinum");
      const first = await copay(profileId, target);
      const second = await copay(profileId, target);

      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      expect(checkouts).toHaveLength(1);
    });

    describe("repeat checkout that no longer matches", () => {
      let issued = 0;

      const numbered = planApp({
        ...gateway,
        async createSubscriptionCheckout(params: CheckoutParams) {
          issued += 1;
          checkouts.push(params);

          return { id: `bill_${issued}`, url: `https://pay.example/bill_${issued}` };
        },
      });

      beforeEach(() => {
        issued = 0;
      });

      it("voids the old checkout and issues a new one for a different target", async () => {
        const profileId = await profile("2099-12-31");

        await assigned(profileId);
        await registered("gold", "platinum");
        await registered("gold", "platinum-premium");
        await copay(profileId, await planId("platinum"), numbered);

        const premium = await planId("platinum-premium");
        const response = await copay(profileId, premium, numbered);

        expect(await response.json()).toEqual({ url: "https://pay.example/bill_2" });
        expect(checkouts).toHaveLength(2);
        expect(await stored(profileId)).toMatchObject({
          copayCheckoutId: "bill_2",
          copayTargetPlanId: premium,
        });
      });

      it("voids the old checkout and issues a new one when the price differs", async () => {
        const profileId = await profile("2099-12-31");

        await assigned(profileId);
        await registered("gold", "platinum");
        await copay(profileId, await planId("platinum"), numbered);
        await db.update(benefitAssignments).set({ copayPriceCents: 1 });

        const response = await copay(profileId, await planId("platinum"), numbered);

        expect(await response.json()).toEqual({ url: "https://pay.example/bill_2" });
        expect(await stored(profileId)).toMatchObject({ copayCheckoutId: "bill_2" });
      });

      it("does not offer the continue URL when the stored target is not the card target", async () => {
        const profileId = await profile("2099-12-31");

        await assigned(profileId);
        await registered("gold", "platinum");
        await db.update(benefitAssignments).set({
          copayCheckoutAt: new Date(),
          copayCheckoutId: "bill_old",
          copayCheckoutUrl: "https://pay.example/bill_old",
          copayPriceCents: 1,
          copayTargetPlanId: await planId("platinum-premium"),
        });

        expect((await (await get(profileId)).json()).copay).toMatchObject({
          checkoutOpen: true,
          checkoutUrl: null,
        });
      });
    });

    it("answers 409 to a repeat while the first request has not stored its URL yet", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db.update(benefitAssignments).set({ copayCheckoutAt: new Date() });

      const response = await copay(profileId, await planId("platinum"));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Co-pay checkout open" });
      expect(checkouts).toEqual([]);
    });

    it("clears the stored checkout when the gateway fails", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");

      const failing = planApp({
        configured: true,
        createSubscriptionCheckout: async () => {
          throw new TypeError("down");
        },
        cancelSubscription: async () => {},
      });

      await copay(profileId, await planId("platinum"), failing);

      expect(await stored(profileId)).toMatchObject({
        copayCheckoutAt: null,
        copayCheckoutId: null,
        copayCheckoutUrl: null,
        copayPriceCents: null,
      });
    });

    it("answers 502 when HR changed the assignment while the checkout was being issued", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");

      const voiding = planApp({
        ...gateway,
        async createSubscriptionCheckout(params: CheckoutParams) {
          await db.update(benefitAssignments).set({ copayCheckoutAt: null });

          return gateway.createSubscriptionCheckout(params);
        },
      });

      const response = await copay(profileId, await planId("platinum"), voiding);

      expect(response.status).toBe(502);
      expect(await stored(profileId)).toMatchObject({ copayCheckoutId: null });
    });

    it.each([
      ["active", "2099-12-31", "Carreira Pro active"],
      ["active", null, "Carreira Pro active"],
      ["past_due", "2000-01-01", "Carreira Pro active"],
      ["pending", null, "Carreira Pro checkout open"],
    ] as const)(
      "answers 409 while Carreira Pro is %s (period end %s)",
      async (status, end, error) => {
        const profileId = await profile("2099-12-31");

        await assigned(profileId);
        await registered("gold", "platinum");
        await subscribed(profileId, status, end);

        const response = await copay(profileId, await planId("platinum"));

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error });
        expect(checkouts).toEqual([]);
      },
    );

    it.each([
      ["a stale pending checkout", "pending", null],
      ["an expired subscription", "active", "2000-01-01"],
      ["a canceled subscription", "canceled", "2099-12-31"],
    ] as const)("starts a co-pay checkout over %s of Carreira Pro", async (_, status, end) => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await subscribed(profileId, status, end, new Date(Date.now() - 2 * 60 * 60_000));

      expect((await copay(profileId, await planId("platinum"))).status).toBe(200);
    });

    describe("Carreira Pro checkout", () => {
      it("answers 409 while a co-pay is active, wound down or has an open checkout", async () => {
        const profileId = await profile("2099-12-31");

        await assigned(profileId);
        await registered("gold", "platinum");
        await copay(profileId, await planId("platinum"));

        const open = await checkout(profileId);

        expect(open.status).toBe(409);
        expect(await open.json()).toEqual({ error: "Co-pay checkout open" });

        await db.update(benefitAssignments).set({ copaySubscriptionId: "subs_copay" });

        const active = await checkout(profileId);

        expect(active.status).toBe(409);
        expect(await active.json()).toEqual({ error: "Co-pay active" });

        await db
          .update(benefitAssignments)
          .set({ copayCheckoutAt: new Date(), copayPeriodEnd: "2099-12-31" });

        expect((await checkout(profileId)).status).toBe(409);
        expect(checkouts).toHaveLength(1);
      });

      it("starts once the co-pay checkout window has passed or no co-pay exists", async () => {
        const profileId = await profile("2099-12-31");

        expect((await checkout(profileId)).status).toBe(200);

        await db.delete(talentSubscriptions);
        await assigned(profileId);
        await db
          .update(benefitAssignments)
          .set({ copayCheckoutAt: new Date(Date.now() - 61 * 60_000) });

        expect((await checkout(profileId)).status).toBe(200);
      });
    });

    describe("cancellation", () => {
      const cancel = (profileId: string, headers: Record<string, string> = { origin: webOrigin }) =>
        app.handle(
          new Request("http://localhost/me/plan/copay-cancel", {
            method: "POST",
            headers: { "x-test-talent-id": profileId, ...headers },
          }),
        );

      async function upgraded(profileId: string, extra = {}) {
        await assigned(profileId);
        await registered("gold", "platinum");
        await db
          .update(benefitAssignments)
          .set({
            effectivePlanId: await planId("platinum"),
            copaySubscriptionId: "subs_copay",
            copayCheckoutId: "bill_pro",
            copayPriceCents: 4000,
            copayPeriodEnd: "2099-06-30",
            ...extra,
          })
          .where(eq(benefitAssignments.profileId, profileId));
      }

      it("cancels at the gateway and keeps the tier until the period end", async () => {
        const profileId = await profile("2099-12-31");

        await upgraded(profileId);

        const before = await (await get(profileId)).json();
        const response = await cancel(profileId);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ endsAt: "2099-06-30" });
        expect(cancellations).toEqual(["subs_copay"]);
        expect(await stored(profileId)).toMatchObject({
          effectivePlanId: await planId("platinum"),
          copaySubscriptionId: "subs_copay",
          copayPeriodEnd: "2099-06-30",
        });
        expect(before.copay).toMatchObject({ active: true, endsAt: null, priceCents: 4000 });
        expect((await (await get(profileId)).json()).copay).toMatchObject({
          active: true,
          endsAt: "2099-06-30",
          priceCents: 4000,
        });
      });

      it("reports a failed payment without an end date and clears it on cancel", async () => {
        const profileId = await profile("2099-12-31");
        const failedAt = new Date();

        await upgraded(profileId, { copayCheckoutAt: failedAt, copayPaymentFailedAt: failedAt });

        expect((await (await get(profileId)).json()).copay).toMatchObject({
          active: true,
          paymentFailed: true,
          endsAt: null,
        });

        await cancel(profileId);

        expect((await (await get(profileId)).json()).copay).toMatchObject({
          paymentFailed: false,
          endsAt: "2099-06-30",
        });
      });

      it("does not clobber a renewal that landed before the gateway failed", async () => {
        const profileId = await profile("2099-12-31");

        await upgraded(profileId);

        const racing = planApp({
          ...gateway,
          async cancelSubscription() {
            await repos.benefits.renewCopay(profileId, "subs_copay", "2099-07-31");

            throw new TypeError("down");
          },
        });

        const response = await racing.handle(
          new Request("http://localhost/me/plan/copay-cancel", {
            method: "POST",
            headers: { "x-test-talent-id": profileId, origin: webOrigin },
          }),
        );

        expect(response.status).toBe(502);
        expect(await stored(profileId)).toMatchObject({
          copayCheckoutAt: null,
          copayPeriodEnd: "2099-07-31",
        });
      });

      it("is repeatable", async () => {
        const profileId = await profile("2099-12-31");

        await upgraded(profileId);
        await cancel(profileId);

        expect((await cancel(profileId)).status).toBe(200);
      });

      it("falls back to one month from today for a co-pay without a period end", async () => {
        const profileId = await profile("2099-12-31");

        await upgraded(profileId, { copayPeriodEnd: null });

        expect(await (await cancel(profileId)).json()).toEqual({
          endsAt: addMonths(saoPauloDate(new Date()), 1),
        });
      });

      it("marks the co-pay before canceling at the gateway", async () => {
        const profileId = await profile("2099-12-31");
        const seen: (Date | null)[] = [];

        await upgraded(profileId);

        const watching = planApp({
          ...gateway,
          async cancelSubscription(id: string) {
            seen.push((await stored(profileId)).copayCheckoutAt);
            await gateway.cancelSubscription(id);
          },
        });

        await watching.handle(
          new Request("http://localhost/me/plan/copay-cancel", {
            method: "POST",
            headers: { "x-test-talent-id": profileId, origin: webOrigin },
          }),
        );

        expect(seen).toHaveLength(1);
        expect(seen[0]).not.toBeNull();
      });

      it("answers 409 without an active co-pay", async () => {
        const profileId = await profile("2099-12-31");

        expect((await cancel(profileId)).status).toBe(409);

        await assigned(profileId);

        const response = await cancel(profileId);

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: "No active co-pay" });
        expect(cancellations).toEqual([]);
      });

      it("never reaches another person's co-pay", async () => {
        const [, second] = await db.select({ id: offboardingCases.id }).from(offboardingCases);
        const owner = await profile("2099-12-31");

        await upgraded(owner);

        const created = await repos.talent.enable({
          orgId: defaultOrgId,
          caseId: second.id,
          personalEmail: "outra@exemplo.com",
          sponsoredUntil: "2099-12-31",
        });

        if (
          created === "case_not_found" ||
          created === "already_enabled" ||
          created === "email_taken"
        ) {
          throw new Error(created);
        }

        await repos.talent.acceptTerms(created.id);

        expect((await cancel(created.id)).status).toBe(409);
        expect(cancellations).toEqual([]);
        expect(await stored(owner)).toMatchObject({ copaySubscriptionId: "subs_copay" });
      });

      it("answers 409 without calling the gateway when HR reset the assignment first", async () => {
        const profileId = await profile("2099-12-31");

        await upgraded(profileId);

        const racing = new Elysia().use(
          careerPlanRoutes(
            repos.careerPlan,
            talentAccess({
              auth,
              webOrigin,
              talent: repos.talent,
              companyActive: async () => true,
              individualPlan: repos.careerPlan.individual,
            }),
            gateway,
            webOrigin,
            { ...repos.benefits, windDownCopay: async () => null },
          ),
        );

        const response = await racing.handle(
          new Request("http://localhost/me/plan/copay-cancel", {
            method: "POST",
            headers: { "x-test-talent-id": profileId, origin: webOrigin },
          }),
        );

        expect(response.status).toBe(409);
        expect(cancellations).toEqual([]);
      });

      it("answers 502 and keeps everything when the gateway fails", async () => {
        const logged = vi.spyOn(console, "error");
        const profileId = await profile("2099-12-31");

        await upgraded(profileId);

        const failing = planApp({
          ...gateway,
          cancelSubscription: async () => {
            throw new TypeError("secret provider detail");
          },
        });

        try {
          const response = await failing.handle(
            new Request("http://localhost/me/plan/copay-cancel", {
              method: "POST",
              headers: { "x-test-talent-id": profileId, origin: webOrigin },
            }),
          );

          expect(response.status).toBe(502);
          expect(await response.json()).toEqual({ error: "Could not cancel the co-pay" });
          expect(logged).toHaveBeenCalledWith("Co-pay cancellation failed", { name: "TypeError" });
          expect(await stored(profileId)).toMatchObject({
            copaySubscriptionId: "subs_copay",
            copayCheckoutAt: null,
            copayPeriodEnd: "2099-06-30",
          });
        } finally {
          logged.mockRestore();
        }
      });

      it("answers 503 without AbacatePay", async () => {
        const profileId = await profile("2099-12-31");

        await upgraded(profileId);

        const response = await planApp({ ...gateway, configured: false }).handle(
          new Request("http://localhost/me/plan/copay-cancel", {
            method: "POST",
            headers: { "x-test-talent-id": profileId, origin: webOrigin },
          }),
        );

        expect(response.status).toBe(503);
      });

      it("refuses a cross-origin request", async () => {
        const profileId = await profile("2099-12-31");

        await upgraded(profileId);

        expect((await cancel(profileId, { origin: "https://evil.example" })).status).toBe(403);
        expect((await cancel(profileId, {})).status).toBe(403);
        expect(cancellations).toEqual([]);
      });
    });

    it("gives a second co-pay checkout its own external id", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");

      const target = await planId("platinum");

      expect((await copay(profileId, target)).status).toBe(200);
      await db
        .update(benefitAssignments)
        .set({ copayCheckoutAt: new Date(Date.now() - 61 * 60_000) })
        .where(eq(benefitAssignments.profileId, profileId));
      expect((await copay(profileId, target)).status).toBe(200);
      expect(checkouts).toHaveLength(2);
      expect(checkouts[1].externalId).not.toBe(checkouts[0].externalId);
    });

    it("answers 404 without a benefit assignment", async () => {
      const profileId = await profile("2099-12-31");

      expect((await copay(profileId, await planId("platinum"))).status).toBe(404);
    });

    it("answers 422 for the same or a lower tier", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "silver");

      expect((await copay(profileId, await planId("gold"))).status).toBe(422);
      expect((await copay(profileId, await planId("silver"))).status).toBe(422);
      expect((await copay(profileId, missingPlan)).status).toBe(422);
    });

    it("answers 422 when no co-pay product is registered", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);

      expect((await copay(profileId, await planId("platinum"))).status).toBe(422);
    });

    it("answers 503 without AbacatePay", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);

      const response = await copay(
        profileId,
        await planId("platinum"),
        planApp({ ...gateway, configured: false }),
      );

      expect(response.status).toBe(503);
    });

    it("answers 409 when a co-pay is already active", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db.update(benefitAssignments).set({ copaySubscriptionId: "subs_copay" });

      expect((await copay(profileId, await planId("platinum"))).status).toBe(409);
      expect(checkouts).toEqual([]);
    });

    it("answers 409 when the assignment has expired", async () => {
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");
      await db.update(benefitAssignments).set({ validUntil: "2000-01-01" });

      expect((await copay(profileId, await planId("platinum"))).status).toBe(409);
    });

    it("releases the lock and answers 502 when AbacatePay fails", async () => {
      const logged = vi.spyOn(console, "error");
      const profileId = await profile("2099-12-31");

      await assigned(profileId);
      await registered("gold", "platinum");

      const failing = planApp({
        configured: true,
        createSubscriptionCheckout: async () => {
          throw new TypeError("secret provider detail");
        },
        cancelSubscription: async () => {
          throw new Error("not implemented");
        },
      });

      try {
        const target = await planId("platinum");
        const response = await copay(profileId, target, failing);

        expect(response.status).toBe(502);
        expect(logged).toHaveBeenCalledWith("Co-pay checkout failed", { name: "TypeError" });
        expect((await copay(profileId, target)).status).toBe(200);
      } finally {
        logged.mockRestore();
      }
    });
  });
});
