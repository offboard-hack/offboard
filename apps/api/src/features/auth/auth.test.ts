import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "../../repositories.js";
import {
  authRateLimit,
  authUser,
  defaultOrgId,
  offboardingCases,
  talentProfiles,
} from "@offboard/db/schema";
import { eq, like, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { codeAudienceHeader, createAuth, createRuntimeAuth } from "./auth.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "https://offboard.example";

describe.skipIf(!databaseUrl)("invite-only sign-in with PostgreSQL", () => {
  if (!databaseUrl) return;
  const db = createClient(databaseUrl);
  const { team: repos, talent, account } = createRepositories(db);
  const delivered = new Map<string, string>();
  const codes = new Map<string, string>();

  const auth = createAuth({
    db,
    origin,
    staffEmails: new Set(),
    secret: randomUUID() + randomUUID(),
    talent,
    sendLink({ email, url }) {
      delivered.set(email, url);

      return Promise.resolve();
    },
    sendCode({ email, code }) {
      codes.set(email, code);

      return Promise.resolve();
    },
  });

  beforeEach(async () => {
    delivered.clear();
    codes.clear();

    await db.delete(authRateLimit).where(like(authRateLimit.key, "127.0.0.1|%"));
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$client.end());

  function magicLinkRequest(
    email: string,
    baseUrl: string,
    { headers, callbackURL = "/app" }: { headers?: HeadersInit; callbackURL?: string } = {},
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
      orgId: defaultOrgId,
      caseId: offboarding.id,
      personalEmail: email,
      sponsoredUntil: "2026-12-31",
    });

    return {
      ...z.object({ id: z.uuid(), name: z.string() }).parse(profile),
      caseId: offboarding.id,
    };
  }

  async function verify(email: string, useDefaultCallback = false) {
    const deliveredLink = delivered.get(email);
    expect(deliveredLink).toBeDefined();

    if (!deliveredLink) throw new Error("No sign-in link was delivered");

    const url = new URL(deliveredLink);

    if (useDefaultCallback) url.searchParams.set("callbackURL", "");

    return auth.handler(new Request(url));
  }

  function memberCodeRequest(
    path: string,
    body: { email: string; type: "sign-in" } | { email: string; otp?: string },
  ) {
    return auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", [codeAudienceHeader]: "member" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function memberSession(email: string) {
    expect(
      (await memberCodeRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }))
        .status,
    ).toBe(200);

    return sessionHeaders(
      await memberCodeRequest("/sign-in/email-otp", { email, otp: codes.get(email) }),
    );
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

  it("sends app links only to enabled profiles and rejects reuse and revoked sessions", async () => {
    const email = `invite-${randomUUID()}@offboard.example`;
    const profile = await enableTalent(email);

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
    expect(accepted.headers.get("location")).toBe(`${origin}/app`);
    const principal = { kind: "talent", profile: { id: profile.id, name: profile.name, email } };
    expect(await auth.resolvePrincipal(sessionHeaders(accepted))).toEqual(principal);

    const reused = await verify(mixedCase);
    expect(reused.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(reused.headers.getSetCookie()).toHaveLength(0);

    expect((await requestLink(email)).status).toBe(200);
    const renewed = await verify(email, true);
    expect(renewed.headers.get("location")).toBe(`${origin}/`);
    const renewedHeaders = sessionHeaders(renewed);
    expect(await auth.resolvePrincipal(renewedHeaders)).toEqual(principal);

    await db.update(authUser).set({ emailVerified: false }).where(eq(authUser.email, email));
    expect(await auth.resolvePrincipal(renewedHeaders)).toEqual({ kind: "forbidden" });

    const signOutHeaders = new Headers(renewedHeaders);
    signOutHeaders.set("origin", origin);

    const signOut = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers: signOutHeaders }),
    );

    expect(signOut.status).toBe(200);
    expect(await auth.resolvePrincipal(renewedHeaders)).toEqual({ kind: "anonymous" });

    expect((await requestLink(email)).status).toBe(200);
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
    const profile = await enableTalent(email);

    expect((await requestLink(email)).status).toBe(200);
    await db.delete(talentProfiles).where(eq(talentProfiles.id, profile.id));

    const revoked = await verify(email);
    expect(revoked.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(revoked.headers.getSetCookie()).toHaveLength(0);

    const users = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, email));

    expect(users).toHaveLength(0);
  });

  it("refuses a pending link for a returning user whose profile changed", async () => {
    const email = `returning-${randomUUID()}@offboard.example`;
    const profile = await enableTalent(email);

    expect((await requestLink(email)).status).toBe(200);
    sessionHeaders(await verify(email));

    expect((await requestLink(email)).status).toBe(200);

    await db
      .update(talentProfiles)
      .set({ personalEmail: `moved-${randomUUID()}@offboard.example` })
      .where(eq(talentProfiles.id, profile.id));

    const refused = await verify(email);
    expect(refused.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(refused.headers.getSetCookie()).toHaveLength(0);
  });

  it("confirms a deferred magic link request before the provider finishes sending", async () => {
    const email = `worker-${randomUUID()}@offboard.example`;
    await enableTalent(email);

    const background: Promise<void>[] = [];
    const messages: string[] = [];
    let finishDelivery = () => {};

    const pendingDelivery = new Promise<void>((resolve) => {
      finishDelivery = resolve;
    });

    const server = createServer(async (request, response) => {
      let body = "";
      request.setEncoding("utf8");

      for await (const chunk of request) body += chunk;

      messages.push(body);
      response.setHeader("content-type", "application/json");

      if (messages.length === 1) {
        await pendingDelivery;
        response.end(JSON.stringify({ id: "test-email" }));
      } else {
        response.statusCode = 422;
        response.end(JSON.stringify({ name: "validation_error", message: "Failed to send" }));
      }
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const log = vi.spyOn(console, "error");
    const deadline = new AbortController();

    try {
      const { port } = z.object({ port: z.number() }).parse(server.address());

      vi.stubEnv("RESEND_BASE_URL", `http://127.0.0.1:${port}`);

      const runtime = createRuntimeAuth(db, talent, undefined, {
        env: {
          BETTER_AUTH_URL: origin,
          BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
          EMAIL_PROVIDER: "resend",
          AUTH_EMAIL_FROM: "offboard@offboard.example",
          RESEND_API_KEY: "test",
        },
        deferMagicLinkDelivery(delivery) {
          background.push(delivery);
        },
      });

      try {
        const response = await Promise.race([
          runtime.auth.handler(magicLinkRequest(email, origin)),
          delay(2_000, null, { signal: deadline.signal }),
        ]);

        expect(response?.status).toBe(200);
      } finally {
        deadline.abort();
        finishDelivery();
      }

      expect(background).toHaveLength(1);

      await Promise.all(background);
      expect(log).not.toHaveBeenCalled();
      expect(JSON.parse(messages[0])).toEqual(
        expect.objectContaining({ to: email, subject: "Seu link de acesso ao Offboard" }),
      );

      const failed = await runtime.auth.handler(magicLinkRequest(email, origin));

      expect(failed.status).toBe(200);
      expect(background).toHaveLength(2);

      await Promise.all(background);
      expect(log).toHaveBeenCalledExactlyOnceWith({ event: "auth.magic_link_delivery_failed" });
    } finally {
      finishDelivery();
      log.mockRestore();

      await Promise.allSettled(background);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

  it("refuses the session when the identity is no longer verified", async () => {
    const email = `unverified-${randomUUID()}@offboard.example`;
    const trigger = `unverify_${randomUUID().replaceAll("-", "")}`;

    await enableTalent(email);
    await db.insert(authUser).values({ id: `user-${trigger}`, name: "Pessoa", email });
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.email_verified := false; RETURN NEW; END $$`,
      ),
    );
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${trigger} BEFORE UPDATE ON auth_user FOR EACH ROW WHEN (NEW.email = '${email}') EXECUTE FUNCTION ${trigger}()`,
      ),
    );

    try {
      expect((await requestLink(email)).status).toBe(200);

      const refused = await verify(email);

      expect(refused.headers.get("location")).toMatch(/error=/);
      expect(refused.headers.getSetCookie()).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER ${trigger} ON auth_user`));
      await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`));
      await db.delete(authUser).where(eq(authUser.email, email));
    }
  });

  it("separates audiences for the same email", async () => {
    const email = `both-${randomUUID()}@offboard.example`;

    const member = await repos.createTeamMember(defaultOrgId, {
      name: "Pessoa dupla",
      email,
      role: "rh",
    });

    const profile = await enableTalent(email);

    expect((await requestLink(email, "/desligamentos")).status).toBe(404);
    expect(delivered.size).toBe(0);

    const portal = await memberSession(email);

    expect((await requestLink(email)).status).toBe(200);
    expect(delivered.get(email)).toContain(`token=t.${profile.id}.`);
    const app = await verify(email);
    expect(app.headers.get("location")).toBe(`${origin}/app`);

    expect(await auth.resolvePrincipal(portal)).toEqual({
      kind: "authenticated",
      principal: { ...member, orgId: defaultOrgId },
    });

    expect(await auth.resolvePrincipal(sessionHeaders(app))).toEqual({
      kind: "talent",
      profile: { id: profile.id, name: profile.name, email },
    });

    expect(await repos.deleteTeamMember(defaultOrgId, member.id)).toBe(true);
  });

  it("sends no link to unknown or member-only emails and refuses portal links", async () => {
    const memberEmail = `member-only-${randomUUID()}@offboard.example`;
    const talentEmail = `talent-only-${randomUUID()}@offboard.example`;

    const member = await repos.createTeamMember(defaultOrgId, {
      name: "Pessoa da equipe",
      email: memberEmail,
      role: "rh",
    });

    await enableTalent(talentEmail);

    const unknown = await requestLink(`unknown-${randomUUID()}@offboard.example`);
    const memberOnly = await requestLink(memberEmail);
    const portal = await requestLink(talentEmail, "/desligamentos");
    const outsideApp = await requestLink(talentEmail, "/apple");

    expect([unknown.status, memberOnly.status, portal.status, outsideApp.status]).toEqual([
      200, 200, 404, 404,
    ]);
    expect(await memberOnly.json()).toEqual(await unknown.json());

    const unreadable = await auth.handler(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(unreadable.status).toBe(404);
    expect(delivered.size).toBe(0);
    expect(await repos.deleteTeamMember(defaultOrgId, member.id)).toBe(true);
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

  it("removes the talent identity on account deletion and signs in again after re-enabling", async () => {
    const email = `deleted-talent-${randomUUID()}@offboard.example`;
    const profile = await enableTalent(email);

    expect((await requestLink(email, "/app")).status).toBe(200);
    const headers = sessionHeaders(await verify(email));
    expect((await auth.resolvePrincipal(headers)).kind).toBe("talent");

    expect(await account.deleteProfile(profile.id)).toBe(true);
    expect(await db.select().from(authUser).where(eq(authUser.email, email))).toEqual([]);
    expect(await auth.resolvePrincipal(headers)).toEqual({ kind: "anonymous" });

    const again = z.object({ id: z.uuid(), name: z.string() }).parse(
      await talent.enable({
        orgId: defaultOrgId,
        caseId: profile.caseId,
        personalEmail: email,
        sponsoredUntil: "2026-12-31",
      }),
    );

    delivered.clear();
    expect((await requestLink(email, "/app")).status).toBe(200);

    expect(await auth.resolvePrincipal(sessionHeaders(await verify(email)))).toEqual({
      kind: "talent",
      profile: { id: again.id, name: again.name, email },
    });
  });

  it("keeps the portal identity when a team member's talent account is deleted", async () => {
    const email = `member-talent-${randomUUID()}@offboard.example`;

    const member = await repos.createTeamMember(defaultOrgId, {
      name: "Pessoa dupla",
      email,
      role: "rh",
    });

    const profile = await enableTalent(email);

    const portal = await memberSession(email);

    expect((await requestLink(email)).status).toBe(200);
    const app = sessionHeaders(await verify(email));

    expect(await account.deleteProfile(profile.id)).toBe(true);

    expect(await auth.resolvePrincipal(portal)).toEqual({
      kind: "authenticated",
      principal: { ...member, orgId: defaultOrgId },
    });
    expect(await auth.resolvePrincipal(app)).toEqual({ kind: "anonymous" });

    expect(await auth.resolvePrincipal(await memberSession(email))).toEqual({
      kind: "authenticated",
      principal: { ...member, orgId: defaultOrgId },
    });

    expect(await repos.deleteTeamMember(defaultOrgId, member.id)).toBe(true);
  });

  it("signs an allowlisted staff email in with a code and nobody else", async () => {
    const staffEmail = `staff-${randomUUID()}@offboard.example`;
    const outsider = `outsider-${randomUUID()}@offboard.example`;

    const sharedSecret = randomUUID() + randomUUID();

    const staffAuth = createAuth({
      db,
      origin,
      secret: sharedSecret,
      talent,
      staffEmails: new Set([staffEmail]),
      sendLink() {
        return Promise.resolve();
      },
      sendCode({ email, code }) {
        codes.set(email, code);

        return Promise.resolve();
      },
    });

    const staffRequest = (path: string, body: { email: string; type?: "sign-in"; otp?: string }) =>
      staffAuth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method: "POST",
          headers: { origin, "content-type": "application/json", [codeAudienceHeader]: "staff" },
          body: JSON.stringify(body),
        }),
      );

    await staffRequest("/email-otp/send-verification-otp", { email: outsider, type: "sign-in" });
    expect(codes.has(outsider)).toBe(false);

    expect(
      (
        await staffRequest("/email-otp/send-verification-otp", {
          email: staffEmail,
          type: "sign-in",
        })
      ).status,
    ).toBe(200);

    const headers = sessionHeaders(
      await staffRequest("/sign-in/email-otp", { email: staffEmail, otp: codes.get(staffEmail) }),
    );

    expect(await staffAuth.resolvePrincipal(headers)).toEqual({ kind: "staff", email: staffEmail });

    const revokedAuth = createAuth({
      db,
      origin,
      secret: sharedSecret,
      talent,
      staffEmails: new Set(),
      sendLink() {
        return Promise.resolve();
      },
    });

    expect(await revokedAuth.resolvePrincipal(headers)).toEqual({ kind: "forbidden" });
  });

  it("accepts the backoffice origin only for staff code sign-in and sign-out", async () => {
    const staffEmail = `staff-${randomUUID()}@offboard.example`;
    const backofficeOrigin = "https://backoffice.offboard.example";

    const backofficeAuth = createAuth({
      db,
      origin,
      backofficeOrigin,
      secret: randomUUID() + randomUUID(),
      talent,
      staffEmails: new Set([staffEmail]),
      sendLink() {
        return Promise.resolve();
      },
      sendCode({ email, code }) {
        codes.set(email, code);

        return Promise.resolve();
      },
    });

    const fromBackoffice = (
      path: string,
      audience: string | undefined,
      body: Record<string, string | undefined> = { email: staffEmail, type: "sign-in" },
      cookies?: Headers,
    ) => {
      const headers = new Headers(cookies);
      headers.set("origin", backofficeOrigin);
      headers.set("content-type", "application/json");

      if (audience) headers.set(codeAudienceHeader, audience);

      return backofficeAuth.handler(
        new Request(`${backofficeOrigin}/api/auth${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
    };

    for (const audience of ["member", "employee", undefined]) {
      expect((await fromBackoffice("/email-otp/send-verification-otp", audience)).status).toBe(403);
    }

    expect(
      (await fromBackoffice("/sign-in/magic-link", "staff", { email: staffEmail })).status,
    ).toBe(403);

    expect((await fromBackoffice("/email-otp/send-verification-otp", "staff")).status).toBe(200);

    const signedIn = await fromBackoffice("/sign-in/email-otp", "staff", {
      email: staffEmail,
      otp: codes.get(staffEmail),
    });

    expect(signedIn.status).toBe(200);

    const cookie = signedIn.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="));

    expect(cookie).toContain("offboard-staff.session_token=");
    expect(cookie).not.toContain("Domain=");

    const headers = sessionHeaders(signedIn);

    expect(await backofficeAuth.resolvePrincipal(headers)).toEqual({
      kind: "staff",
      email: staffEmail,
    });

    expect((await fromBackoffice("/sign-out", "staff", {}, headers)).status).toBe(200);
    expect(await backofficeAuth.resolvePrincipal(headers)).toEqual({ kind: "anonymous" });

    const runtime = createRuntimeAuth(db, talent, undefined, {
      env: {
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
        BACKOFFICE_ORIGIN: backofficeOrigin,
        EMAIL_PROVIDER: "resend",
        AUTH_EMAIL_FROM: "offboard@offboard.example",
        RESEND_API_KEY: "test",
      },
    });

    const rejected = await runtime.auth.handler(
      new Request(`${backofficeOrigin}/api/auth/email-otp/send-verification-otp`, {
        method: "POST",
        headers: { origin: backofficeOrigin, [codeAudienceHeader]: "member" },
      }),
    );

    expect(rejected.status).toBe(403);

    expect(() =>
      createRuntimeAuth(db, talent, undefined, {
        env: {
          BETTER_AUTH_URL: origin,
          BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
          BACKOFFICE_ORIGIN: "http://backoffice.offboard.example",
        },
      }),
    ).toThrow();
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
      await enableTalent(email);

      const sent = await runtime.auth.handler(magicLinkRequest(email, runtime.origin));
      expect(sent.status).toBe(200);

      const message = z
        .object({ to: z.string(), subject: z.string(), text: z.string(), html: z.string() })
        .parse(JSON.parse(messages[0]));

      const link = z.url().parse(message.text.split("\n\n")[2]);
      const { origin: linkOrigin, pathname } = new URL(link);
      const href = `href="${link.replaceAll("&", "&amp;")}"`;

      expect(message.to).toBe(email);
      expect(message.subject).toBe("Seu link de acesso ao Offboard");
      expect(linkOrigin + pathname).toBe(`${runtime.origin}/api/auth/magic-link/verify`);
      expect(message.html.match(/href="[^"]+"/g)).toEqual([href, href]);
      expect(message.html).toContain(`src="${runtime.origin}/apple-touch-icon.png"`);

      const rejected = await runtime.auth.handler(magicLinkRequest(email, runtime.origin));
      expect(rejected.status).toBe(500);

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
