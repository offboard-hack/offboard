import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";
import type { EmployeePrincipal } from "./employee-auth.js";
import type { IndividualPlan } from "./entitlement.js";
import type { PortalAccess, PortalAuth } from "./portal-auth.js";
import { talentAccess } from "./talent-access.js";
import type { TalentProfile } from "./talent-profile.js";

const webOrigin = "https://app.test";
const now = new Date("2026-06-15T12:00:00Z");
const sponsorLookups: string[] = [];

const profile: TalentProfile = {
  id: "t1",
  orgId: "00000000-0000-4000-8000-0000000000a1",
  caseId: "c1",
  name: "Ana",
  email: "ana@example.com",
  sponsoredUntil: "2026-12-31",
  termsAcceptedAt: "2026-06-01T00:00:00.000Z",
  firstSignedInAt: "2026-06-01T00:00:00.000Z",
  shareOutcomeWithHr: false,
  aiApplyConsentAt: null,
  aiApplyConsentVersion: null,
  searchableAt: null,
};

const collaborator: EmployeePrincipal = {
  id: "u1",
  caseId: "c9",
  grantId: "g1",
  name: "Bia",
  email: "bia@example.com",
};

const collaboratorProfile: TalentProfile = {
  ...profile,
  id: "t9",
  caseId: "c9",
  name: "Bia",
  email: "bia@example.com",
  sponsoredUntil: "2020-01-01",
  termsAcceptedAt: null,
};

