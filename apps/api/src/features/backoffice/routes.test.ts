import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient, type Database } from "@offboard/db/client";
import { inArray } from "drizzle-orm";
import { organizations, plans } from "@offboard/db/schema";
import { Elysia } from "elysia";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PortalAccess } from "../../shared/portal-auth.js";
import { staffAccess } from "../../shared/staff-access.js";
import { createBackofficeRepository } from "./repository.js";
import { backofficeRoutes } from "./routes.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const staffPrincipal = {
  id: "m1",
  name: "Staff",
  email: "staff@offboard.xyz",
  role: "admin" as const,
  orgId: "00000000-0000-0000-0000-000000000001",
};

function appFor(access: PortalAccess, db: Database) {
  const auth = {
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
    resolvePrincipal: () => Promise.resolve(access),
  };

  return new Elysia().use(backofficeRoutes(createBackofficeRepository(db), staffAccess(auth)));
}

describe.skipIf(!url)("backoffice routes", () => {
  const db = createClient(url ?? "");
  const staff: PortalAccess = { kind: "staff", email: staffPrincipal.email };
  let orgId: string;
  let planId: string;

  function get(path: string, access: PortalAccess = staff) {
    return appFor(access, db).handle(new Request(`http://api.test${path}`));
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../../../../packages/db/drizzle", import.meta.url),
      ),
    });

    const [org] = await db
      .insert(organizations)
      .values({ name: "Backoffice Route Org", slug: `bo-route-${randomUUID()}` })
      .returning({ id: organizations.id });

    orgId = org.id;

    [{ id: planId }] = await db
      .insert(plans)
      .values({
        name: "Plano Rota",
        slug: `plan-route-${randomUUID()}`,
        monthlyPriceCents: 100,
        maxEmployees: 1,
      })
      .returning({ id: plans.id });
  });

  afterAll(async () => {
    await db.delete(organizations).where(inArray(organizations.id, [orgId]));
    await db.delete(plans).where(inArray(plans.id, [planId]));
    await db.$client.end();
  });

  it.each([
    "/backoffice/summary",
    "/backoffice/organizations",
    `/backoffice/organizations/${randomUUID()}`,
    "/backoffice/talent",
    "/backoffice/plans",
  ])("blocks %s for anonymous visitors", async (path) => {
    const response = await get(path, { kind: "anonymous" });

    expect(response.status).toBe(401);
  });

  it("blocks a customer admin from every backoffice route", async () => {
    const customerAdmin: PortalAccess = {
      kind: "authenticated",
      principal: { ...staffPrincipal, email: "ceo@acme.com" },
    };

    const response = await get("/backoffice/plans", customerAdmin);

    expect(response.status).toBe(403);
  });

  it("serves the summary to staff", async () => {
    const response = await get("/backoffice/summary");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ organizations: expect.any(Number) });
  });

  it("pages the organization list", async () => {
    const response = await get("/backoffice/organizations?limit=1&offset=0");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("uses the default page for organizations when no pagination is given", async () => {
    const response = await get("/backoffice/organizations");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.length).toBeLessThanOrEqual(25);
  });

  it("applies explicit pagination to organizations and talent", async () => {
    const organizations = await get("/backoffice/organizations?limit=2&offset=0");
    const talent = await get("/backoffice/talent?limit=3&offset=0");

    expect(organizations.status).toBe(200);
    expect((await organizations.json()).items.length).toBeLessThanOrEqual(2);
    expect(talent.status).toBe(200);
    expect((await talent.json()).items.length).toBeLessThanOrEqual(3);
  });

  it("uses a default page when no pagination is given", async () => {
    const response = await get("/backoffice/talent");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: expect.any(Array) });
  });

  it("rejects a page size above the maximum", async () => {
    const response = await get("/backoffice/talent?limit=500");

    expect(response.status).toBe(422);
  });

  it("returns an organization that exists", async () => {
    const response = await get(`/backoffice/organizations/${orgId}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: orgId, name: "Backoffice Route Org" });
  });

  it("returns 404 for an unknown organization", async () => {
    const response = await get(`/backoffice/organizations/${randomUUID()}`);

    expect(response.status).toBe(404);
  });

  it("rejects an organization id that is not a uuid", async () => {
    const response = await get("/backoffice/organizations/acme");

    expect(response.status).toBe(422);
  });

  it("serves the plan catalogue to staff", async () => {
    const response = await get("/backoffice/plans");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Plano Rota" })]),
    );
  });
});
