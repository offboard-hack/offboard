import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "../../repositories.js";
import { authRateLimit, authUser, offboardingCases, talentProfiles } from "@offboard/db/schema";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAuth, createRuntimeAuth } from "./auth.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "https://offboard.example";

describe.skipIf(!databaseUrl)("invite-only magic links with PostgreSQL", () => {
  if (!databaseUrl) return;
  const db = createClient(databaseUrl);
  const { team: repos, talent } = createRepositories(db);
  const delivered = new Map<string, string>();

  const auth = createAuth({
    db,
    origin,
    secret: randomUUID() + randomUUID(),
    talent,
    sendLink({ email, url }) {
      delivered.set(email, url);

      return Promise.resolve();
    },
  });

  beforeEach(async () => {
    delivered.clear();

    await db.delete(authRateLimit).where(like(authRateLimit.key, "127.0.0.1|%"));
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$client.end());

  function magicLinkRequest(
    email: string,
    baseUrl: string,
    {
      headers,
      callbackURL = "/desligamentos",
    }: { headers?: HeadersInit; callbackURL?: string } = {},
  ) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("content-type", "application/json");

    if (!requestHeaders.has("origin")) requestHeaders.set("origin", baseUrl);

    return new Request(`${baseUrl}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ email, callbackURL, errorCallbackURL: "/entrar" }),
    });
  }

  function requestLink(email: string, callbackURL?: string, headers?: HeadersInit) {
    return auth.handler(magicLinkRequest(email, origin, { headers, callbackURL }));
  }

  async function enableTalent(email: string) {
    const [offboarding] = await db
      .insert(offboardingCases)
      .values({
        name: "Pessoa desligada",
        role: "Analista",
        department: "RH",
        deadline: "2026-12-31",
      })
      .returning();

    const profile = await talent.enable({
      caseId: offboarding.id,
      personalEmail: email,
      sponsoredUntil: "2026-12-31",
    });

    return z.object({ id: z.uuid(), name: z.string() }).parse(profile);
  }

  async function verify(email: string, useDefaultCallback = false) {
    const deliveredLink = delivered.get(email);
    expect(deliveredLink).toBeDefined();

    if (!deliveredLink) throw new Error("No sign-in link was delivered");

    const url = new URL(deliveredLink);

    if (useDefaultCallback) url.searchParams.set("callbackURL", "");

    return auth.handler(new Request(url));
  }

  function sessionHeaders(response: Response) {
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="));

    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    return new Headers({ cookie: cookie?.split(";")[0] ?? "" });
  }

  it("only sends to invited members and rejects reuse, revoked invitations and revoked sessions", async () => {
    const email = `invite-${randomUUID()}@offboard.example`;
    const member = await repos.createTeamMember({ name: "Pessoa convidada", email, role: "rh" });

    expect(
      (await requestLink(email, undefined, { origin: "https://another.example" })).status,
    ).toBe(403);
    expect((await auth.handler(new Request(`${origin}/api/auth/get-session`))).status).toBe(404);

    const uninvited = await requestLink(`unknown-${randomUUID()}@offboard.example`);
    expect(uninvited.status).toBe(200);
    expect(delivered.size).toBe(0);

    const mixedCase = `INVITE${email.slice(6)}`;
    const invited = await requestLink(mixedCase);
    expect(invited.status).toBe(200);
    expect(await invited.json()).toEqual(await uninvited.json());

    const accepted = await verify(mixedCase);
    expect(accepted.headers.get("location")).toBe(`${origin}/desligamentos`);
    const headers = sessionHeaders(accepted);
    expect(await auth.resolvePrincipal(headers)).toEqual({
      kind: "authenticated",
      principal: member,
    });

    const reused = await verify(mixedCase);
    expect(reused.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(reused.headers.getSetCookie()).toHaveLength(0);

    expect((await requestLink(email)).status).toBe(200);
    expect(await repos.deleteTeamMember(member.id)).toBe(true);
    expect(await auth.resolvePrincipal(headers)).toEqual({ kind: "forbidden" });

    const reinstated = await repos.createTeamMember({
      name: member.name,
      email,
      role: "visualizador",
    });

    expect(await auth.resolvePrincipal(headers)).toEqual({ kind: "forbidden" });
    const obsolete = await verify(email);
    expect(obsolete.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(obsolete.headers.getSetCookie()).toHaveLength(0);

    expect((await requestLink(email)).status).toBe(200);
    const renewed = await verify(email, true);
    expect(renewed.headers.get("location")).toBe(`${origin}/`);
    const renewedHeaders = sessionHeaders(renewed);
    expect(await auth.resolvePrincipal(renewedHeaders)).toEqual({
      kind: "authenticated",
      principal: reinstated,
    });

    await db.update(authUser).set({ emailVerified: false }).where(eq(authUser.email, email));
    expect(await auth.resolvePrincipal(renewedHeaders)).toEqual({ kind: "forbidden" });

    const signOutHeaders = new Headers(renewedHeaders);
    signOutHeaders.set("origin", origin);

    const signOut = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers: signOutHeaders }),
    );

    expect(signOut.status).toBe(200);
    expect(await auth.resolvePrincipal(renewedHeaders)).toEqual({ kind: "anonymous" });
    expect(await repos.deleteTeamMember(reinstated.id)).toBe(true);

    expect((await requestLink(email)).status).toBe(200);

    const rateLimited = await requestLink(email, undefined, { "x-forwarded-for": "192.0.2.53" });
    expect(rateLimited.status).toBe(429);
  });

  it("rejects a malformed link and prevents account creation after first-use revocation", async () => {
    const malformed = await auth.handler(
      new Request(`${origin}/api/auth/magic-link/verify?token=bad`),
    );

    expect(malformed.headers.get("location")).toBe(`${origin}/entrar?error=INVALID_TOKEN`);
    expect(malformed.headers.getSetCookie()).toHaveLength(0);

    const email = `revoked-${randomUUID()}@offboard.example`;
    const member = await repos.createTeamMember({ name: "Pessoa removida", email, role: "rh" });

    expect((await requestLink(email)).status).toBe(200);
    expect(await repos.deleteTeamMember(member.id)).toBe(true);

    const revoked = await verify(email);
    expect(revoked.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(revoked.headers.getSetCookie()).toHaveLength(0);

    const users = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, email));

    expect(users).toHaveLength(0);
  });

  it("signs a talent profile in through the app callback", async () => {
    const email = `talent-${randomUUID()}@offboard.example`;
    const profile = await enableTalent(email);

    expect((await requestLink(email, "/app")).status).toBe(200);
    const token = new URL(delivered.get(email) ?? origin).searchParams.get("token");
    expect(token?.startsWith(`t.${profile.id}.`)).toBe(true);

    const accepted = await verify(email);
    expect(accepted.headers.get("location")).toBe(`${origin}/app`);

    expect(await auth.resolvePrincipal(sessionHeaders(accepted))).toEqual({
      kind: "talent",
      profile: { id: profile.id, name: profile.name, email },
    });

    expect((await talent.findById(profile.id))?.firstSignedInAt).not.toBeNull();
  });

  it("separates audiences for the same email", async () => {
    const email = `both-${randomUUID()}@offboard.example`;
    const member = await repos.createTeamMember({ name: "Pessoa dupla", email, role: "rh" });
    const profile = await enableTalent(email);

    expect((await requestLink(email)).status).toBe(200);
    const portal = await verify(email);
    expect(portal.headers.get("location")).toBe(`${origin}/desligamentos`);

    expect((await requestLink(email, "/app")).status).toBe(200);
    const app = await verify(email);
    expect(app.headers.get("location")).toBe(`${origin}/app`);

    expect(await auth.resolvePrincipal(sessionHeaders(portal))).toEqual({
      kind: "authenticated",
      principal: member,
    });

    expect(await auth.resolvePrincipal(sessionHeaders(app))).toEqual({
      kind: "talent",
      profile: { id: profile.id, name: profile.name, email },
    });

    expect(await repos.deleteTeamMember(member.id)).toBe(true);
  });

  it("does not send app links to unknown or member-only emails", async () => {
    const memberEmail = `member-only-${randomUUID()}@offboard.example`;
    const talentEmail = `talent-only-${randomUUID()}@offboard.example`;

    const member = await repos.createTeamMember({
      name: "Pessoa da equipe",
      email: memberEmail,
      role: "rh",
    });

    await enableTalent(talentEmail);

    const unknown = await requestLink(`unknown-${randomUUID()}@offboard.example`, "/app");
    const memberOnly = await requestLink(memberEmail, "/app");
    const talentOnly = await requestLink(talentEmail);

    expect([unknown.status, memberOnly.status, talentOnly.status]).toEqual([200, 200, 200]);
    const body = await unknown.json();
    expect(await memberOnly.json()).toEqual(body);
    expect(await talentOnly.json()).toEqual(body);

    const unreadable = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(unreadable.status).toBe(400);
    expect(delivered.size).toBe(0);
    expect(await repos.deleteTeamMember(member.id)).toBe(true);
  });

  it("revokes the session when the profile email changes or the profile is deleted", async () => {
    const email = `revoked-talent-${randomUUID()}@offboard.example`;
    const profile = await enableTalent(email);

    expect((await requestLink(email, "/app")).status).toBe(200);
    const link = new URL(delivered.get(email) ?? origin);
    link.searchParams.set("token", link.searchParams.get("token")?.replace(/^t\./, "m.") ?? "");
    const forged = await auth.handler(new Request(link));
    expect(forged.headers.get("location")).toBe(`${origin}/entrar?error=INVALID_TOKEN`);
    expect(forged.headers.getSetCookie()).toHaveLength(0);

    const headers = sessionHeaders(await verify(email));
    expect((await auth.resolvePrincipal(headers)).kind).toBe("talent");

    await db
      .update(talentProfiles)
      .set({ personalEmail: `changed-${randomUUID()}@offboard.example` })
      .where(eq(talentProfiles.id, profile.id));

    expect(await auth.resolvePrincipal(headers)).toEqual({ kind: "forbidden" });

    await db.delete(talentProfiles).where(eq(talentProfiles.id, profile.id));
    expect(await auth.resolvePrincipal(headers)).toEqual({ kind: "anonymous" });
  });

  it("invites a talent profile", async () => {
    const email = `invited-talent-${randomUUID()}@offboard.example`;
    const profile = await enableTalent(email);

    for (let attempt = 0; attempt < 5; attempt++) await auth.inviteTalent(email);

    delivered.clear();
    await auth.inviteTalent(email);
    await auth.inviteTalent(`unknown-${randomUUID()}@offboard.example`);
    expect([...delivered.keys()]).toEqual([email]);

    const invite = new URL(delivered.get(email) ?? origin);
    expect(invite.searchParams.get("callbackURL")).toBe("/app");
    expect(invite.searchParams.get("errorCallbackURL")).toBe("/app/entrar");

    const accepted = await verify(email);
    expect(accepted.headers.get("location")).toBe(`${origin}/app`);

    expect(await auth.resolvePrincipal(sessionHeaders(accepted))).toEqual({
      kind: "talent",
      profile: { id: profile.id, name: profile.name, email },
    });
  });

  it("uses the configured public origin and sends email through Resend", async () => {
    const server = createServer();
    const messages: string[] = [];

    server.on("request", async (request, response) => {
      let body = "";
      request.setEncoding("utf8");

      for await (const chunk of request) body += chunk;

      messages.push(body);
      response.setHeader("content-type", "application/json");

      if (messages.length === 2) {
        response.statusCode = 422;
        response.end(JSON.stringify({ name: "validation_error", message: "Failed to send" }));

        return;
      }

      response.end(JSON.stringify({ id: "test-email" }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = z.object({ port: z.number() }).parse(server.address());

      vi.stubEnv("BETTER_AUTH_URL", undefined);
      vi.stubEnv("BETTER_AUTH_SECRET", randomUUID() + randomUUID());
      vi.stubEnv("AUTH_EMAIL_FROM", "Offboard <auth@offboard.example>");
      vi.stubEnv("RESEND_API_KEY", "test");
      vi.stubEnv("RESEND_BASE_URL", `http://127.0.0.1:${address.port}`);
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("VERCEL_URL", "preview.offboard.example");
      vi.stubEnv("VERCEL", "1");

      const runtime = createRuntimeAuth(db, talent);
      expect(runtime.origin).toBe("https://preview.offboard.example");

      const email = `runtime-${randomUUID()}@offboard.example`;
      const member = await repos.createTeamMember({ name: "Pessoa de teste", email, role: "rh" });

      try {
        const sent = await runtime.auth.handler(magicLinkRequest(email, runtime.origin));
        expect(sent.status).toBe(200);
        expect(messages[0]).toContain(email);
        expect(messages[0]).toContain(`${runtime.origin}/api/auth/magic-link/verify`);

        const rejected = await runtime.auth.handler(magicLinkRequest(email, runtime.origin));
        expect(rejected.status).toBe(500);
      } finally {
        await repos.deleteTeamMember(member.id);
      }

      vi.stubEnv("BETTER_AUTH_URL", "https://portal.offboard.example/");
      expect(createRuntimeAuth(db, talent).origin).toBe("https://portal.offboard.example");

      vi.stubEnv("BETTER_AUTH_URL", "http://insecure.offboard.example");
      expect(() => createRuntimeAuth(db, talent)).toThrow();

      vi.stubEnv("BETTER_AUTH_URL", "https://portal.offboard.example/path");
      expect(() => createRuntimeAuth(db, talent)).toThrow();

      vi.stubEnv("BETTER_AUTH_URL", undefined);
      vi.stubEnv("VERCEL_ENV", "development");
      expect(createRuntimeAuth(db, talent, "http://localhost:5173").origin).toBe(
        "http://localhost:5173",
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
