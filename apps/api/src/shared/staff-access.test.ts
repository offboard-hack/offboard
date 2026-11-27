import { Elysia } from "elysia";
import { describe, expect, it } from "vitest";
import { parseStaffEmails, staffAccess } from "./staff-access.js";
import type { PortalAccess, PortalAuth } from "./portal-auth.js";

function authReturning(access: PortalAccess) {
  return {
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
    resolvePrincipal: () => Promise.resolve(access),
  } satisfies PortalAuth;
}

function probe(access: PortalAccess) {
  return new Elysia()
    .use(staffAccess(authReturning(access)))
    .get("/probe", () => ({ ok: true }), { staff: true })
    .handle(new Request("http://api.test/probe"));
}

describe("parseStaffEmails", () => {
  it("splits, trims and lowercases the allowlist", () => {
    expect(parseStaffEmails(" Ana@x.com, ,BEA@x.com ")).toEqual(
      new Set(["ana@x.com", "bea@x.com"]),
    );
  });

  it("is empty when the variable is unset", () => {
    expect(parseStaffEmails(undefined)).toEqual(new Set());
  });
});

describe("staffAccess", () => {
  it("rejects anonymous requests with 401 and no-store", async () => {
    const response = await probe({ kind: "anonymous" });

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a customer portal session with 403", async () => {
    const response = await probe({
      kind: "authenticated",
      principal: {
        id: "m1",
        name: "Admin",
        email: "ceo@acme.com",
        role: "admin",
        orgId: "00000000-0000-0000-0000-000000000001",
        orgName: "Default",
      },
    });

    expect(response.status).toBe(403);
  });

  it("rejects a forbidden session with 403", async () => {
    expect((await probe({ kind: "forbidden" })).status).toBe(403);
  });

  it("admits a staff session", async () => {
    const response = await probe({ kind: "staff", email: "staff@offboard.xyz" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
