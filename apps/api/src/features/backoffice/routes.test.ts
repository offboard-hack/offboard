import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient, type Database } from "@offboard/db/client";
import { inArray } from "drizzle-orm";
import { organizations, plans } from "@offboard/db/schema";
import { Elysia } from "elysia";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessKeys, audience, issuer } from "../../shared/access-token.test-utils.js";
import { accessVerifier, type AccessVerifier } from "../../shared/cloudflare-access.js";
import { parseStaffEmails, staffAccess } from "../../shared/staff-access.js";
import { createBackofficeRepository } from "./repository.js";
import { backofficeRoutes } from "./routes.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

function appFor(verify: AccessVerifier, db: Database) {
  return new Elysia().use(
    backofficeRoutes(
      createBackofficeRepository(db),
      staffAccess({ verify, staffEmails: parseStaffEmails("staff@offboard.xyz") }),
    ),
  );
}

describe.skipIf(!url)("backoffice routes", () => {
  const db = createClient(url ?? "");
  let access: Awaited<ReturnType<typeof accessKeys>>;
  let staffToken: string;
  let orgId: string;
  let planId: string;

  function get(path: string, token?: string) {
    const headers = token === undefined ? undefined : { "cf-access-jwt-assertion": token };

    return appFor(accessVerifier(issuer, audience, access.keys), db).handle(
      new Request(`http://api.test${path}`, { headers }),
    );
  }

  beforeAll(async () => {
    access = await accessKeys();
    staffToken = await access.sign({ email: "staff@offboard.xyz" });

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
  ])("blocks %s without an Access token", async (path) => {
    const response = await get(path);

    expect(response.status).toBe(401);
  });

  it("blocks an identity that is not staff", async () => {
    const customerAdmin = await access.sign({ email: "ceo@acme.com" });

    const response = await get("/backoffice/plans", customerAdmin);

    expect(response.status).toBe(403);
  });

  it("serves the summary to staff", async () => {
    const response = await get("/backoffice/summary", staffToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ organizations: expect.any(Number) });
  });

  it("pages the organization list", async () => {
    const response = await get("/backoffice/organizations?limit=1&offset=0", staffToken);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("uses the default page for organizations when no pagination is given", async () => {
    const response = await get("/backoffice/organizations", staffToken);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.length).toBeLessThanOrEqual(25);
  });

  it("applies explicit pagination to organizations and talent", async () => {
    const organizationsPage = await get("/backoffice/organizations?limit=2&offset=0", staffToken);
    const talent = await get("/backoffice/talent?limit=3&offset=0", staffToken);

    expect(organizationsPage.status).toBe(200);
    expect((await organizationsPage.json()).items.length).toBeLessThanOrEqual(2);
    expect(talent.status).toBe(200);
    expect((await talent.json()).items.length).toBeLessThanOrEqual(3);
  });

  it("uses a default page when no pagination is given", async () => {
    const response = await get("/backoffice/talent", staffToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: expect.any(Array) });
  });

  it("rejects a page size above the maximum", async () => {
    const response = await get("/backoffice/talent?limit=500", staffToken);

    expect(response.status).toBe(422);
  });

  it("returns an organization that exists", async () => {
    const response = await get(`/backoffice/organizations/${orgId}`, staffToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: orgId, name: "Backoffice Route Org" });
  });

  it("returns 404 for an unknown organization", async () => {
    const response = await get(`/backoffice/organizations/${randomUUID()}`, staffToken);

    expect(response.status).toBe(404);
  });

  it("rejects an organization id that is not a uuid", async () => {
    const response = await get("/backoffice/organizations/acme", staffToken);

    expect(response.status).toBe(422);
  });

  it("serves the plan catalogue to staff", async () => {
    const response = await get("/backoffice/plans", staffToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Plano Rota" })]),
    );
  });
});
