import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
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
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import { talentAccess } from "../../shared/talent-access.js";
import { careerPlanRoutes } from "./routes.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";

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

  const gateway = {
    configured: true,
    async createSubscriptionCheckout(params: CheckoutParams) {
      checkouts.push(params);

      return { id: "bill_pro", url: "https://pay.example/bill_pro" };
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
      aiApply: { allowedBy: "company" },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
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
      aiApply: { allowedBy: null },
      upgrade: { offered: true, priceCents: 7900, dailyLimit: 10 },
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
      individual: { plan: "carreira-pro", status: "pending", currentPeriodEnd: null },
      aiApply: { allowedBy: null },
      upgrade: { offered: true, priceCents: 7900, dailyLimit: 10 },
    });

    await db
      .update(talentSubscriptions)
      .set({ status: "active", currentPeriodEnd: "2099-01-01" })
      .where(eq(talentSubscriptions.profileId, profileId));

    expect(await (await get(profileId)).json()).toEqual({
      company: { name: null, includesAiApply: false, sponsoredUntil: "2099-12-31" },
      individual: { plan: "carreira-pro", status: "active", currentPeriodEnd: "2099-01-01" },
      aiApply: { allowedBy: "individual" },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
    });
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
        externalId: `talent:${profileId}`,
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

    await subscribed(profileId, "canceled", "2099-01-01");

    expect((await checkout(profileId)).status).toBe(200);
    expect(await subscription(profileId)).toEqual({
      status: "pending",
      providerSubscriptionId: "subs_pro",
      currentPeriodEnd: "2099-01-01",
    });

    await db
      .update(talentSubscriptions)
      .set({ status: "active", currentPeriodEnd: "2020-01-01" })
      .where(eq(talentSubscriptions.profileId, profileId));

    expect((await checkout(profileId)).status).toBe(200);
    expect((await subscription(profileId)).status).toBe("pending");
    expect(checkouts).toHaveLength(2);
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
      configured: true,
      createSubscriptionCheckout: async () => {
        throw new TypeError("secret provider detail");
      },
    });

    try {
      const response = await checkout(profileId, failing);

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Could not start the checkout" });
      expect(logged).toHaveBeenCalledWith("Carreira Pro checkout failed", { name: "TypeError" });
    } finally {
      logged.mockRestore();
    }
  });
});