function build(options: {
  access?: PortalAccess;
  found?: TalentProfile | undefined;
  companyActive?: boolean;
  individual?: IndividualPlan;
  benefit?: { aiApplyDailyLimit: number; validUntil: string } | null;
  handler?: () => void;
  realClock?: boolean;
  employee?: () => Promise<EmployeePrincipal | null>;
  ensured?: TalentProfile | "email_taken";
  ensure?: (principal: { caseId: string; name: string; email: string }, at: Date) => void;
  bridged?: (me: TalentProfile, caseId: string, at: Date) => void;
}) {
  const auth: PortalAuth = {
    handler: async () => new Response(),
    resolvePrincipal: async () =>
      options.access ?? { kind: "talent", profile: { id: "t1", name: "Ana", email: "a@b.c" } },
    resolveEmployee: options.employee,
  };

  const handler = options.handler ?? (() => {});

  return new Elysia()
    .use(
      talentAccess({
        auth,
        webOrigin,
        talent: {
          findById: async () => ("found" in options ? options.found : profile),
          ensureForCollaborator: async (principal, at) => {
            options.ensure?.(principal, at);

            return options.ensured ?? collaboratorProfile;
          },
        },
        companyActive: async (orgId) => {
          sponsorLookups.push(orgId);

          return options.companyActive ?? true;
        },
        individualPlan: async () => options.individual ?? null,
        collaboratorBridged: options.bridged
          ? async (me, caseId, at) => options.bridged?.(me, caseId, at)
          : undefined,
        benefitPlan: "benefit" in options ? async () => options.benefit ?? null : undefined,
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
    .get("/entitlement", ({ entitlement }) => entitlement, { talent: "active" })
    .post("/active", () => ({ ok: true }), { talent: "active" });
}

describe("talentAccess", () => {
  it("serves sponsored talent and sets no-store", async () => {
    const response = await build({}).handle(new Request("http://localhost/active"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ id: "t1", kind: "sponsored" });
    expect(sponsorLookups.at(-1)).toBe(profile.orgId);
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

  it("rejects a member session with 403", async () => {
    const handler = vi.fn();

    const response = await build({
      access: {
        kind: "authenticated",
        principal: {
          id: "u",
          name: "U",
          email: "u@x.y",
          role: "admin",
          orgId: "00000000-0000-4000-8000-0000000000a1",
        },
      },
      handler,
    }).handle(new Request("http://localhost/signed-in"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("sends a session without a member, talent or collaborator principal back to sign-in", async () => {
    const handler = vi.fn();

    const response = await build({ access: { kind: "forbidden" }, handler }).handle(
      new Request("http://localhost/signed-in"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
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

  it("lets an active Carreira Pro keep access once the company sponsorship lapses", async () => {
    const until = await build({
      companyActive: false,
      individual: { status: "active", currentPeriodEnd: "2026-06-15" },
    }).handle(new Request("http://localhost/entitlement"));

    expect(until.status).toBe(200);
    expect(await until.json()).toEqual({ kind: "individual", until: "2026-06-15" });

    const open = await build({
      companyActive: false,
      individual: { status: "active", currentPeriodEnd: null },
    }).handle(new Request("http://localhost/entitlement"));

    expect(await open.json()).toEqual({ kind: "individual", until: null });
  });

  it("lets a benefit tier with AI Apply keep access once the company sponsorship lapses", async () => {
    const granted = await build({
      companyActive: false,
      benefit: { aiApplyDailyLimit: 3, validUntil: "2026-06-15" },
    }).handle(new Request("http://localhost/entitlement"));

    expect(await granted.json()).toEqual({ kind: "sponsored", until: "2026-06-15" });
  });

  it("falls back to Carreira Pro when the benefit is expired, empty or absent", async () => {
    const individual = { status: "active", currentPeriodEnd: null } as const;

    for (const benefit of [
      { aiApplyDailyLimit: 3, validUntil: "2026-06-14" },
      { aiApplyDailyLimit: 0, validUntil: "2099-01-01" },
      null,
    ]) {
      const response = await build({ companyActive: false, individual, benefit }).handle(
        new Request("http://localhost/entitlement"),
      );

      expect(await response.json()).toEqual({ kind: "individual", until: null });
    }

    const lapsed = await build({
      companyActive: false,
      benefit: { aiApplyDailyLimit: 3, validUntil: "2026-06-14" },
    }).handle(new Request("http://localhost/active"));

    expect(lapsed.status).toBe(402);
  });

  it("does not consult the benefit while the company sponsors", async () => {
    const benefitPlan = vi.fn();

    const response = await new Elysia()
      .use(
        talentAccess({
          auth: {
            handler: async () => new Response(),
            resolvePrincipal: async () => ({
              kind: "talent",
              profile: { id: "t1", name: "Ana", email: "a@b.c" },
            }),
          },
          webOrigin,
          talent: { findById: async () => profile, ensureForCollaborator: async () => profile },
          companyActive: async () => true,
          individualPlan: async () => null,
          benefitPlan,
          now: () => now,
        }),
      )
      .get("/e", ({ entitlement }) => entitlement, { talent: "active" })
      .handle(new Request("http://localhost/e"));

    expect((await response.json()).kind).toBe("sponsored");
    expect(benefitPlan).not.toHaveBeenCalled();
  });

  it("answers 402 once the Carreira Pro is canceled or its period ended", async () => {
    const statuses = [
      (
        await build({
          companyActive: false,
          individual: { status: "canceled", currentPeriodEnd: "2099-01-01" },
        }).handle(new Request("http://localhost/active"))
      ).status,
      (
        await build({
          companyActive: false,
          individual: { status: "active", currentPeriodEnd: "2026-06-14" },
        }).handle(new Request("http://localhost/active"))
      ).status,
    ];

    expect(statuses).toEqual([402, 402]);
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

  it("serves a collaborator session as always active on its case profile", async () => {
    const ensure = vi.fn();

    const app = build({
      access: { kind: "forbidden" },
      employee: async () => collaborator,
      companyActive: false,
      ensure,
    });

    const active = await app.handle(new Request("http://localhost/active"));

    expect(active.status).toBe(200);
    expect(active.headers.get("cache-control")).toBe("no-store");
    expect(await active.json()).toEqual({ id: "t9", kind: "sponsored" });
    expect(ensure).toHaveBeenCalledWith(collaborator, now);

    const entitlement = await app.handle(new Request("http://localhost/entitlement"));

    expect(await entitlement.json()).toEqual({ kind: "sponsored", until: null });
  });

  it("hands the bridged profile over before the first career request is served", async () => {
    const bridged: string[] = [];

    const response = await build({
      access: { kind: "forbidden" },
      employee: async () => collaborator,
      bridged: (me, caseId, at) => bridged.push(`${me.id}:${caseId}:${at.toISOString()}`),
    }).handle(new Request("http://localhost/active"));

    expect(response.status).toBe(200);
    expect(bridged).toEqual([`t9:c9:${now.toISOString()}`]);
  });

  it("does not hand over a collaborator whose email is taken", async () => {
    const bridged: string[] = [];

    await build({
      access: { kind: "forbidden" },
      employee: async () => collaborator,
      ensured: "email_taken",
      bridged: (me) => bridged.push(me.id),
    }).handle(new Request("http://localhost/active"));

    expect(bridged).toEqual([]);
  });

  it("rejects a collaborator whose email belongs to another profile", async () => {
    const handler = vi.fn();

    const response = await build({
      access: { kind: "forbidden" },
      employee: async () => collaborator,
      ensured: "email_taken",
      handler,
    }).handle(new Request("http://localhost/signed-in"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Email already in use" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("checks the origin of collaborator writes before creating a profile", async () => {
    const ensure = vi.fn();

    const app = build({
      access: { kind: "forbidden" },
      employee: async () => collaborator,
      ensure,
    });

    const foreign = await app.handle(
      new Request("http://localhost/active", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
    );

    expect(foreign.status).toBe(403);
    expect(ensure).not.toHaveBeenCalled();

    const own = await app.handle(
      new Request("http://localhost/active", { method: "POST", headers: { origin: webOrigin } }),
    );

    expect(own.status).toBe(200);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("sends a collaborator whose grant no longer resolves back to sign-in", async () => {
    const ensure = vi.fn();

    const response = await build({
      access: { kind: "forbidden" },
      employee: async () => null,
      ensure,
    }).handle(new Request("http://localhost/signed-in"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(ensure).not.toHaveBeenCalled();
  });

  const hr: PortalAccess = {
    kind: "authenticated",
    principal: {
      id: "u",
      name: "U",
      email: "u@x.y",
      role: "admin",
      orgId: "00000000-0000-4000-8000-0000000000a1",
    },
  };

  it.each([{ kind: "anonymous" }, hr] satisfies PortalAccess[])(
    "serves the collaborator session next to a $kind portal session",
    async (access) => {
      const response = await build({ access, employee: async () => collaborator }).handle(
        new Request("http://localhost/signed-in"),
      );

      expect(response.status).toBe(200);
    },
  );

  it.each([
    { access: { kind: "anonymous" }, status: 401 },
    { access: hr, status: 403 },
  ] satisfies { access: PortalAccess; status: number }[])(
    "answers $status to a $access.kind session without a collaborator session",
    async ({ access, status }) => {
      const response = await build({ access, employee: async () => null }).handle(
        new Request("http://localhost/signed-in"),
      );

      expect(response.status).toBe(status);
    },
  );
});
