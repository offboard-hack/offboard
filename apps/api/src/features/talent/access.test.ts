import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";
import type { PortalAccess, PortalAuth } from "../../shared/portal-auth.js";
import { talentAccess } from "./access.js";
import type { TalentProfile } from "./repository.js";

const webOrigin = "https://app.test";
const now = new Date("2026-06-15T12:00:00Z");

const profile: TalentProfile = {
  id: "t1",
  caseId: "c1",
  name: "Ana",
  email: "ana@example.com",
  sponsoredUntil: "2026-12-31",
  termsAcceptedAt: "2026-06-01T00:00:00.000Z",
  firstSignedInAt: "2026-06-01T00:00:00.000Z",
};

function build(options: {
  access?: PortalAccess;
  found?: TalentProfile | undefined;
  companyActive?: boolean;
  handler?: () => void;
  realClock?: boolean;
}) {
  const auth: PortalAuth = {
    handler: async () => new Response(),
    resolvePrincipal: async () =>
      options.access ?? { kind: "talent", profile: { id: "t1", name: "Ana", email: "a@b.c" } },
    inviteTalent: async () => {},
  };

  const handler = options.handler ?? (() => {});

  return new Elysia()
    .use(
      talentAccess({
        auth,
        webOrigin,
        talent: { findById: async () => ("found" in options ? options.found : profile) },
        companyActive: async () => options.companyActive ?? true,
        now: options.realClock ? undefined : () => now,
      }),
    )
    .get(
      "/signed-in",
      ({ me, entitlement }) => {
        handler();

        return { id: me.id, kind: entitlement.kind };
      },
      { talent: "signed-in" },
    )
    .get(
      "/active",
      ({ me, entitlement }) => {
        handler();

        return { id: me.id, kind: entitlement.kind };
      },
      { talent: "active" },
    )
    .post("/active", () => ({ ok: true }), { talent: "active" });
}

describe("talentAccess", () => {
  it("serves sponsored talent and sets no-store", async () => {
    const response = await build({}).handle(new Request("http://localhost/active"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ id: "t1", kind: "sponsored" });
  });

  it("rejects anonymous with 401 without running the handler", async () => {
    const handler = vi.fn();

    const response = await build({ access: { kind: "anonymous" }, handler }).handle(
      new Request("http://localhost/active"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "forbidden" } as const,
    {
      kind: "authenticated",
      principal: { id: "u", name: "U", email: "u@x.y", role: "admin" },
    } satisfies PortalAccess,
  ])("rejects non-talent kind %# with 403", async (access) => {
    const handler = vi.fn();

    const response = await build({ access, handler }).handle(
      new Request("http://localhost/signed-in"),
    );

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a mutation from a foreign origin", async () => {
    const response = await build({}).handle(
      new Request("http://localhost/active", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("allows a mutation from the web origin", async () => {
    const response = await build({}).handle(
      new Request("http://localhost/active", { method: "POST", headers: { origin: webOrigin } }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects when the profile is missing", async () => {
    const handler = vi.fn();

    const response = await build({ found: undefined, handler }).handle(
      new Request("http://localhost/signed-in"),
    );

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("requires accepted terms in active mode", async () => {
    const handler = vi.fn();

    const response = await build({
      found: { ...profile, termsAcceptedAt: null },
      handler,
    }).handle(new Request("http://localhost/active"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Terms not accepted" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 402 for lapsed entitlement in active mode", async () => {
    const handler = vi.fn();

    const response = await build({ companyActive: false, handler }).handle(
      new Request("http://localhost/active"),
    );

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "Access lapsed" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets signed-in mode through for lapsed profiles without terms", async () => {
    const response = await build({
      found: { ...profile, termsAcceptedAt: null },
      companyActive: false,
    }).handle(new Request("http://localhost/signed-in"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "t1", kind: "lapsed" });
  });

  it("uses the real clock by default", async () => {
    const response = await build({
      found: { ...profile, sponsoredUntil: "2999-12-31" },
      realClock: true,
    }).handle(new Request("http://localhost/active"));

    expect(response.status).toBe(200);
  });
});
