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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe.skipIf(!url)("career plan route", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  const app = new Elysia().use(
    careerPlanRoutes(
      repos.careerPlan,
      talentAccess({ auth, webOrigin, talent: repos.talent, companyActive: async () => true }),
    ),
  );

  const get = (profileId: string) =>
    app.handle(
      new Request("http://localhost/me/plan", { headers: { "x-test-talent-id": profileId } }),
    );

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await seedDatabase(db, testSeedFixtures);
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

  it("answers 404 when the profile disappears while reading the plan", async () => {
    const vanishing = new Elysia().use(
      careerPlanRoutes(
        { ...repos.careerPlan, plan: async () => undefined },
        talentAccess({ auth, webOrigin, talent: repos.talent, companyActive: async () => true }),
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

  it("needs accepted terms", async () => {
    const profileId = await profile("2099-12-31", false);

    expect((await get(profileId)).status).toBe(403);
  });
});
