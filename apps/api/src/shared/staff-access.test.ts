import { Elysia } from "elysia";
import { describe, expect, it } from "vitest";
import type { PortalAccess, PortalAuth } from "./portal-auth.js";
import { parseStaffEmails, staffAccess } from "./staff-access.js";

function authReturning(access: PortalAccess) {
  return {
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
    resolvePrincipal: () => Promise.resolve(access),
  } satisfies PortalAuth;
}

const member = {
  kind: "authenticated" as const,
  principal: {
    id: "m1",
    name: "Staff",
    email: "Staff@Offboard.xyz",
    role: "admin" as const,
    orgId: "00000000-0000-0000-0000-000000000001",
  },
};

function probe(access: PortalAccess, staffEmails: ReadonlySet<string>) {
  return new Elysia()
    .use(staffAccess(authReturning(access), staffEmails))
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
  it("rejects anonymous requests with 401", async () => {
    const response = await probe({ kind: "anonymous" }, new Set(["staff@offboard.xyz"]));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects sessions that are not a team member with 403", async () => {
    const response = await probe({ kind: "forbidden" }, new Set(["staff@offboard.xyz"]));

    expect(response.status).toBe(403);
  });

  it("rejects talent sessions with 403", async () => {
    const response = await probe(
      { kind: "talent", profile: { id: "t1", name: "Tal", email: "staff@offboard.xyz" } },
      new Set(["staff@offboard.xyz"]),
    );

    expect(response.status).toBe(403);
  });

  it("rejects a customer admin who is not on the allowlist", async () => {
    const response = await probe(member, new Set(["someone-else@offboard.xyz"]));

    expect(response.status).toBe(403);
  });

  it("denies everyone when the allowlist is empty", async () => {
    const response = await probe(member, new Set());

    expect(response.status).toBe(403);
  });

  it("admits an allowlisted member regardless of email case", async () => {
    const response = await probe(member, parseStaffEmails("staff@offboard.xyz"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
