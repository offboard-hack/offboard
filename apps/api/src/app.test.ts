import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "./repositories.js";
import type { ConfigValue } from "@offboard/db/schema";
import { jobs, tasks } from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { jobDraftSchema } from "./features/jobs/extract.js";
import type { GenerateStructured } from "./shared/ai.js";
import type { FetchPageResult } from "./shared/page-text.js";
import type { PortalAuth } from "./shared/portal-auth.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const cronSecret = "test-cron-secret";
const webhookSecret = "test-webhook-secret";
const slackSigningSecret = "test-slack-secret";

const invitedEmails: string[] = [];
const sentTexts: string[] = [];
const inviteFailures = { remaining: 0 };

function sendEmail(message: { to: string; text: string }) {
  if (inviteFailures.remaining > 0) {
    inviteFailures.remaining -= 1;

    return Promise.reject(new Error("invite failed"));
  }

  invitedEmails.push(message.to);
  sentTexts.push(message.text);

  return Promise.resolve();
}

const auth: PortalAuth = {
  async handler(request) {
    const payload = request.method === "POST" ? await request.text() : null;

    return Response.json({ path: new URL(request.url).pathname, payload });
  },
  resolvePrincipal(headers) {
    const session = headers.get("x-test-session");

    if (session === "anonymous") return Promise.resolve({ kind: "anonymous" });

    if (session === "revoked") return Promise.resolve({ kind: "forbidden" });

    if (session === "talent") {
      return Promise.resolve({
        kind: "talent",
        profile: {
          id: headers.get("x-test-talent-id") ?? "test-talent",
          name: "Test Talent",
          email: "talent@example.com",
        },
      });
    }

    const role =
      session === "rh" || session === "gestor" || session === "visualizador" ? session : "admin";

    return Promise.resolve({
      kind: "authenticated",
      principal: { id: "test-member", name: "Test Member", email: "member@example.com", role },
    });
  },
};

const appOptions = { auth, sendEmail, cronSecret, webhookSecret, slackSigningSecret };

const missingTaskId = "00000000-0000-4000-8000-000000000000";
const missingCaseId = "00000000-0000-4000-8000-000000000001";

type SurveyPayload = {
  caseId: string;
  npsScore: number;
  responses: Record<string, boolean>;
  topics: string[];
};

