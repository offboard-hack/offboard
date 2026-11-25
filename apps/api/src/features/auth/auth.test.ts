import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "../../repositories.js";
import { authRateLimit, authUser, defaultOrgId } from "@offboard/db/schema";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAuth, createRuntimeAuth } from "./auth.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "https://offboard.example";

describe.skipIf(!databaseUrl)("invite-only magic links with PostgreSQL", () => {
  if (!databaseUrl) return;
  const db = createClient(databaseUrl);
  const { team: repos } = createRepositories(db);
  const delivered = new Map<string, string>();

  const auth = createAuth({
    db,
    origin,
    secret: randomUUID() + randomUUID(),
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

  function magicLinkRequest(email: string, baseUrl: string, headers?: HeadersInit) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("content-type", "application/json");

    if (!requestHeaders.has("origin")) requestHeaders.set("origin", baseUrl);

    return new Request(`${baseUrl}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ email, callbackURL: "/desligamentos", errorCallbackURL: "/entrar" }),
    });
  }

  function requestLink(email: string, headers?: HeadersInit) {
    return auth.handler(magicLinkRequest(email, origin, headers));
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

    const member = await repos.createTeamMember(defaultOrgId, {
      name: "Pessoa convidada",
      email,
      role: "rh",
    });

    expect((await requestLink(email, { origin: "https://another.example" })).status).toBe(403);
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
      principal: { ...member, orgId: defaultOrgId },
    });

    const reused = await verify(mixedCase);
    expect(reused.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(reused.headers.getSetCookie()).toHaveLength(0);

    expect((await requestLink(email)).status).toBe(200);
    expect(await repos.deleteTeamMember(defaultOrgId, member.id)).toBe(true);
    expect(await auth.resolvePrincipal(headers)).toEqual({ kind: "forbidden" });

    const reinstated = await repos.createTeamMember(defaultOrgId, {
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
      principal: { ...reinstated, orgId: defaultOrgId },
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
    expect(await repos.deleteTeamMember(defaultOrgId, reinstated.id)).toBe(true);

    expect((await requestLink(email)).status).toBe(200);

    const rateLimited = await requestLink(email, { "x-forwarded-for": "192.0.2.53" });
    expect(rateLimited.status).toBe(429);
  });

  it("rejects a malformed link and prevents account creation after first-use revocation", async () => {
    const malformed = await auth.handler(
      new Request(`${origin}/api/auth/magic-link/verify?token=bad`),
    );

    expect(malformed.headers.get("location")).toBe(`${origin}/entrar?error=INVALID_TOKEN`);
    expect(malformed.headers.getSetCookie()).toHaveLength(0);

    const email = `revoked-${randomUUID()}@offboard.example`;

    const member = await repos.createTeamMember(defaultOrgId, {
      name: "Pessoa removida",
      email,
      role: "rh",
    });

    expect((await requestLink(email)).status).toBe(200);
    expect(await repos.deleteTeamMember(defaultOrgId, member.id)).toBe(true);

    const revoked = await verify(email);
    expect(revoked.headers.get("location")).toMatch(/\/entrar\?error=/);
    expect(revoked.headers.getSetCookie()).toHaveLength(0);

    const users = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, email));

    expect(users).toHaveLength(0);
  });

  it("confirms a deferred magic link request before the provider finishes sending", async () => {
    const email = `worker-${randomUUID()}@offboard.example`;

    const member = await repos.createTeamMember(defaultOrgId, {
      name: "Pessoa de teste",
      email,
      role: "rh",
    });

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

      const runtime = createRuntimeAuth(db, undefined, {
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
      await repos.deleteTeamMember(defaultOrgId, member.id);
    }
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

      const runtime = createRuntimeAuth(db);
      expect(runtime.origin).toBe("https://preview.offboard.example");

      const email = `runtime-${randomUUID()}@offboard.example`;

      const member = await repos.createTeamMember(defaultOrgId, {
        name: "Pessoa de teste",
        email,
        role: "rh",
      });

      try {
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
      } finally {
        await repos.deleteTeamMember(defaultOrgId, member.id);
      }

      vi.stubEnv("BETTER_AUTH_URL", "https://portal.offboard.example/");
      expect(createRuntimeAuth(db).origin).toBe("https://portal.offboard.example");

      vi.stubEnv("BETTER_AUTH_URL", "http://insecure.offboard.example");
      expect(() => createRuntimeAuth(db)).toThrow();

      vi.stubEnv("BETTER_AUTH_URL", "https://portal.offboard.example/path");
      expect(() => createRuntimeAuth(db)).toThrow();

      vi.stubEnv("BETTER_AUTH_URL", undefined);
      vi.stubEnv("VERCEL_ENV", "development");
      expect(createRuntimeAuth(db, "http://localhost:5173").origin).toBe("http://localhost:5173");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
