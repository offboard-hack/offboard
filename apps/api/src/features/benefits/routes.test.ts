import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  benefitAssignments,
  benefitPolicies,
  defaultOrgId,
  plans,
  talentProfiles,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { asc } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Elysia } from "elysia";
import { createRepositories } from "../../repositories.js";
import { portalAccess } from "../../shared/access.js";
import type { PortalAuth } from "../../shared/portal-auth.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import { benefitRoutes } from "./routes.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";

const auth: PortalAuth = {
  handler: () => Promise.resolve(new Response("ok")),
  resolvePrincipal(headers) {
    const role = headers.get("x-test-role") === "gestor" ? "gestor" : "admin";

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

describe.skipIf(!url)("benefit routes", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const app = new Elysia().use(benefitRoutes(repos.benefits, portalAccess(auth, webOrigin)));

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });
  });

  beforeEach(async () => {
    await db.delete(benefitAssignments);
    await db.delete(benefitPolicies);

    await seedDatabase(db, testSeedFixtures);
  });

  afterAll(async () => {
    await db.delete(benefitAssignments);
    await db.delete(benefitPolicies);

    await db.$client.end();
  });

  function call(path: string, init: { method?: string; role?: string; json?: unknown } = {}) {
    const headers = new Headers({ origin: webOrigin });

    if (init.role) headers.set("x-test-role", init.role);

    if (init.json !== undefined) headers.set("content-type", "application/json");

    return app.handle(
      new Request(`http://localhost${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
      }),
    );
  }

  async function planIds() {
    const rows = await db.select().from(plans).orderBy(asc(plans.monthlyPriceCents));

    return { low: rows[0].id, high: rows[rows.length - 1].id };
  }

  async function profile() {
    const [row] = await db
      .insert(talentProfiles)
      .values({
        orgId: defaultOrgId,
        personalEmail: `pessoa-${crypto.randomUUID()}@exemplo.com`,
        name: "Pessoa Teste",
        sponsoredUntil: "2099-12-31",
      })
      .returning({ id: talentProfiles.id });

    return row.id;
  }

  async function savePolicy(months = 3) {
    const { low, high } = await planIds();

    const policy = {
      defaultPlanId: low,
      benefitDurationMonths: months,
      rules: [{ id: "r1", field: "department", operator: "equals", value: "Eng", planId: high }],
    };

    await call("/benefit-policy", { method: "PUT", json: policy });

    return policy;
  }

  function monthsFromToday(months: number) {
    const date = new Date(`${saoPauloDate(new Date())}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + months);

    return date.toISOString().slice(0, 10);
  }

  it("returns 404 when no policy exists", async () => {
    expect((await call("/benefit-policy")).status).toBe(404);
  });

  it("saves a policy and reads it back", async () => {
    const policy = await savePolicy();

    const res = await call("/benefit-policy", { role: "gestor" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(policy);
  });

  it("accepts a policy without a default plan", async () => {
    const res = await call("/benefit-policy", {
      method: "PUT",
      json: { defaultPlanId: null, benefitDurationMonths: 6, rules: [] },
    });

    expect(res.status).toBe(204);
  });

  it("rejects rules with an invalid plan id", async () => {
    const res = await call("/benefit-policy", {
      method: "PUT",
      json: {
        defaultPlanId: null,
        benefitDurationMonths: 6,
        rules: [{ id: "r1", field: "role", operator: "equals", value: "x", planId: "nope" }],
      },
    });

    expect(res.status).toBe(422);
  });

  it("rejects a duration outside 1 to 24 months", async () => {
    const res = await call("/benefit-policy", {
      method: "PUT",
      json: { defaultPlanId: null, benefitDurationMonths: 25, rules: [] },
    });

    expect(res.status).toBe(422);
  });

  it("rejects a policy that references an unknown plan", async () => {
    const unknown = crypto.randomUUID();

    const asDefault = await call("/benefit-policy", {
      method: "PUT",
      json: { defaultPlanId: unknown, benefitDurationMonths: 6, rules: [] },
    });

    const asRule = await call("/benefit-policy", {
      method: "PUT",
      json: {
        defaultPlanId: null,
        benefitDurationMonths: 6,
        rules: [{ id: "r1", field: "role", operator: "equals", value: "x", planId: unknown }],
      },
    });

    expect(asDefault.status).toBe(422);
    expect(asRule.status).toBe(422);
  });

  it("lists no assignments initially", async () => {
    const res = await call("/benefit-assignments", { role: "gestor" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("creates a manual assignment valid for the policy duration", async () => {
    await savePolicy(3);
    const { high } = await planIds();
    const profileId = await profile();

    const res = await call("/benefit-assignments", {
      method: "POST",
      json: { profileId, planId: high, source: "manual" },
    });

    expect(res.status).toBe(201);

    const list = await (await call("/benefit-assignments")).json();

    expect(list).toEqual([
      {
        id: (await res.json()).id,
        profileId,
        profileName: "Pessoa Teste",
        assignedPlanName: expect.any(String),
        effectivePlanName: expect.any(String),
        source: "manual",
        validUntil: monthsFromToday(3),
      },
    ]);
    expect(list[0].assignedPlanName).toBe(list[0].effectivePlanName);
  });

  it("defaults to six months without a policy", async () => {
    const { low } = await planIds();
    const profileId = await profile();

    await call("/benefit-assignments", { method: "POST", json: { profileId, planId: low } });

    const [row] = await (await call("/benefit-assignments")).json();

    expect(row.validUntil).toBe(monthsFromToday(6));
  });

  it("replaces the assignment when the profile already has one", async () => {
    const { low, high } = await planIds();
    const profileId = await profile();

    await call("/benefit-assignments", { method: "POST", json: { profileId, planId: low } });
    await call("/benefit-assignments", { method: "POST", json: { profileId, planId: high } });

    expect(await (await call("/benefit-assignments")).json()).toHaveLength(1);
  });

  it("rejects assignments for an unknown plan or a profile outside the org", async () => {
    const { low } = await planIds();
    const profileId = await profile();

    const unknownPlan = await call("/benefit-assignments", {
      method: "POST",
      json: { profileId, planId: crypto.randomUUID() },
    });

    const unknownProfile = await call("/benefit-assignments", {
      method: "POST",
      json: { profileId: crypto.randomUUID(), planId: low },
    });

    expect(unknownPlan.status).toBe(422);
    expect(unknownProfile.status).toBe(404);
  });

  it("updates the assigned plan of an assignment", async () => {
    const { low, high } = await planIds();
    const profileId = await profile();

    const created = await call("/benefit-assignments", {
      method: "POST",
      json: { profileId, planId: low },
    });

    const { id } = await created.json();
    const [before] = await (await call("/benefit-assignments")).json();

    const res = await call(`/benefit-assignments/${id}`, { method: "PUT", json: { planId: high } });
    const [after] = await (await call("/benefit-assignments")).json();

    expect(res.status).toBe(200);
    expect(after.assignedPlanName).not.toBe(before.assignedPlanName);
    expect(after.effectivePlanName).toBe(after.assignedPlanName);
    expect(after.validUntil).toBe(before.validUntil);
  });

  it("rejects updates for an unknown plan or assignment", async () => {
    const { low } = await planIds();

    const unknownPlan = await call(`/benefit-assignments/${crypto.randomUUID()}`, {
      method: "PUT",
      json: { planId: crypto.randomUUID() },
    });

    const unknownAssignment = await call(`/benefit-assignments/${crypto.randomUUID()}`, {
      method: "PUT",
      json: { planId: low },
    });

    expect(unknownPlan.status).toBe(422);
    expect(unknownAssignment.status).toBe(404);
  });

  it("forbids writes for non-admin roles", async () => {
    const { low } = await planIds();
    const json = { profileId: crypto.randomUUID(), planId: low };

    const responses = await Promise.all([
      call("/benefit-policy", {
        method: "PUT",
        role: "gestor",
        json: { defaultPlanId: null, benefitDurationMonths: 6, rules: [] },
      }),
      call("/benefit-assignments", { method: "POST", role: "gestor", json }),
      call(`/benefit-assignments/${crypto.randomUUID()}`, {
        method: "PUT",
        role: "gestor",
        json: { planId: low },
      }),
    ]);

    expect(responses.map((res) => res.status)).toEqual([403, 403, 403]);
  });
});