describe.skipIf(!url)("api", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  let correiosBody = "";
  let correiosStatus = 200;

  const correiosServer = createServer((_req, res) => {
    res.writeHead(correiosStatus, { "content-type": "application/json" });
    res.end(correiosBody);
  });

  let correiosBaseUrl: string;

  const app = createApp(webOrigin, repos, appOptions);

  type Payload = {
    name?: string;
    email?: string;
    role?: string;
    department?: string;
    deadline?: string;
    status?: string;
    rows?: { name: string; department?: string }[];
    actionId?: string;
    enabled?: boolean;
    config?: Record<string, ConfigValue>;
    phase?: string;
    event?: string | { type: string; user?: string };
    payload?: unknown;
    type?: string;
    challenge?: string;
    token?: string;
    team_id?: string;
    api_app_id?: string;
    event_id?: string;
    event_time?: number;
    personalEmail?: string;
    sponsoredUntil?: string;
  };

  function call(path: string, method = "GET", body?: Payload) {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const headers = new Headers({ "content-type": "application/json", origin: webOrigin });

    if (path.startsWith("/webhooks/inbound/")) {
      headers.set("authorization", `Bearer ${webhookSecret}`);
    }

    if (path === "/integrations/slack/events") {
      return app.handle(slackRequest(encoded ?? ""));
    }

    return app.handle(
      new Request(`http://localhost/api${path}`, { method, headers, body: encoded }),
    );
  }

  function slackRequest(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
    const signature = createHmac("sha256", slackSigningSecret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex");

    return new Request("http://localhost/api/integrations/slack/events", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": `v0=${signature}`,
      },
    });
  }

  function cronRequest(method = "GET") {
    return new Request("http://localhost/api/correios/check", {
      method,
      headers: { authorization: `Bearer ${cronSecret}` },
    });
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });

    await new Promise<void>((resolve) => {
      correiosServer.listen(0, "127.0.0.1", resolve);
    });

    // WARNING: listen(0) guarantees AddressInfo with a port
    const addr = correiosServer.address() as AddressInfo;
    correiosBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    invitedEmails.length = 0;
    sentTexts.length = 0;
    inviteFailures.remaining = 0;
    await seedDatabase(db, testSeedFixtures);
  });

  describe("talent access", () => {
    const personalEmail = "ana.pessoal@example.com";
    const sponsoredUntil = "2099-12-31";

    async function firstCaseId() {
      const [first] = await (await call("/offboardings")).json();

      return z.string().parse(first.id);
    }

    function asSession(session: string, path: string, method = "GET", body?: Payload, extra = {}) {
      return app.handle(
        new Request(`http://localhost/api${path}`, {
          method,
          headers: {
            "x-test-session": session,
            origin: webOrigin,
            "content-type": "application/json",
            ...extra,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    }

    it("enables talent access from a case and invites the person", async () => {
      const caseId = await firstCaseId();
      const path = `/offboardings/${caseId}/talent-access`;
      const body = { personalEmail, sponsoredUntil };

      expect((await asSession("visualizador", path, "POST", body)).status).toBe(403);
      expect(invitedEmails).toEqual([]);

      const created = await asSession("rh", path, "POST", body);

      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ personalEmail, sponsoredUntil, signedIn: false });
      expect(invitedEmails).toEqual([personalEmail]);
      expect(sentTexts.at(-1)).toContain(`${webOrigin}/app/entrar`);

      expect((await asSession("rh", path, "POST", body)).status).toBe(409);
      expect(
        (await asSession("rh", `/offboardings/${missingCaseId}/talent-access`, "POST", body))
          .status,
      ).toBe(404);
      expect(invitedEmails).toEqual([personalEmail]);

      const read = await asSession("visualizador", path);

      expect(read.status).toBe(200);
      expect(await read.json()).toEqual({ personalEmail, sponsoredUntil, signedIn: false });
    });

    it("rejects a duplicate personal email and invalid input without inviting", async () => {
      const cases: { id: string }[] = await (await call("/offboardings")).json();
      const [first, second] = cases;

      await repos.talent.enable({ caseId: first.id, personalEmail, sponsoredUntil });

      const taken = await asSession("rh", `/offboardings/${second.id}/talent-access`, "POST", {
        personalEmail,
        sponsoredUntil,
      });

      const invalid = await asSession("rh", `/offboardings/${second.id}/talent-access`, "POST", {
        personalEmail: "nope",
        sponsoredUntil: "tomorrow",
      });

      expect(taken.status).toBe(409);
      expect(invalid.status).toBe(422);
      expect(invitedEmails).toEqual([]);
    });

    it("returns 404 when reading or updating a case without talent access", async () => {
      const path = `/offboardings/${await firstCaseId()}/talent-access`;

      expect((await asSession("rh", path)).status).toBe(404);
      expect((await asSession("rh", path, "PATCH", { sponsoredUntil })).status).toBe(404);
      expect((await asSession("visualizador", path, "PATCH", { sponsoredUntil })).status).toBe(403);
    });

    it("fixes the email only before first sign-in", async () => {
      const caseId = await firstCaseId();
      const path = `/offboardings/${caseId}/talent-access`;
      const created = await repos.talent.enable({ caseId, personalEmail, sponsoredUntil });

      if (
        created === "case_not_found" ||
        created === "already_enabled" ||
        created === "email_taken"
      ) {
        throw new Error(created);
      }

      const changed = await asSession("rh", path, "PATCH", { personalEmail: "novo@example.com" });

      expect(changed.status).toBe(200);
      expect(await changed.json()).toEqual({
        personalEmail: "novo@example.com",
        sponsoredUntil,
        signedIn: false,
      });
      expect(invitedEmails).toEqual(["novo@example.com"]);

      const sameEmail = await asSession("rh", path, "PATCH", { personalEmail: "NOVO@example.com" });

      expect(sameEmail.status).toBe(200);
      expect(invitedEmails).toEqual(["novo@example.com", "novo@example.com"]);

      await repos.talent.markSignedIn(created.id);

      const locked = await asSession("rh", path, "PATCH", { personalEmail: "outro@example.com" });

      expect(locked.status).toBe(409);
      expect(invitedEmails).toEqual(["novo@example.com", "novo@example.com"]);

      const extended = await asSession("rh", path, "PATCH", { sponsoredUntil: "2100-01-31" });

      expect(extended.status).toBe(200);
      expect(invitedEmails).toEqual(["novo@example.com", "novo@example.com"]);
      expect(await extended.json()).toEqual({
        personalEmail: "novo@example.com",
        sponsoredUntil: "2100-01-31",
        signedIn: true,
      });
    });

    it("lets a PATCH resend the invite after a failed one", async () => {
      const path = `/offboardings/${await firstCaseId()}/talent-access`;

      inviteFailures.remaining = 1;

      const failed = await asSession("rh", path, "POST", { personalEmail, sponsoredUntil });

      expect(failed.status).toBe(500);
      expect(invitedEmails).toEqual([]);

      const resent = await asSession("rh", path, "PATCH", { personalEmail });

      expect(resent.status).toBe(200);
      expect(invitedEmails).toEqual([personalEmail]);
    });

    it("rejects an empty PATCH body", async () => {
      const path = `/offboardings/${await firstCaseId()}/talent-access`;

      expect((await asSession("rh", path, "PATCH", {})).status).toBe(422);
    });

    it("rejects a taken email on update without inviting", async () => {
      const [first, second]: { id: string }[] = await (await call("/offboardings")).json();

      await repos.talent.enable({ caseId: first.id, personalEmail, sponsoredUntil });
      await repos.talent.enable({
        caseId: second.id,
        personalEmail: "outra@example.com",
        sponsoredUntil,
      });

      const taken = await asSession("rh", `/offboardings/${second.id}/talent-access`, "PATCH", {
        personalEmail,
      });

      expect(taken.status).toBe(409);
      expect(invitedEmails).toEqual([]);
    });

    it("isolates talent and portal sessions", async () => {
      for (const [path, method] of [
        ["/team", "GET"],
        ["/offboardings", "GET"],
        ["/session", "GET"],
        ["/team", "POST"],
      ]) {
        const denied = await asSession(
          "talent",
          path,
          method,
          method === "POST" ? { name: "Test", email: "test@example.com", role: "rh" } : undefined,
        );

        expect(denied.status).toBe(403);
      }

      expect((await asSession("admin", "/me")).status).toBe(403);
      expect((await asSession("admin", "/me/terms", "POST")).status).toBe(403);
      expect((await asSession("anonymous", "/me")).status).toBe(401);
    });

    it("serves the profile and records terms", async () => {
      const caseId = await firstCaseId();
      const created = await repos.talent.enable({ caseId, personalEmail, sponsoredUntil });

      if (
        created === "case_not_found" ||
        created === "already_enabled" ||
        created === "email_taken"
      ) {
        throw new Error(created);
      }

      const talentHeaders = { "x-test-talent-id": created.id };
      const me = await asSession("talent", "/me", "GET", undefined, talentHeaders);

      expect(me.status).toBe(200);
      expect(await me.json()).toEqual({
        id: created.id,
        name: created.name,
        email: personalEmail,
        termsAccepted: false,
        entitlement: { kind: "sponsored", until: sponsoredUntil },
      });

      const accepted = await asSession("talent", "/me/terms", "POST", undefined, talentHeaders);

      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({ termsAccepted: true });

      const subscription = await repos.billing.getSubscription();

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(subscription.id, { status: "canceled" });

      const lapsed = await asSession("talent", "/me", "GET", undefined, talentHeaders);

      expect(await lapsed.json()).toMatchObject({ entitlement: { kind: "lapsed", until: null } });
    });

    it("denies a talent session whose profile no longer exists", async () => {
      const gone = await asSession("talent", "/me", "GET", undefined, {
        "x-test-talent-id": missingCaseId,
      });

      expect(gone.status).toBe(403);
    });

    describe("jobs catalog", () => {
      const extracted = {
        isJobPosting: true,
        title: "Engenheira de Software",
        company: "Acme",
        workModel: "remote",
        city: "São Paulo",
        state: "SP",
        salaryMinCents: 800000,
        salaryMaxCents: 1200000,
        description: "Descrição da vaga",
      };

      function jobsApp(
        overrides: { generate?: GenerateStructured | null; page?: FetchPageResult } = {},
      ) {
        const calls = { generate: 0, fetch: 0 };

        const generate: GenerateStructured = async ({ schema }) => {
          calls.generate += 1;

          return schema.parse(extracted);
        };

        const fetchPage = async (pageUrl: URL) => {
          calls.fetch += 1;

          return overrides.page ?? { url: pageUrl, text: "Vaga de engenharia" };
        };

        const instance = createApp(webOrigin, repos, {
          ...appOptions,
          generateStructured:
            overrides.generate === null ? undefined : (overrides.generate ?? generate),
          fetchPage,
        });

        function share(session: string, shareUrl: string) {
          return instance.handle(
            new Request("http://localhost/api/jobs/share", {
              method: "POST",
              headers: {
                "x-test-session": session,
                origin: webOrigin,
                "content-type": "application/json",
              },
              body: JSON.stringify({ url: shareUrl }),
            }),
          );
        }

        return { calls, share };
      }

      it("shares a job by link", async () => {
        const { calls, share } = jobsApp();
        const created = await share("rh", "https://jobs.example.com/vaga-1");

        expect(created.status).toBe(201);
        expect(await created.json()).toMatchObject({
          origin: "hr",
          title: "Engenheira de Software",
          company: "Acme",
          workModel: "remote",
          url: "https://jobs.example.com/vaga-1",
        });
        expect(calls).toEqual({ generate: 1, fetch: 1 });

        const again = await share("rh", "https://jobs.example.com/vaga-1?utm_source=x");

        expect(again.status).toBe(200);
        expect(calls).toEqual({ generate: 1, fetch: 1 });
        expect((await again.json()).id).toBe(
          (await (await share("admin", "https://jobs.example.com/vaga-1")).json()).id,
        );
        expect((await share("visualizador", "https://jobs.example.com/vaga-2")).status).toBe(403);
      });

      it("returns the existing job when a concurrent share wins the race", async () => {
        const { share } = jobsApp({
          generate: async ({ schema }) => {
            const { isJobPosting: _ignored, ...draft } = jobDraftSchema.parse(extracted);

            await repos.jobs.createShared({
              ...draft,
              url: "https://jobs.example.com/race",
              sourceKey: "https://jobs.example.com/race",
            });

            return schema.parse(extracted);
          },
        });

        expect((await share("rh", "https://jobs.example.com/race")).status).toBe(200);
      });

      it("rejects pages that are not job postings", async () => {
        const { share } = jobsApp({
          generate: async ({ schema }) => schema.parse({ ...extracted, isJobPosting: false }),
        });

        const response = await share("rh", "https://blog.example.com/post");

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: "Page is not a job posting" });
        expect(
          await repos.jobs.findBySource("hr-link", "https://blog.example.com/post"),
        ).toBeUndefined();
      });

      it("reports unreadable pages, invalid urls and missing AI", async () => {
        const unreachable = jobsApp({ page: "unreachable" });
        const failed = await unreachable.share("rh", "https://jobs.example.com/down");

        expect(failed.status).toBe(502);
        expect(await failed.json()).toEqual({ error: "Could not read the job page" });

        const invalidPage = jobsApp({ page: "invalid_url" });

        expect((await invalidPage.share("rh", "https://jobs.example.com/redirect")).status).toBe(
          422,
        );

        const insecure = jobsApp();
        const rejected = await insecure.share("rh", "http://jobs.example.com/vaga");

        expect(rejected.status).toBe(422);
        expect(await rejected.json()).toEqual({ error: "Invalid job url" });
        expect(insecure.calls.fetch).toBe(0);

        const noAi = jobsApp({ generate: null });
        const unavailable = await noAi.share("rh", "https://jobs.example.com/no-ai");

        expect(unavailable.status).toBe(503);
        expect(await unavailable.json()).toEqual({ error: "AI not configured" });
        expect(noAi.calls.fetch).toBe(0);
      });

      it("rejects urls whose normalized form is too long before fetching", async () => {
        const { calls, share } = jobsApp();
        const longUrl = `https://jobs.example.com/${"ã".repeat(600)}`;

        expect(longUrl.length).toBeLessThanOrEqual(2048);

        const response = await share("rh", longUrl);

        expect(response.status).toBe(422);
        expect(await response.json()).toEqual({ error: "Invalid job url" });
        expect(calls).toEqual({ generate: 0, fetch: 0 });
      });

      it("reports extraction failures as a bad gateway", async () => {
        const logged = vi.spyOn(console, "error");

        const { share } = jobsApp({
          generate: () => Promise.reject(new Error("gateway down")),
        });

        const response = await share("rh", "https://jobs.example.com/llm-down");

        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: "Could not extract the job" });
        expect(logged).toHaveBeenCalledTimes(1);
        logged.mockRestore();
      });

      it("guards the job list with active talent access", async () => {
        const caseId = await firstCaseId();
        const created = await repos.talent.enable({ caseId, personalEmail, sponsoredUntil });

        if (
          created === "case_not_found" ||
          created === "already_enabled" ||
          created === "email_taken"
        ) {
          throw new Error(created);
        }

        const talentHeaders = { "x-test-talent-id": created.id };

        await db.insert(jobs).values([
          {
            origin: "external",
            source: "seed",
            sourceKey: "a",
            title: "A",
            company: "Acme",
            workModel: "remote",
            url: "https://jobs.example.com/a",
            postedAt: new Date("2026-01-02"),
          },
          {
            origin: "external",
            source: "seed",
            sourceKey: "b",
            title: "B",
            company: "Acme",
            workModel: "onsite",
            url: "https://jobs.example.com/b",
            postedAt: new Date("2026-01-01"),
          },
          {
            origin: "external",
            source: "seed",
            sourceKey: "c",
            title: "C",
            company: "Acme",
            url: "https://jobs.example.com/c",
            closedAt: new Date(),
          },
        ]);

        expect(
          (await asSession("talent", "/me/jobs", "GET", undefined, talentHeaders)).status,
        ).toBe(403);

        await repos.talent.acceptTerms(created.id);

        const listed = await asSession("talent", "/me/jobs", "GET", undefined, talentHeaders);
        const body = await listed.json();

        expect(listed.status).toBe(200);
        expect(body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
        expect(body.items.map((item: { title: string }) => item.title)).toEqual(["A", "B"]);

        const remote = await asSession(
          "talent",
          "/me/jobs?workModel=remote",
          "GET",
          undefined,
          talentHeaders,
        );

        expect((await remote.json()).items).toHaveLength(1);
        expect(
          (await asSession("talent", "/me/jobs?page=0", "GET", undefined, talentHeaders)).status,
        ).toBe(422);
        expect(
          (await asSession("talent", "/me/jobs?page=10001", "GET", undefined, talentHeaders))
            .status,
        ).toBe(422);
        expect(
          (await asSession("talent", "/me/jobs?page=abc", "GET", undefined, talentHeaders)).status,
        ).toBe(422);
        expect(
          (await asSession("talent", "/me/jobs?workModel=moon", "GET", undefined, talentHeaders))
            .status,
        ).toBe(422);
        expect((await asSession("admin", "/me/jobs")).status).toBe(403);

        const subscription = await repos.billing.getSubscription();

        if (!subscription) throw new Error("missing subscription");

        await repos.billing.updateSubscription(subscription.id, { status: "canceled" });

        expect(
          (await asSession("talent", "/me/jobs", "GET", undefined, talentHeaders)).status,
        ).toBe(402);
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      correiosServer.close(() => resolve());
    });

    await db.$client.end();
  });

  it("reports health", async () => {
    const res = await call("/health");

    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("forwards magic link requests through the API prefix without consuming the body", async () => {
    const verification = await call("/auth/magic-link/verify");
    expect(await verification.json()).toEqual({
      path: "/api/auth/magic-link/verify",
      payload: null,
    });

    const requested = await call("/auth/sign-in/magic-link", "POST", {
      email: "member@example.com",
    });

    expect(await requested.json()).toEqual({
      path: "/api/auth/sign-in/magic-link",
      payload: JSON.stringify({ email: "member@example.com" }),
    });
  });

  it.each([
    ["anonymous", 401],
    ["revoked", 403],
    ["talent", 403],
  ])("denies a %s session before reading protected records", async (session, expected) => {
    const headers = { "x-test-session": session };
    const principal = await app.handle(new Request("http://localhost/api/session", { headers }));
    const cases = await app.handle(new Request("http://localhost/api/offboardings", { headers }));
    const team = await app.handle(new Request("http://localhost/api/team", { headers }));

    const bundled = await app.handle(
      new Request("http://localhost/api/offboardings/with-tasks", { headers }),
    );

    expect(team.status).toBe(expected);
    expect(bundled.status).toBe(expected);
    expect(bundled.headers.get("cache-control")).toBe("no-store");
    expect(principal.status).toBe(expected);
    expect(cases.status).toBe(expected);
    expect(principal.headers.get("cache-control")).toBe("no-store");
    expect(cases.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["admin", 201, 200],
    ["rh", 201, 403],
    ["gestor", 403, 403],
    ["visualizador", 403, 403],
  ])("enforces the %s permission matrix on the API", async (role, createStatus, teamStatus) => {
    const headers = {
      "x-test-session": role,
      origin: webOrigin,
      "content-type": "application/json",
    };

    const principal = await app.handle(new Request("http://localhost/api/session", { headers }));
    const cases = await app.handle(new Request("http://localhost/api/offboardings", { headers }));
    const team = await app.handle(new Request("http://localhost/api/team", { headers }));

    const created = await app.handle(
      new Request("http://localhost/api/offboardings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Test",
          role: "Analyst",
          department: "RH",
          deadline: "2026-12-01",
        }),
      }),
    );

    expect(principal.status).toBe(200);
    expect(await principal.json()).toMatchObject({ role });
    expect(cases.status).toBe(200);
    expect(team.status).toBe(teamStatus);
    expect(created.status).toBe(createStatus);
  });

  it("rejects an otherwise authorized request from another origin", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/team", {
        method: "POST",
        headers: { origin: "https://another.example", "content-type": "application/json" },
        body: JSON.stringify({ name: "Test", email: "test@example.com", role: "rh" }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects missing and incorrect machine credentials", async () => {
    const noSecret = createApp(webOrigin, repos, { auth, sendEmail });
    const cronWithoutConfig = await noSecret.handle(cronRequest());

    const webhookWithoutCredential = await app.handle(
      new Request(`http://localhost/api/webhooks/inbound/${missingTaskId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"event":"delivered"}',
      }),
    );

    const wrongCredential = await app.handle(
      new Request("http://localhost/api/correios/check", {
        headers: { authorization: "Bearer test-cron-wrong!" },
      }),
    );

    expect(cronWithoutConfig.status).toBe(401);
    expect(webhookWithoutCredential.status).toBe(401);
    expect(wrongCredential.status).toBe(401);
  });

  it("rejects an unsigned Slack event and a correctly signed event with an expired timestamp", async () => {
    const request = slackRequest('{"type":"event_callback"}');
    request.headers.delete("x-slack-signature");

    expect((await app.handle(request)).status).toBe(401);
    expect((await app.handle(slackRequest('{"type":"event_callback"}', "1"))).status).toBe(401);

    const noSecret = createApp(webOrigin, repos, { auth, sendEmail });
    expect((await noSecret.handle(slackRequest('{"type":"event_callback"}'))).status).toBe(401);
  });

  it("rejects incorrectly formatted Slack bodies even when the signature is valid", async () => {
    expect((await app.handle(slackRequest("{"))).status).toBe(422);
    expect((await app.handle(slackRequest("{}"))).status).toBe(422);
  });

  it("lists offboardings", async () => {
    const res = await call("/offboardings");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      role: expect.any(String),
      department: expect.any(String),
      deadline: expect.any(String),
      completed: expect.any(Number),
      total: expect.any(Number),
    });
  });

  it("lists offboardings with their tasks for an authorized session", async () => {
    const res = await call("/offboardings/with-tasks");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list).toContainEqual(
      expect.objectContaining({
        name: "Marina Lopes",
        tasks: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
      }),
    );
  });

  it("returns not found for a malformed offboarding id", async () => {
    const res = await call("/offboardings/not-a-uuid");

    expect(res.status).toBe(404);
  });

  it("gets an offboarding with its tasks", async () => {
    const list = await (await call("/offboardings")).json();
    const first = list[0];
    const res = await call(`/offboardings/${first.id}`);
    const found = await res.json();

    expect(res.status).toBe(200);
    expect(found.id).toBe(first.id);
    expect(found.tasks.length).toBe(found.total);
  });

  it("returns task details with description, dueDate and subtasks", async () => {
    const list = await (await call("/offboardings")).json();
    const marina = list.find((c: { name: string }) => c.name === "Marina Lopes");
    const res = await call(`/offboardings/${marina.id}`);
    const found = await res.json();

    const calcular = found.tasks.find((t: { title: string }) => t.title === "Calcular a rescisão");
    expect(calcular.dueDate).toBe("2026-11-13");
    expect(calcular.subtasks).toHaveLength(4);
    expect(calcular.subtasks[0]).toEqual({
      id: expect.any(String),
      title: "Levantar saldo de férias",
      done: true,
    });
  });

  it("returns 404 for an unknown id", async () => {
    const res = await call(`/offboardings/${missingCaseId}`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Offboarding not found" });
  });

  it("creates an offboarding", async () => {
    const body = { name: "Ana Souza", role: "Dev", department: "Eng", deadline: "2026-12-01" };
    const res = await call("/offboardings", "POST", body);
    const created = await res.json();

    expect(res.status).toBe(201);
    expect(created).toEqual({ id: expect.any(String), ...body, completed: 0, total: 0 });
    expect((await call(`/offboardings/${created.id}`)).status).toBe(200);
  });

  it.each([
    { name: "", role: "Dev", department: "Eng", deadline: "2026-12-01" },
    { name: "Ana", role: "Dev", department: "Eng", deadline: "tomorrow" },
    { name: "Ana" },
  ])("rejects an invalid offboarding %j", async (body) => {
    const res = await call("/offboardings", "POST", body);

    expect(res.status).toBe(422);
  });

  it("imports offboardings in bulk", async () => {
    const rows = [
      { name: "Bia Lima", department: "Ops" },
      { name: "Caio Reis", department: "Ops" },
    ];

    const res = await call("/offboardings/import", "POST", { rows });
    const created = await res.json();

    expect(res.status).toBe(201);
    expect(created.length).toBe(2);
    expect(created[0]).toMatchObject({ name: "Bia Lima", department: "Ops" });
    expect(created[1]).toMatchObject({ name: "Caio Reis", department: "Ops" });
  });

  it("rejects an invalid import", async () => {
    const res = await call("/offboardings/import", "POST", { rows: [{ name: "Bia" }] });

    expect(res.status).toBe(422);
  });

  it("updates a task status", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const target = detail.tasks.find((item: { status: string }) => item.status !== "in_progress");
    const res = await call(`/tasks/${target?.id}/status`, "PATCH", { status: "in_progress" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(target.id);
    expect(body.status).toBe("in_progress");
    expect(body).toHaveProperty("subtasks");
  });

  it("returns 404 for an unknown task", async () => {
    const res = await call(`/tasks/${missingTaskId}/status`, "PATCH", { status: "done" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("rejects an invalid task status or id", async () => {
    const badStatus = await call(`/tasks/${missingTaskId}/status`, "PATCH", { status: "blocked" });
    const badId = await call("/tasks/not-a-uuid/status", "PATCH", { status: "done" });

    expect(badStatus.status).toBe(422);
    expect(badId.status).toBe(422);
  });

  it("toggles a subtask", async () => {
    const list = await (await call("/offboardings")).json();
    const marina = list.find((c: { name: string }) => c.name === "Marina Lopes");
    const detail = await (await call(`/offboardings/${marina.id}`)).json();
    const calcular = detail.tasks.find((t: { title: string }) => t.title === "Calcular a rescisão");
    const sub = calcular.subtasks.find((s: { title: string }) => s.title === "Calcular multa FGTS");

    expect(sub.done).toBe(false);

    const res = await call(`/subtasks/${sub.id}/toggle`, "PATCH");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: sub.id, title: "Calcular multa FGTS", done: true });
  });

  it("returns 404 for an unknown subtask toggle", async () => {
    const res = await call(`/subtasks/${missingTaskId}/toggle`, "PATCH");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Subtask not found" });
  });

  it("rejects an invalid subtask id", async () => {
    const res = await call("/subtasks/not-a-uuid/toggle", "PATCH");

    expect(res.status).toBe(422);
  });

  it("lists integrations from seed", async () => {
    const res = await call("/integrations");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({ name: expect.any(String), status: expect.any(String) });
  });

  it("creates an integration via upsert", async () => {
    const res = await call("/integrations/Test%20System", "PUT", { status: "connected" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Test System", status: "connected" });
  });

  it("updates an existing integration status", async () => {
    await call("/integrations/Test%20Toggle", "PUT", { status: "connected" });
    const res = await call("/integrations/Test%20Toggle", "PUT", { status: "disconnected" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Test Toggle", status: "disconnected" });
  });

  it("lists equipment with the person name", async () => {
    const res = await call("/equipment");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({
      id: expect.any(String),
      item: expect.any(String),
      tag: expect.any(String),
      person: expect.any(String),
      returnMethod: expect.stringMatching(/^(pickup|in_person)$/),
      scheduledDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      status: expect.any(String),
    });
  });

  it("updates an equipment status", async () => {
    const [{ person: _person, ...first }] = await (await call("/equipment")).json();
    const res = await call(`/equipment/${first.id}`, "PUT", { status: "received" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...first, status: "received" });
  });

  it("returns 404 when updating unknown equipment", async () => {
    const res = await call(`/equipment/${missingTaskId}`, "PUT", { status: "received" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Equipment not found" });
  });

  it("lets visualizador read but not update equipment", async () => {
    const headers = { "x-test-session": "visualizador", origin: webOrigin };
    const list = await app.handle(new Request("http://localhost/api/equipment", { headers }));

    const update = await app.handle(
      new Request(`http://localhost/api/equipment/${missingTaskId}`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ status: "received" }),
      }),
    );

    expect(list.status).toBe(200);
    expect(update.status).toBe(403);
  });

  it("rejects an invalid equipment status", async () => {
    const res = await call(`/equipment/${missingTaskId}`, "PUT", { status: "invalid" });

    expect(res.status).toBe(422);
  });

  it("lists exit surveys with case names, newest first", async () => {
    const res = await call("/exit-surveys");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ caseName: "Nina Castro", npsScore: 6 });
  });

  it("aggregates exit surveys", async () => {
    const res = await call("/exit-surveys/aggregates");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      totalResponses: 5,
      averageNps: 6.6,
      nps: -20,
      completionRate: 100,
      activationsByMonth: [
        { label: "Jun", value: 1 },
        { label: "Jul", value: 1 },
        { label: "Ago", value: 1 },
        { label: "Set", value: 1 },
        { label: "Out", value: 1 },
      ],
      topTopics: [
        { label: "Clareza de prazos", value: 3 },
        { label: "Respeito na comunicação", value: 3 },
        { label: "Apoio emocional", value: 2 },
        { label: "Devolução de equipamentos", value: 2 },
        { label: "Acesso a benefícios", value: 1 },
      ],
    });
  });

  it("returns zeroed aggregates without surveys", async () => {
    await db.$client.query("DELETE FROM exit_surveys");
    const res = await call("/exit-surveys/aggregates");

    expect(await res.json()).toEqual({
      totalResponses: 0,
      averageNps: 0,
      nps: 0,
      completionRate: 0,
      activationsByMonth: [],
      topTopics: [],
    });
  });

  it("submits and resubmits a survey for a case", async () => {
    const [first] = await (await call("/offboardings")).json();
    await db.$client.query("DELETE FROM exit_surveys");
    const payload = { caseId: first.id, npsScore: 10, responses: { ok: true }, topics: ["A"] };

    const created = await app.handle(
      new Request("http://localhost/api/exit-surveys", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify(payload),
      }),
    );

    const again = await app.handle(
      new Request("http://localhost/api/exit-surveys", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ ...payload, npsScore: 2 }),
      }),
    );

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ caseId: first.id, npsScore: 10 });
    expect(again.status).toBe(201);
    expect(await (await call("/exit-surveys")).json()).toHaveLength(1);
  });

  it("rejects surveys for unknown cases and out-of-range scores", async () => {
    const post = (body: SurveyPayload) =>
      app.handle(
        new Request("http://localhost/api/exit-surveys", {
          method: "POST",
          headers: { "content-type": "application/json", origin: webOrigin },
          body: JSON.stringify(body),
        }),
      );

    const unknown = await post({ caseId: missingCaseId, npsScore: 5, responses: {}, topics: [] });
    const invalid = await post({ caseId: missingCaseId, npsScore: 11, responses: {}, topics: [] });

    expect(unknown.status).toBe(404);
    expect(invalid.status).toBe(422);
  });

  it("restricts survey reads to admin and rh while any role can submit", async () => {
    const send = (role: string, path: string, method = "GET", body?: SurveyPayload) =>
      app.handle(
        new Request(`http://localhost/api${path}`, {
          method,
          headers: {
            "x-test-session": role,
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );

    expect((await send("rh", "/exit-surveys")).status).toBe(200);
    expect((await send("gestor", "/exit-surveys")).status).toBe(403);
    expect((await send("visualizador", "/exit-surveys/aggregates")).status).toBe(403);

    const submit = await send("visualizador", "/exit-surveys", "POST", {
      caseId: missingCaseId,
      npsScore: 5,
      responses: {},
      topics: [],
    });

    expect(submit.status).toBe(404);
  });

  it("rejects an invalid integration status", async () => {
    const res = await call("/integrations/Whatever", "PUT", { status: "invalid" });

    expect(res.status).toBe(422);
  });

  it("lists action configs from seed", async () => {
    const res = await call("/action-configs");
    const list = await res.json();

    expect(res.status).toBe(200);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({
      id: expect.any(String),
      actionId: expect.any(String),
      enabled: expect.any(Boolean),
      config: expect.any(Object),
      phase: expect.any(String),
    });
  });

  it("creates an action config", async () => {
    const res = await call("/action-configs", "POST", {
      actionId: "google::transfer_files",
      phase: "first-week",
      config: { target: "manager" },
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: expect.any(String),
      actionId: "google::transfer_files",
      enabled: true,
      config: { target: "manager" },
      phase: "first-week",
    });
  });

  it("rejects a duplicate action_id", async () => {
    await call("/action-configs", "POST", { actionId: "dup::test", phase: "d0" });
    const res = await call("/action-configs", "POST", { actionId: "dup::test", phase: "d0" });

    expect(res.status).toBe(409);
  });

  it("updates an action config", async () => {
    const created = await (
      await call("/action-configs", "POST", { actionId: "upd::test", phase: "d0" })
    ).json();

    const res = await call(`/action-configs/${created.id}`, "PUT", {
      enabled: false,
      phase: "pre",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, enabled: false, phase: "pre" });
  });

  it("returns 404 when updating unknown config", async () => {
    const res = await call(`/action-configs/${missingCaseId}`, "PUT", { enabled: false });

    expect(res.status).toBe(404);
  });

  it("deletes an action config", async () => {
    const created = await (
      await call("/action-configs", "POST", { actionId: "del::test", phase: "d0" })
    ).json();

    const res = await call(`/action-configs/${created.id}`, "DELETE");

    expect(res.status).toBe(204);
  });

  it("returns 404 when deleting unknown config", async () => {
    const res = await call(`/action-configs/${missingCaseId}`, "DELETE");

    expect(res.status).toBe(404);
  });

  it("lists seeded team members ordered by name", async () => {
    const res = await call("/team");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: expect.any(String), name: "Beatriz Castro", email: expect.any(String), role: "admin" },
      { id: expect.any(String), name: "Camila Rocha", email: expect.any(String), role: "rh" },
      { id: expect.any(String), name: "Diego Alves", email: expect.any(String), role: "gestor" },
    ]);
  });

  it("creates a team member", async () => {
    const res = await call("/team", "POST", {
      name: "Eva Dias",
      email: "eva.dias@offboard.com",
      role: "visualizador",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: expect.any(String),
      name: "Eva Dias",
      email: "eva.dias@offboard.com",
      role: "visualizador",
    });
  });

  it("rejects a duplicate team member email", async () => {
    const res = await call("/team", "POST", {
      name: "Outra Pessoa",
      email: "camila.rocha@offboard.com",
      role: "rh",
    });

    expect(res.status).toBe(409);
  });

  it("rejects invalid team member payloads", async () => {
    const badEmail = await call("/team", "POST", { name: "A", email: "nope", role: "rh" });
    const badRole = await call("/team", "POST", { name: "A", email: "a@b.com", role: "root" });
    const noName = await call("/team", "POST", { email: "a@b.com", role: "rh" });

    expect(badEmail.status).toBe(422);
    expect(badRole.status).toBe(422);
    expect(noName.status).toBe(422);
  });

  it("deletes a team member", async () => {
    const [first] = await (await call("/team")).json();

    const res = await call(`/team/${first.id}`, "DELETE");

    expect(res.status).toBe(204);
    expect(await (await call("/team")).json()).toHaveLength(2);
  });

  it("returns 404 when deleting unknown team member", async () => {
    const res = await call(`/team/${missingCaseId}`, "DELETE");

    expect(res.status).toBe(404);
  });

  it("rejects invalid action config", async () => {
    const noAction = await call("/action-configs", "POST", { phase: "d0" });
    const noPhase = await call("/action-configs", "POST", { actionId: "test::x" });

    expect(noAction.status).toBe(422);
    expect(noPhase.status).toBe(422);
  });

  it("rethrows unexpected create errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        actionConfigs: {
          ...repos.actionConfigs,
          createActionConfig: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/action-configs", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ actionId: "x::y", phase: "d0" }),
      }),
    );

    expect(res.status).toBe(500);
  });

  it("rethrows unexpected team member create errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        team: {
          ...repos.team,
          createTeamMember: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/team", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ name: "A", email: "a@b.com", role: "rh" }),
      }),
    );

    expect(res.status).toBe(500);
  });

  it("responds to slack url_verification challenge", async () => {
    const res = await call("/integrations/slack/events", "POST", {
      type: "url_verification",
      challenge: "test-challenge-abc123",
      token: "test-token",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "test-challenge-abc123" });
  });

  it("returns ok when url_verification lacks challenge", async () => {
    const res = await call("/integrations/slack/events", "POST", {
      type: "url_verification",
      token: "test-token",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts slack event_callback with 200", async () => {
    const res = await call("/integrations/slack/events", "POST", {
      type: "event_callback",
      token: "test-token",
      team_id: "T12345",
      api_app_id: "A12345",
      event: { type: "member_joined_channel", user: "U12345" },
      event_id: "Ev12345",
      event_time: 1234567890,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("accepts a delivered inbound webhook and marks task done", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    const res = await call(`/webhooks/inbound/${todo.id}`, "POST", {
      event: "delivered",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true });

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("done");
  });

  it("ignores non-delivered/completed webhook events", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    const res = await call(`/webhooks/inbound/${todo.id}`, "POST", {
      event: "in_transit",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: false, reason: "event ignored" });
  });

  it("returns 404 for inbound webhook on unknown task", async () => {
    const res = await call(`/webhooks/inbound/${missingTaskId}`, "POST", {
      event: "delivered",
    });

    expect(res.status).toBe(404);
  });

  it("fires actions when task status changes to done", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();

    const todo = detail.tasks.find(
      (t: { status: string; title: string }) =>
        t.status === "todo" && t.title === "Enviar desligamento ao eSocial",
    );

    const res = await call(`/tasks/${todo.id}/status`, "PATCH", { status: "done" });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("done");
  });

  it("returns tracking info for a task with tracking code", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "RO",
              tipo: "01",
              descricao: "Objeto em trânsito",
              dtHrCriado: "2026-11-18T16:00:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "AB123456789BR" }).where(eq(tasks.id, task.id));

    const res = await correiosApp.handle(
      new Request(`http://localhost/api/tasks/${task.id}/tracking`),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trackingCode).toBe("AB123456789BR");
    expect(body.tracking).toEqual({
      delivered: false,
      lastEvent: "Objeto em trânsito",
      lastUpdate: "2026-11-18T16:00:00",
    });
  });

  it("returns null tracking for a task without tracking code", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks[0];

    const res = await app.handle(new Request(`http://localhost/api/tasks/${task.id}/tracking`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trackingCode: null, tracking: null });
  });

  it("returns 404 for tracking on unknown task", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/tasks/${missingTaskId}/tracking`),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("checks tracked shipments via GET and marks delivered tasks done", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "01",
              descricao: "Objeto entregue ao destinatário",
              dtHrCriado: "2026-11-20T10:30:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "CD987654321BR" }).where(eq(tasks.id, todo.id));

    const res = await correiosApp.handle(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBeGreaterThanOrEqual(1);
    expect(body.delivered).toContain(todo.id);

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("done");
  });

  it("checks tracked shipments via POST", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({ objetos: [] });

    const res = await correiosApp.handle(cronRequest("POST"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBeGreaterThanOrEqual(0);
    expect(body.delivered).toEqual([]);
  });

  it("does not mark non-delivered tracked tasks as done", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "RO",
              tipo: "01",
              descricao: "Objeto em trânsito",
              dtHrCriado: "2026-11-18T16:00:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "EF111222333BR" }).where(eq(tasks.id, todo.id));

    const res = await correiosApp.handle(cronRequest());

    const body = await res.json();
    expect(body.delivered).toEqual([]);

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("todo");
  });

  it("fires actions for delivered tasks with a phase", async () => {
    const correiosApp = createApp(webOrigin, repos, { ...appOptions, correiosBaseUrl });

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "01",
              descricao: "Objeto entregue",
              dtHrCriado: "2026-11-21T09:00:00",
            },
          ],
        },
      ],
    });

    const list = await (await call("/offboardings")).json();

    const detail = await (await call(`/offboardings/${list[0].id}`)).json();

    const taskWithPhase = detail.tasks.find(
      (t: { status: string; title: string }) =>
        t.status === "todo" && t.title === "Enviar desligamento ao eSocial",
    );

    await db
      .update(tasks)
      .set({ trackingCode: "GH444555666BR" })
      .where(eq(tasks.id, taskWithPhase.id));

    const res = await correiosApp.handle(cronRequest());

    const body = await res.json();
    expect(body.delivered).toContain(taskWithPhase.id);
  });

  it("includes trackingCode in task details", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks[0];

    expect(task).toHaveProperty("trackingCode");
  });

  it("handles task deletion during correios check gracefully", async () => {
    const stubbedApp = createApp(
      webOrigin,
      {
        ...repos,
        offboardings: {
          ...repos.offboardings,
          getTrackedTasks: () =>
            Promise.resolve([
              { id: missingTaskId, title: "Gone", phase: "d0", trackingCode: "ZZ999999999BR" },
            ]),
        },
      },
      { ...appOptions, correiosBaseUrl },
    );

    correiosStatus = 200;
    correiosBody = JSON.stringify({
      objetos: [
        {
          eventos: [
            {
              codigo: "BDE",
              tipo: "01",
              descricao: "Entregue",
              dtHrCriado: "2026-11-21T10:00:00",
            },
          ],
        },
      ],
    });

    const res = await stubbedApp.handle(cronRequest());

    const body = await res.json();
    expect(body.checked).toBe(1);
    expect(body.delivered).toEqual([]);
  });

  it("rethrows unexpected create errors", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        actionConfigs: {
          ...repos.actionConfigs,
          createActionConfig: () => Promise.reject(new Error("boom")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/action-configs", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ actionId: "x::y", phase: "d0" }),
      }),
    );

    expect(res.status).toBe(500);
  });
});
