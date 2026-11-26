import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { defaultOrgId, employeeAccess, offboardingCases, organizations } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { emptyEmployeePlan, type EmployeePlan } from "@offboard/employee";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Elysia } from "elysia";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRepositories } from "../../repositories.js";
import { portalAccess } from "../../shared/access.js";
import type { PortalAuth } from "../../shared/portal-auth.js";
import { employeeRoutes } from "./routes.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const otherOrgId = "00000000-0000-0000-0000-0000000000c3";

const auth: PortalAuth = {
  handler: async () => new Response(null),
  resolvePrincipal: (headers) =>
    Promise.resolve({
      kind: "authenticated",
      principal: {
        id: "test-member",
        name: "RH",
        email: "rh@example.com",
        role: "admin",
        orgId: headers.get("x-test-org") ?? defaultOrgId,
      },
    }),
};

type Settings = {
  email: null;
  plan: EmployeePlan;
  revision: number;
  careerSponsoredUntil?: string | null;
};

describe.skipIf(!url)("employee access settings", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  function routes(repo = repos.employee) {
    return new Elysia().use(
      employeeRoutes(
        repo,
        portalAccess(auth, webOrigin),
        async () => null,
        webOrigin,
        async () => undefined,
        async () => "sent",
      ),
    );
  }

  const app = routes();

  function call(caseId: string, orgId: string, body?: Settings, target = app) {
    return target.handle(
      new Request(`http://localhost/employee-access/${caseId}`, {
        method: body === undefined ? "GET" : "PUT",
        headers: { origin: webOrigin, "content-type": "application/json", "x-test-org": orgId },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  async function createCase(orgId: string, deadline: string) {
    const [row] = await db
      .insert(offboardingCases)
      .values({ orgId, name: "Pessoa", role: "Dev", department: "Eng", deadline })
      .returning({ id: offboardingCases.id });

    return row.id;
  }

  async function storedDate(caseId: string) {
    const [row] = await db
      .select({ careerSponsoredUntil: employeeAccess.careerSponsoredUntil })
      .from(employeeAccess)
      .where(eq(employeeAccess.caseId, caseId));

    return row?.careerSponsoredUntil;
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
    await db
      .insert(organizations)
      .values({ id: otherOrgId, name: "Outra", slug: "outra-carreira" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("defaults the career sponsorship to three months after the deadline", async () => {
    const caseId = await createCase(defaultOrgId, "2026-11-30");

    expect(await (await call(caseId, defaultOrgId)).json()).toEqual({
      email: null,
      plan: emptyEmployeePlan,
      revision: 0,
      careerSponsoredUntil: "2027-02-28",
      careerSponsoredIsDefault: true,
    });
  });

  it("saves, keeps and resets the career sponsorship date", async () => {
    const caseId = await createCase(defaultOrgId, "2027-01-10");
    const base = { email: null, plan: emptyEmployeePlan };

    const created = await call(caseId, defaultOrgId, {
      ...base,
      revision: 0,
      careerSponsoredUntil: "2027-06-30",
    });

    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      ...base,
      revision: 1,
      careerSponsoredUntil: "2027-06-30",
      careerSponsoredIsDefault: false,
    });

    const kept = await call(caseId, defaultOrgId, { ...base, revision: 1 });

    expect(await kept.json()).toMatchObject({
      revision: 2,
      careerSponsoredUntil: "2027-06-30",
      careerSponsoredIsDefault: false,
    });

    const changed = await call(caseId, defaultOrgId, {
      ...base,
      revision: 2,
      careerSponsoredUntil: "2027-08-01",
    });

    expect(await changed.json()).toMatchObject({ careerSponsoredUntil: "2027-08-01" });

    const reset = await call(caseId, defaultOrgId, {
      ...base,
      revision: 3,
      careerSponsoredUntil: null,
    });

    expect(await reset.json()).toMatchObject({
      revision: 4,
      careerSponsoredUntil: "2027-04-10",
      careerSponsoredIsDefault: true,
    });
    expect(await storedDate(caseId)).toBeNull();
  });

  it("rejects a career sponsorship date that is not a calendar date", async () => {
    const caseId = await createCase(defaultOrgId, "2027-01-10");

    const response = await call(caseId, defaultOrgId, {
      email: null,
      plan: emptyEmployeePlan,
      revision: 0,
      careerSponsoredUntil: "31/12/2027",
    });

    expect(response.status).toBe(422);
  });

  it("keeps another organization from reading or setting the career sponsorship date", async () => {
    const caseId = await createCase(defaultOrgId, "2027-01-10");
    const settings = { email: null, plan: emptyEmployeePlan };

    await call(caseId, defaultOrgId, {
      ...settings,
      revision: 0,
      careerSponsoredUntil: "2027-05-01",
    });

    expect((await call(caseId, otherOrgId)).status).toBe(404);

    const foreign = [
      await call(caseId, otherOrgId, {
        ...settings,
        revision: 1,
        careerSponsoredUntil: "2099-01-01",
      }),
      await call(caseId, otherOrgId, {
        ...settings,
        revision: 0,
        careerSponsoredUntil: "2099-01-01",
      }),
    ];

    expect(foreign.map((response) => response.status)).toEqual([404, 404]);
    expect(await storedDate(caseId)).toBe("2027-05-01");

    const ownCase = await createCase(otherOrgId, "2027-01-10");

    await call(ownCase, otherOrgId, {
      ...settings,
      revision: 0,
      careerSponsoredUntil: "2099-01-01",
    });

    expect(await storedDate(caseId)).toBe("2027-05-01");
    expect(await storedDate(ownCase)).toBe("2099-01-01");
  });

  it("answers 404 when the case disappears right after saving", async () => {
    const caseId = await createCase(defaultOrgId, "2027-01-10");
    const vanishing = routes({ ...repos.employee, readSettings: async () => null });

    const response = await call(
      caseId,
      defaultOrgId,
      { email: null, plan: emptyEmployeePlan, revision: 0 },
      vanishing,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Case not found" });
  });
});
