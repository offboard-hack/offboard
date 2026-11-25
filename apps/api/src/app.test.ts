import { createHmac } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPortalAbility } from "@offboard/access";
import { createClient } from "@offboard/db/client";
import { createRepositories } from "./repositories.js";
import type { ConfigValue } from "@offboard/db/schema";
import {
  applications,
  backgroundJobs,
  interviews,
  jobSources,
  jobMatches,
  jobs,
  llmUsage,
  offboardingCases,
  publicPageDailyViews,
  publicPages,
  resumes,
  talentProfiles,
  tasks,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import type { CatalogSource } from "./features/sources/catalog.js";
import type { GenerateStructured } from "./shared/ai.js";
import { diskStorage } from "./shared/disk-storage.js";
import type { ObjectStorage } from "./shared/object-storage.js";
import { zipSync } from "fflate";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
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

const appOptions = {
  auth,
  sendEmail,
  cronSecret,
  webhookSecret,
  slackSigningSecret,
  catalog: [],
  runInBackground: () => undefined,
};

function leakyError(prompt: string) {
  return Object.assign(new Error("gateway down"), { requestBodyValues: { prompt } });
}

async function drawnText(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  const decoder = new TextDecoder("windows-1252");

  return document
    .getPages()
    .flatMap((page) => {
      const contents = page.node.Contents();

      return contents instanceof PDFArray ? contents.asArray() : [];
    })
    .map((ref) => {
      const stream = document.context.lookup(ref);

      return stream instanceof PDFRawStream
        ? decoder.decode(decodePDFRawStream(stream).decode())
        : "";
    })
    .join("");
}

function hex(text: string) {
  return Array.from(text, (char) =>
    char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
  ).join("");
}

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
    shareOutcomeWithHr?: boolean | string;
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
        shareOutcomeWithHr: false,
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

    it("grants the aggregates permission to admin and rh only", () => {
      expect(createPortalAbility("admin").can("read", "TalentAggregates")).toBe(true);
      expect(createPortalAbility("rh").can("read", "TalentAggregates")).toBe(true);
      expect(createPortalAbility("gestor").can("read", "TalentAggregates")).toBe(false);
      expect(createPortalAbility("visualizador").can("read", "TalentAggregates")).toBe(false);
    });

    it("stores the person's own consent", async () => {
      const [firstCase, secondCase] = await db
        .select({ id: offboardingCases.id })
        .from(offboardingCases);

      const enable = async (caseId: string, email: string) => {
        const created = await repos.talent.enable({ caseId, personalEmail: email, sponsoredUntil });

        if (
          created === "case_not_found" ||
          created === "already_enabled" ||
          created === "email_taken"
        ) {
          throw new Error(created);
        }

        return created;
      };

      const mine = await enable(firstCase.id, personalEmail);
      const other = await enable(secondCase.id, "outra@example.com");

      const asMine = { "x-test-talent-id": mine.id };

      expect(
        (await asSession("rh", "/me/consent", "PUT", { shareOutcomeWithHr: true })).status,
      ).toBe(403);
      expect((await repos.talent.findById(mine.id))?.shareOutcomeWithHr).toBe(false);

      const early = await asSession(
        "talent",
        "/me/consent",
        "PUT",
        { shareOutcomeWithHr: true },
        asMine,
      );

      expect(early.status).toBe(200);
      expect(await early.json()).toMatchObject({ termsAccepted: false, shareOutcomeWithHr: true });

      const shared = await asSession(
        "talent",
        "/me/consent",
        "PUT",
        { shareOutcomeWithHr: true },
        asMine,
      );

      expect(shared.status).toBe(200);
      expect(await shared.json()).toMatchObject({ id: mine.id, shareOutcomeWithHr: true });
      expect(
        await (await asSession("talent", "/me", "GET", undefined, asMine)).json(),
      ).toMatchObject({ shareOutcomeWithHr: true });
      expect((await repos.talent.findById(other.id))?.shareOutcomeWithHr).toBe(false);

      const withdrawn = await asSession(
        "talent",
        "/me/consent",
        "PUT",
        { shareOutcomeWithHr: false },
        asMine,
      );

      expect(await withdrawn.json()).toMatchObject({ shareOutcomeWithHr: false });

      await repos.talent.setConsent(mine.id, true, new Date());

      const subscription = await repos.billing.getSubscription();

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(subscription.id, { status: "canceled" });

      const lapsed = await asSession(
        "talent",
        "/me/consent",
        "PUT",
        { shareOutcomeWithHr: false },
        asMine,
      );

      expect(lapsed.status).toBe(200);
      expect(await lapsed.json()).toMatchObject({
        entitlement: { kind: "lapsed" },
        shareOutcomeWithHr: false,
      });
      expect(
        (await asSession("talent", "/me/consent", "PUT", { shareOutcomeWithHr: "yes" }, asMine))
          .status,
      ).toBe(422);
    });

    it("denies a talent session whose profile no longer exists", async () => {
      const gone = await asSession("talent", "/me", "GET", undefined, {
        "x-test-talent-id": missingCaseId,
      });

      expect(gone.status).toBe(403);
    });

    it("restricts aggregates to admin and rh", async () => {
      const expected = {
        enabled: 0,
        activated: null,
        funnel: { sent: null, responded: null, interviews: null, offers: null },
        hiresShared: null,
        topJobs: [],
      };

      for (const session of ["admin", "rh"]) {
        const response = await asSession(session, "/talent/aggregates");

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual(expected);
      }

      for (const session of ["gestor", "visualizador", "talent"]) {
        expect((await asSession(session, "/talent/aggregates")).status).toBe(403);
      }

      expect((await asSession("anonymous", "/talent/aggregates")).status).toBe(401);
    });

    describe("jobs catalog", () => {
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
        expect(body.items[0]).toMatchObject({ match: null, applied: false });

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

    describe("applications", () => {
      type TalentHeaders = { "x-test-talent-id": string };

      async function talentProfile(email: string, caseIndex: number) {
        const cases: { id: string }[] = await (await call("/offboardings")).json();

        const created = await repos.talent.enable({
          caseId: cases[caseIndex].id,
          personalEmail: email,
          sponsoredUntil,
        });

        if (
          created === "case_not_found" ||
          created === "already_enabled" ||
          created === "email_taken"
        ) {
          throw new Error(created);
        }

        await repos.talent.acceptTerms(created.id);
        await repos.resumes.replaceBase(
          created.id,
          {
            headline: { id: "headline", text: "Engenheira" },
            summary: { id: "summary", text: "Backend." },
            experiences: [],
            education: [],
            skills: [],
            languages: [],
            contact: { email: null, phone: null, city: null, links: [] },
          },
          `resumes/${created.id}.pdf`,
        );

        return { "x-test-talent-id": created.id };
      }

      async function baseResume(headers: TalentHeaders) {
        const base = await repos.resumes.getBase(headers["x-test-talent-id"]);

        return { resumeId: z.object({ id: z.string() }).parse(base).id };
      }

      async function seedJob(sourceKey: string, closedAt?: Date) {
        const [job] = await db
          .insert(jobs)
          .values({
            origin: "external",
            source: "seed",
            sourceKey,
            title: `Job ${sourceKey}`,
            company: "Acme",
            url: `https://jobs.example.com/${sourceKey}`,
            closedAt,
          })
          .returning({ id: jobs.id });

        return job.id;
      }

      function send(
        headers: TalentHeaders,
        path: string,
        method = "GET",
        body?: Record<string, string>,
      ) {
        return app.handle(
          new Request(`http://localhost/api${path}`, {
            method,
            headers: {
              "x-test-session": "talent",
              origin: webOrigin,
              "content-type": "application/json",
              ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );
      }

      async function applyTo(headers: TalentHeaders, jobId: string) {
        const response = await send(
          headers,
          `/me/jobs/${jobId}/apply`,
          "POST",
          await baseResume(headers),
        );

        expect(response.status).toBe(201);

        return z.object({ applicationId: z.string() }).parse(await response.json()).applicationId;
      }

      it("applies once to open jobs", async () => {
        const headers = await talentProfile(personalEmail, 0);
        const jobId = await seedJob("open");
        const body = await baseResume(headers);

        const notReady = await send(headers, `/me/jobs/${jobId}/apply`, "POST", {
          resumeId: crypto.randomUUID(),
        });

        expect(notReady.status).toBe(422);
        expect(await notReady.json()).toEqual({ error: "Résumé not ready for this job" });
        expect((await send(headers, `/me/jobs/${jobId}/apply`, "POST")).status).toBe(422);

        const applied = await send(headers, `/me/jobs/${jobId}/apply`, "POST", body);

        expect(applied.status).toBe(201);
        expect(await applied.json()).toEqual({
          applicationId: expect.any(String),
          jobUrl: "https://jobs.example.com/open",
          publicPageUrl: null,
        });

        const again = await send(headers, `/me/jobs/${jobId}/apply`, "POST", body);

        expect(again.status).toBe(409);
        expect(await again.json()).toEqual({ error: "Already applied" });

        const closed = await send(
          headers,
          `/me/jobs/${await seedJob("gone", new Date())}/apply`,
          "POST",
          body,
        );

        expect(closed.status).toBe(404);
        expect(await closed.json()).toEqual({ error: "Job not found" });

        const unknown = await send(headers, `/me/jobs/${crypto.randomUUID()}/apply`, "POST", body);

        expect(unknown.status).toBe(404);
        expect((await send(headers, "/me/jobs/not-a-uuid/apply", "POST", body)).status).toBe(422);
        expect(
          (await send(headers, `/me/jobs/${jobId}/apply`, "POST", { resumeId: "not-a-uuid" }))
            .status,
        ).toBe(422);

        const listed = await (await send(headers, "/me/applications")).json();

        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ status: "sent", closedReason: null });
      });

      it("moves an application through the funnel", async () => {
        const headers = await talentProfile(personalEmail, 0);
        const id = await applyTo(headers, await seedJob("funnel"));

        const patch = (body: Record<string, string>) =>
          send(headers, `/me/applications/${id}`, "PATCH", body);

        const reviewed = await patch({ status: "in_review" });

        expect(reviewed.status).toBe(200);
        expect(await reviewed.json()).toMatchObject({ id, status: "in_review" });

        const backwards = await patch({ status: "sent" });

        expect(backwards.status).toBe(409);
        expect(await backwards.json()).toEqual({ error: "Invalid status transition" });
        expect((await patch({ status: "offer" })).status).toBe(200);

        const closed = await patch({ status: "closed", closedReason: "hired" });

        expect(await closed.json()).toMatchObject({ status: "closed", closedReason: "hired" });
        expect((await patch({ status: "closed", closedReason: "rejected" })).status).toBe(409);
        expect((await patch({ status: "moon" })).status).toBe(422);

        expect(await (await send(headers, "/me/applications/summary")).json()).toEqual({
          sent: 1,
          responded: 1,
          interviews: 1,
          offers: 1,
        });

        expect(
          (await send(headers, "/me/applications/not-a-uuid", "PATCH", { status: "offer" })).status,
        ).toBe(422);
      });

      it("logs interviews and lists the week", async () => {
        const headers = await talentProfile(personalEmail, 0);
        const id = await applyTo(headers, await seedJob("agenda"));
        const path = `/me/applications/${id}/interviews`;

        const created = await send(headers, path, "POST", {
          startsAt: "2026-03-10T17:00:00.000Z",
          mode: "video",
          with: "Maria",
          notes: "Prepare a case",
        });

        expect(created.status).toBe(201);

        const interview = await created.json();

        expect(interview).toMatchObject({
          applicationId: id,
          startsAt: "2026-03-10T17:00:00.000Z",
          mode: "video",
          with: "Maria",
          job: { title: "Job agenda", company: "Acme" },
        });

        expect(await (await send(headers, "/me/applications")).json()).toMatchObject([
          { status: "interview" },
        ]);

        const week = await send(headers, "/me/interviews?from=2026-03-09&to=2026-03-15");

        expect(week.status).toBe(200);
        expect(await week.json()).toHaveLength(1);
        expect(
          await (await send(headers, "/me/interviews?from=2026-03-11&to=2026-03-15")).json(),
        ).toEqual([]);

        const bad = await send(headers, path, "POST", {
          startsAt: "tomorrow",
          mode: "video",
          with: "Maria",
        });

        expect(bad.status).toBe(422);
        expect(
          (
            await send(headers, path, "POST", {
              startsAt: "2026-03-10T17:00:00Z",
              mode: "video",
              with: "",
            })
          ).status,
        ).toBe(422);

        expect(
          (
            await send(headers, "/me/applications/not-a-uuid/interviews", "POST", {
              startsAt: "2026-03-10T17:00:00Z",
              mode: "phone",
              with: "Ana",
            })
          ).status,
        ).toBe(422);

        await send(headers, `/me/applications/${id}`, "PATCH", {
          status: "closed",
          closedReason: "withdrawn",
        });

        const onClosed = await send(headers, path, "POST", {
          startsAt: "2026-03-11T17:00:00Z",
          mode: "phone",
          with: "Ana",
        });

        expect(onClosed.status).toBe(409);
        expect(await onClosed.json()).toEqual({ error: "Application is closed" });

        const removed = await send(headers, `/me/interviews/${interview.id}`, "DELETE");

        expect(removed.status).toBe(204);
        expect(await removed.text()).toBe("");

        const gone = await send(headers, `/me/interviews/${interview.id}`, "DELETE");

        expect(gone.status).toBe(404);
        expect(await gone.json()).toEqual({ error: "Interview not found" });
        expect((await send(headers, "/me/interviews/not-a-uuid", "DELETE")).status).toBe(422);
      });

      it("hides other profiles' applications", async () => {
        const owner = await talentProfile(personalEmail, 0);
        const other = await talentProfile("outra@example.com", 1);
        const id = await applyTo(owner, await seedJob("private"));

        const patched = await send(other, `/me/applications/${id}`, "PATCH", {
          status: "in_review",
        });

        expect(patched.status).toBe(404);
        expect(await patched.json()).toEqual({ error: "Application not found" });

        expect(await (await send(owner, "/me/applications")).json()).toMatchObject([
          { status: "sent" },
        ]);

        const created = await send(owner, `/me/applications/${id}/interviews`, "POST", {
          startsAt: "2026-03-10T17:00:00Z",
          mode: "video",
          with: "Maria",
        });

        const interview = await created.json();

        const logged = await send(other, `/me/applications/${id}/interviews`, "POST", {
          startsAt: "2026-03-10T18:00:00Z",
          mode: "phone",
          with: "Ana",
        });

        expect(logged.status).toBe(404);
        expect((await send(other, `/me/interviews/${interview.id}`, "DELETE")).status).toBe(404);
        expect(await (await send(other, "/me/applications")).json()).toEqual([]);
        expect(
          await (await send(other, "/me/interviews?from=2026-03-09&to=2026-03-15")).json(),
        ).toEqual([]);
        expect(await (await send(owner, "/me/applications")).json()).toMatchObject([
          { status: "interview" },
        ]);
        expect(
          await (await send(owner, "/me/interviews?from=2026-03-09&to=2026-03-15")).json(),
        ).toHaveLength(1);
      });

      it("rejects invalid interview input without storing anything", async () => {
        const headers = await talentProfile(personalEmail, 0);
        const id = await applyTo(headers, await seedJob("invalid"));
        const path = `/me/applications/${id}/interviews`;
        const valid = { startsAt: "2026-03-10T17:00:00Z", mode: "video", with: "Maria" };

        const bodies = [
          { ...valid, startsAt: "2026-11-26T23:59:60Z" },
          { ...valid, startsAt: "2026-11-26T10:00:00+03" },
          { ...valid, with: "a".repeat(256) },
          { ...valid, notes: "a".repeat(2001) },
          { ...valid, mode: "carrier_pigeon" },
        ];

        for (const body of bodies) {
          expect((await send(headers, path, "POST", body)).status).toBe(422);
        }

        const patched = await send(headers, `/me/applications/${id}`, "PATCH", {
          status: "closed",
          closedReason: "ghosted",
        });

        expect(patched.status).toBe(422);
        expect(await (await send(headers, "/me/applications")).json()).toMatchObject([
          { status: "sent" },
        ]);

        expect(await db.select().from(interviews)).toEqual([]);
      });

      it("validates the agenda range", async () => {
        const headers = await talentProfile(personalEmail, 0);

        const reversed = await send(headers, "/me/interviews?from=2026-03-15&to=2026-03-09");

        expect(reversed.status).toBe(422);
        expect(await reversed.json()).toEqual({ error: "Invalid date range" });

        const wide = await send(headers, "/me/interviews?from=2026-03-01&to=2026-04-01");

        expect(wide.status).toBe(422);
        expect(await wide.json()).toEqual({ error: "Invalid date range" });
        expect((await send(headers, "/me/interviews?from=2026-03-01")).status).toBe(422);
        expect((await send(headers, "/me/interviews")).status).toBe(422);
        expect((await send(headers, "/me/interviews?from=x&to=y")).status).toBe(422);
      });

      it("guards the routes with active talent access", async () => {
        const headers = await talentProfile(personalEmail, 0);

        expect(
          (await send({ "x-test-talent-id": crypto.randomUUID() }, "/me/applications")).status,
        ).toBe(403);
        expect(
          (
            await app.handle(
              new Request("http://localhost/api/me/applications", {
                headers: { "x-test-session": "admin", origin: webOrigin },
              }),
            )
          ).status,
        ).toBe(403);

        const subscription = await repos.billing.getSubscription();

        if (!subscription) throw new Error("missing subscription");

        await repos.billing.updateSubscription(subscription.id, { status: "canceled" });

        expect((await send(headers, "/me/applications")).status).toBe(402);
      });

      describe("public pages", () => {
        const phone = "+55 11 98765-4321";
        const city = "Campinas";
        const contactEmail = "ana.contato@example.com";

        type PagePatch = { enabled?: boolean; slug?: string; resumeId?: string | null };

        async function publicProfile(email = personalEmail, caseIndex = 0) {
          const headers = await talentProfile(email, caseIndex);

          await repos.resumes.updateBaseContent(headers["x-test-talent-id"], {
            headline: { id: "headline", text: "Engenheira" },
            summary: { id: "summary", text: "Backend." },
            experiences: [],
            education: [],
            skills: [],
            languages: [],
            contact: { email: contactEmail, phone, city, links: ["https://ana.dev"] },
          });

          return headers;
        }

        function pageRequest(
          headers: Record<string, string>,
          path: string,
          method = "GET",
          body?: PagePatch,
          instance = app,
        ) {
          return instance.handle(
            new Request(`http://localhost/api${path}`, {
              method,
              headers: {
                "x-test-session": "talent",
                origin: webOrigin,
                "content-type": "application/json",
                ...headers,
              },
              body: body === undefined ? undefined : JSON.stringify(body),
            }),
          );
        }

        function visit(path: string, session = "anonymous", extra = {}) {
          return app.handle(
            new Request(`http://localhost/api${path}`, {
              headers: { "x-test-session": session, ...extra },
            }),
          );
        }

        async function publish(headers: Record<string, string>, slug: string) {
          const response = await pageRequest(headers, "/me/page", "PATCH", { enabled: true, slug });

          expect(response.status).toBe(200);
        }

        function counters() {
          return db.select().from(publicPageDailyViews);
        }

        function weekOf(response: Response) {
          return response
            .json()
            .then((page) =>
              z
                .object({ week: z.object({ visits: z.number(), recruiterVisits: z.number() }) })
                .parse(page),
            );
        }

        it("publishes the page and counts visits", async () => {
          const headers = await publicProfile();
          const profileId = headers["x-test-talent-id"];

          const initial = await pageRequest(headers, "/me/page");

          expect(initial.status).toBe(200);
          expect(initial.headers.get("cache-control")).toBe("no-store");
          expect(await initial.json()).toEqual({
            slug: expect.any(String),
            enabled: false,
            resumeId: null,
            url: expect.stringMatching(new RegExp(`^${webOrigin}/p/[a-z0-9-]+$`)),
            week: {
              days: expect.any(Array),
              visits: 0,
              recruiterVisits: 0,
            },
          });
          expect(await counters()).toEqual([]);

          const saved = await pageRequest(headers, "/me/page", "PATCH", {
            enabled: true,
            slug: "ana-dev",
          });

          expect(saved.status).toBe(200);
          expect(await saved.json()).toMatchObject({
            slug: "ana-dev",
            enabled: true,
            resumeId: null,
            url: `${webOrigin}/p/ana-dev`,
          });

          const viewed = await visit("/public/pages/ana-dev");

          expect(viewed.status).toBe(200);
          expect(viewed.headers.get("cache-control")).toBe("private, max-age=60");

          const [profile] = await db
            .select({ name: talentProfiles.name })
            .from(talentProfiles)
            .where(eq(talentProfiles.id, profileId));

          const body = await viewed.json();

          expect(body).toEqual({
            name: profile.name,
            headline: "Engenheira",
            summary: "Backend.",
            experiences: [],
            education: [],
            skills: [],
            languages: [],
            contact: { email: contactEmail, links: ["https://ana.dev"] },
          });
          expect(JSON.stringify(body)).not.toContain("98765");
          expect(JSON.stringify(body)).not.toContain(city);

          expect((await visit("/public/pages/ana-dev", "admin")).status).toBe(200);
          expect((await visit(`/public/pages/ana-dev?a=${"x".repeat(65)}`)).status).toBe(200);
          expect(
            (
              await visit("/public/pages/ana-dev", "talent", {
                "x-test-talent-id": crypto.randomUUID(),
              })
            ).status,
          ).toBe(200);
          expect(
            (await visit("/public/pages/ana-dev", "talent", { "x-test-talent-id": profileId }))
              .status,
          ).toBe(200);

          const settings = await pageRequest(headers, "/me/page");

          expect(await weekOf(settings)).toMatchObject({ week: { visits: 4, recruiterVisits: 0 } });
        });

        it("hides unpublishable pages without counting", async () => {
          const headers = await publicProfile();
          const profileId = headers["x-test-talent-id"];

          await publish(headers, "ana-dev");

          expect((await visit("/public/pages/ana-dev/pdf")).status).toBe(200);
          expect(await counters()).toEqual([]);

          async function expectHidden(slug: string) {
            for (const path of [`/public/pages/${slug}`, `/public/pages/${slug}/pdf`]) {
              const hidden = await visit(path);

              expect(hidden.status).toBe(404);
              expect(hidden.headers.get("content-type")).toContain("application/json");
              expect(hidden.headers.get("cache-control")).toBe("no-store");
              expect(await hidden.json()).toEqual({ error: "Page not found" });
            }

            expect(await counters()).toEqual([]);
          }

          await expectHidden("nobody-here");
          await expectHidden("Not_A-Slug!");

          await pageRequest(headers, "/me/page", "PATCH", { enabled: false });
          await expectHidden("ana-dev");

          await pageRequest(headers, "/me/page", "PATCH", { enabled: true });
          await db
            .update(talentProfiles)
            .set({ sponsoredUntil: "2000-01-01" })
            .where(eq(talentProfiles.id, profileId));
          await expectHidden("ana-dev");

          await db
            .update(talentProfiles)
            .set({ sponsoredUntil })
            .where(eq(talentProfiles.id, profileId));
          expect((await visit("/public/pages/ana-dev")).status).toBe(200);
          await db.delete(publicPageDailyViews);

          const subscription = await repos.billing.getSubscription();

          if (!subscription) throw new Error("missing subscription");

          await repos.billing.updateSubscription(subscription.id, { status: "canceled" });
          await expectHidden("ana-dev");
        });

        it("links applications to the page and counts recruiter visits", async () => {
          const headers = await publicProfile();
          const resume = await baseResume(headers);

          const before = await pageRequest(
            headers,
            `/me/jobs/${await seedJob("before")}/apply`,
            "POST",
            resume,
          );

          expect(before.status).toBe(201);
          expect(await before.json()).toMatchObject({ publicPageUrl: null });

          await publish(headers, "ana-dev");

          const after = await pageRequest(
            headers,
            `/me/jobs/${await seedJob("after")}/apply`,
            "POST",
            resume,
          );

          const { publicPageUrl } = z
            .object({ publicPageUrl: z.string() })
            .parse(await after.json());

          const link = new URL(publicPageUrl);

          expect(`${link.origin}${link.pathname}`).toBe(`${webOrigin}/p/ana-dev`);

          const [application] = await db
            .select({ token: applications.publicToken })
            .from(applications)
            .innerJoin(jobs, eq(jobs.id, applications.jobId))
            .where(eq(jobs.sourceKey, "after"));

          expect(link.searchParams.get("a")).toBe(application.token);

          expect(
            (
              await visit(`/public/pages/ana-dev?a=${application.token}`, "talent", {
                "x-test-talent-id": headers["x-test-talent-id"],
              })
            ).status,
          ).toBe(200);
          expect(await counters()).toEqual([]);

          expect((await visit(`/public/pages/ana-dev?a=${application.token}`)).status).toBe(200);

          expect(await weekOf(await pageRequest(headers, "/me/page"))).toMatchObject({
            week: { visits: 1, recruiterVisits: 1 },
          });

          await pageRequest(headers, "/me/page", "PATCH", { enabled: false });

          const disabled = await pageRequest(
            headers,
            `/me/jobs/${await seedJob("disabled")}/apply`,
            "POST",
            resume,
          );

          expect(await disabled.json()).toMatchObject({ publicPageUrl: null });
        });

        it("public PDF never contains the phone", async () => {
          const headers = await publicProfile();

          await publish(headers, "ana-dev");

          const response = await visit("/public/pages/ana-dev/pdf");

          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("application/pdf");
          expect(response.headers.get("content-disposition")).toBe(
            'attachment; filename="ana-dev.pdf"',
          );
          expect(response.headers.get("cache-control")).toBe("private, max-age=300");

          const text = await drawnText(new Uint8Array(await response.arrayBuffer()));

          expect(text).toContain(hex(contactEmail));
          expect(text).toContain(hex("https://ana.dev"));
          expect(text).not.toContain(hex("98765"));
          expect(text).not.toContain(hex(city));
          expect(await counters()).toEqual([]);
        });

        it("downloads the person's own résumé PDF with phone and city", async () => {
          const headers = await publicProfile();
          const other = await publicProfile("outra@example.com", 1);
          const { resumeId } = await baseResume(headers);

          const own = await pageRequest(headers, `/me/resume/${resumeId}/pdf`);

          expect(own.status).toBe(200);
          expect(own.headers.get("content-type")).toBe("application/pdf");
          expect(own.headers.get("content-disposition")).toBe(
            'attachment; filename="curriculo.pdf"',
          );
          expect(own.headers.get("cache-control")).toBe("no-store");

          const text = await drawnText(new Uint8Array(await own.arrayBuffer()));

          expect(text).toContain(hex(phone));
          expect(text).toContain(hex(city));
          expect(text).toContain(hex(contactEmail));

          const jobId = await seedJob("tailored");
          const base = await repos.resumes.getBase(headers["x-test-talent-id"]);

          if (!base) throw new Error("missing base");

          const draft = await repos.resumeVersions.saveDraft(
            headers["x-test-talent-id"],
            jobId,
            base.content,
            null,
            new Date(),
          );

          if (draft === "used") throw new Error(draft);

          expect((await pageRequest(headers, `/me/resume/${draft.id}/pdf`)).status).toBe(200);

          const foreign = await pageRequest(other, `/me/resume/${resumeId}/pdf`);

          expect(foreign.status).toBe(404);
          expect(await foreign.json()).toEqual({ error: "Résumé not found" });
          expect((await pageRequest(headers, `/me/resume/${crypto.randomUUID()}/pdf`)).status).toBe(
            404,
          );
          expect((await pageRequest(headers, "/me/resume/not-a-uuid/pdf")).status).toBe(422);
          expect((await visit(`/me/resume/${resumeId}/pdf`, "admin")).status).toBe(403);
        });

        it("validates page settings", async () => {
          const headers = await publicProfile();
          const other = await publicProfile("outra@example.com", 1);

          await publish(other, "taken-slug");

          const patch = (body: PagePatch) => pageRequest(headers, "/me/page", "PATCH", body);

          const reserved = await patch({ slug: "admin" });

          expect(reserved.status).toBe(422);
          expect(await reserved.json()).toEqual({ error: "Invalid slug" });

          const taken = await patch({ slug: "taken-slug" });

          expect(taken.status).toBe(409);
          expect(await taken.json()).toEqual({ error: "Slug taken" });

          const missing = await patch({ resumeId: crypto.randomUUID() });

          expect(missing.status).toBe(422);
          expect(await missing.json()).toEqual({ error: "Résumé not ready" });

          expect((await patch({})).status).toBe(422);

          const long = await patch({ slug: "a".repeat(41) });

          expect(long.status).toBe(422);
          expect(await long.json()).toEqual({ error: "Invalid slug" });
          expect((await patch({ resumeId: "not-a-uuid" })).status).toBe(422);

          const { resumeId } = await baseResume(headers);
          const chosen = await patch({ resumeId });

          expect(chosen.status).toBe(200);
          expect(await chosen.json()).toMatchObject({ resumeId, enabled: false });

          const cleared = await patch({ resumeId: null });

          expect(await cleared.json()).toMatchObject({ resumeId: null });
        });

        it("guards the page settings with active talent access", async () => {
          await publicProfile();

          expect((await visit("/me/page", "admin")).status).toBe(403);
          expect((await visit("/me/page")).status).toBe(401);
          expect(
            (
              await app.handle(
                new Request("http://localhost/api/me/page", {
                  method: "PATCH",
                  headers: {
                    "x-test-session": "admin",
                    origin: webOrigin,
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({ enabled: true }),
                }),
              )
            ).status,
          ).toBe(403);
        });

        it("serves the page when the viewer lookup or the visit write fails", async () => {
          const headers = await publicProfile();

          await publish(headers, "ana-dev");

          const logged = vi.spyOn(console, "error");

          const sessionDown = createApp(webOrigin, repos, {
            ...appOptions,
            auth: { ...auth, resolvePrincipal: () => Promise.reject(new Error("session down")) },
          });

          const viewed = await sessionDown.handle(
            new Request("http://localhost/api/public/pages/ana-dev"),
          );

          expect(viewed.status).toBe(200);
          expect(await viewed.json()).toMatchObject({ headline: "Engenheira" });
          expect(await counters()).toMatchObject([{ visits: 1, recruiterVisits: 0 }]);

          const visitsDown = createApp(
            webOrigin,
            {
              ...repos,
              pages: {
                ...repos.pages,
                recordVisit: () => Promise.reject(new Error("visits down")),
              },
            },
            appOptions,
          );

          const unrecorded = await visitsDown.handle(
            new Request("http://localhost/api/public/pages/ana-dev", {
              headers: { "x-test-session": "anonymous" },
            }),
          );

          expect(unrecorded.status).toBe(200);
          expect(unrecorded.headers.get("cache-control")).toBe("private, max-age=60");
          expect(await unrecorded.json()).toMatchObject({ headline: "Engenheira" });
          expect(await counters()).toMatchObject([{ visits: 1, recruiterVisits: 0 }]);
          expect(logged.mock.calls).toEqual([
            ["public page viewer lookup failed", { name: "Error", message: "session down" }],
            ["public page visit failed", { name: "Error", message: "visits down" }],
          ]);
          logged.mockRestore();
        });

        it("applies without a page link when the link lookup fails", async () => {
          const headers = await publicProfile();

          await publish(headers, "ana-dev");

          const logged = vi.spyOn(console, "error");

          const linksDown = createApp(
            webOrigin,
            {
              ...repos,
              pages: { ...repos.pages, urlFor: () => Promise.reject(new Error("links down")) },
            },
            appOptions,
          );

          const applied = await pageRequest(
            headers,
            `/me/jobs/${await seedJob("links-down")}/apply`,
            "POST",
            await baseResume(headers),
            linksDown,
          );

          expect(applied.status).toBe(201);
          expect(await applied.json()).toMatchObject({ publicPageUrl: null });
          expect(await db.select().from(applications)).toHaveLength(1);
          expect(logged.mock.calls).toEqual([
            ["public page link failed", { name: "Error", message: "links down" }],
          ]);
          logged.mockRestore();
        });

        it("falls back to the portal origin for an empty page origin", async () => {
          const headers = await publicProfile();

          const instance = createApp(webOrigin, repos, { ...appOptions, publicPageOrigin: "" });

          const saved = await pageRequest(
            headers,
            "/me/page",
            "PATCH",
            { enabled: true, slug: "ana-dev" },
            instance,
          );

          expect(await saved.json()).toMatchObject({ url: `${webOrigin}/p/ana-dev` });
        });

        it("builds page URLs on the configured origin", async () => {
          const headers = await publicProfile();

          const instance = createApp(webOrigin, repos, {
            ...appOptions,
            publicPageOrigin: "https://cv.example.com/",
          });

          const saved = await pageRequest(
            headers,
            "/me/page",
            "PATCH",
            { enabled: true, slug: "ana-dev" },
            instance,
          );

          expect(await saved.json()).toMatchObject({ url: "https://cv.example.com/p/ana-dev" });

          const applied = await pageRequest(
            headers,
            `/me/jobs/${await seedJob("configured")}/apply`,
            "POST",
            await baseResume(headers),
            instance,
          );

          expect(await applied.json()).toMatchObject({
            publicPageUrl: expect.stringMatching(/^https:\/\/cv\.example\.com\/p\/ana-dev\?a=/),
          });
        });
      });
    });

    describe("résumés", () => {
      const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");

      const draft = {
        isResume: true,
        headline: { text: "Engenheira de Software" },
        summary: { text: "Dez anos de experiência" },
        experiences: [
          { company: "Acme", role: "Dev", start: "2019", end: null, bullets: [{ text: "Fez X" }] },
        ],
        education: [],
        skills: [{ name: "TypeScript" }],
        languages: [],
        contact: { email: null, phone: null, city: null, links: [] },
      };

      type Store = {
        puts: { key: string; contentType: string }[];
        removed: string[];
        prefixes: string[];
        failRemove: boolean;
      };

      type Scoring = { output: object; calls: number };

      type Matching = {
        scores: Record<string, number>;
        batches: string[][];
        before?: () => Promise<void>;
        omit?: boolean;
        fail?: boolean;
      };

      type Tailoring = { output: object; fail?: boolean };

      type ModelCall = { kind: "tailor" | "match"; prompt: string };

      const jobsInPrompt = z.array(z.object({ id: z.string(), title: z.string() }));

      function resumesApp(
        options: { generate?: GenerateStructured | null; storage?: boolean; draft?: object } = {},
      ) {
        const store: Store = { puts: [], removed: [], prefixes: [], failRemove: false };

        const scoring: Scoring = { output: { score: 0, suggestions: [] }, calls: 0 };

        const matching: Matching = { scores: {}, batches: [] };

        const tailoring: Tailoring = {
          output: { rewrites: [], experienceOrder: [], bulletOrder: [], skillIds: [] },
        };

        const calls: ModelCall[] = [];

        const background: (() => Promise<void>)[] = [];

        const storage: ObjectStorage = {
          put: async (key, _data, contentType) => {
            store.puts.push({ key, contentType });
          },
          remove: async (keys) => {
            if (store.failRemove) throw new Error("storage down");

            store.removed.push(...keys);
          },
          removePrefix: async (prefix) => {
            if (store.failRemove) throw new Error("storage down");

            store.prefixes.push(prefix);
          },
        };

        const generate: GenerateStructured = async ({ schema, system, prompt }) => {
          if (system.startsWith("You tailor")) {
            calls.push({ kind: "tailor", prompt });

            if (tailoring.fail) throw leakyError(prompt);

            return schema.parse(tailoring.output);
          }

          const extracted = schema.safeParse(options.draft ?? draft);

          if (extracted.success) return extracted.data;

          if (system.startsWith("You rate how well")) {
            calls.push({ kind: "match", prompt });

            if (matching.fail) throw leakyError(prompt);

            const batch = jobsInPrompt.parse(
              JSON.parse(prompt.slice(prompt.indexOf("<jobs>") + 6, prompt.indexOf("</jobs>"))),
            );

            matching.batches.push(batch.map((job) => job.title));

            const before = matching.before;

            matching.before = undefined;
            await before?.();

            return schema.parse({
              matches: matching.omit
                ? []
                : batch.map((job) => ({
                    jobId: job.id,
                    score: matching.scores[job.title] ?? 50,
                    reasons: [`Combina com ${job.title}`],
                  })),
            });
          }

          scoring.calls += 1;

          return schema.parse(scoring.output);
        };

        const instance = createApp(webOrigin, repos, {
          ...appOptions,
          generateStructured:
            options.generate === null ? undefined : (options.generate ?? generate),
          storage: options.storage === false ? undefined : storage,
          runInBackground: (task) => {
            background.push(task);
          },
        });

        async function kicks() {
          const tasks = background.splice(0);

          await Promise.all(tasks.map((task) => task()));

          return tasks.length;
        }

        async function settle() {
          await kicks();

          for (let round = 0; round < 10; round += 1) {
            const drained = await instance.handle(
              new Request("http://localhost/api/background/drain", {
                method: "POST",
                headers: { authorization: `Bearer ${cronSecret}` },
              }),
            );

            if ((await drained.json()).processed === 0) return;
          }

          throw new Error("background queue did not settle");
        }

        return { instance, store, scoring, matching, tailoring, calls, kicks, settle };
      }

      async function profile(email = personalEmail, caseIndex = 0) {
        const cases: { id: string }[] = await (await call("/offboardings")).json();

        const created = await repos.talent.enable({
          caseId: cases[caseIndex].id,
          personalEmail: email,
          sponsoredUntil,
        });

        if (
          created === "case_not_found" ||
          created === "already_enabled" ||
          created === "email_taken"
        ) {
          throw new Error(created);
        }

        await repos.talent.acceptTerms(created.id);

        return created.id;
      }

      function request(
        instance: ReturnType<typeof resumesApp>["instance"],
        talentId: string,
        path: string,
        init: { method?: string; body?: BodyInit; json?: unknown; session?: string } = {},
      ) {
        const headers = new Headers({
          "x-test-session": init.session ?? "talent",
          "x-test-talent-id": talentId,
          origin: webOrigin,
        });

        if (init.json !== undefined) headers.set("content-type", "application/json");

        return instance.handle(
          new Request(`http://localhost/api${path}`, {
            method: init.method ?? "GET",
            headers,
            body: init.json === undefined ? init.body : JSON.stringify(init.json),
          }),
        );
      }

      function upload(
        instance: ReturnType<typeof resumesApp>["instance"],
        talentId: string,
        bytes: Uint8Array = pdf,
        name = "cv.pdf",
      ) {
        const form = new FormData();

        form.set("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));

        return request(instance, talentId, "/me/resume/upload", { method: "POST", body: form });
      }

      function docx() {
        return zipSync({
          "word/document.xml": new TextEncoder().encode(
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Maria CV</w:t></w:r></w:p></w:body></w:document>',
          ),
          "[Content_Types].xml": new TextEncoder().encode("<Types/>"),
        });
      }

      it("uploads a résumé and replaces it on the next upload", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();

        const first = await upload(instance, id);

        expect(first.status).toBe(200);

        const created = await first.json();

        expect(created).toMatchObject({ kind: "base", score: null });
        expect(created.content.headline.text).toBe("Engenheira de Software");
        expect(store.puts).toHaveLength(1);
        expect(store.puts[0].key).toMatch(new RegExp(`^resumes/${id}/[0-9a-f-]+\\.pdf$`));
        expect(store.puts[0].contentType).toBe("application/pdf");

        const second = await upload(instance, id, docx(), "cv.docx");

        expect(second.status).toBe(200);
        expect((await second.json()).id).toBe(created.id);
        expect(store.puts[1].key).toMatch(/\.docx$/);
        expect(store.puts[1].contentType).toBe(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        expect(store.removed).toEqual([store.puts[0].key]);
      });

      it("keeps the new résumé when removing the previous file fails", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();

        expect((await upload(instance, id)).status).toBe(200);

        store.failRemove = true;

        expect((await upload(instance, id)).status).toBe(200);
        expect(store.puts).toHaveLength(2);
      });

      it("rejects files whose bytes are not a PDF or DOCX", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();

        const html = await upload(instance, id, new TextEncoder().encode("<html></html>"));

        expect(html.status).toBe(422);
        expect(await html.json()).toEqual({ error: "Unsupported file" });
        expect(store.puts).toEqual([]);
      });

      it("rejects an oversized docx expansion", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();

        const bomb = zipSync({
          "word/document.xml": new Uint8Array(3_000_000).fill(0x61),
        });

        const res = await upload(instance, id, bomb, "cv.docx");

        expect(res.status).toBe(422);
        expect(await res.json()).toEqual({ error: "File too large" });
        expect(store.puts).toEqual([]);
      });

      it("rejects files above the size limit", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();
        const big = new Uint8Array(5_242_881);

        big.set(pdf);

        expect((await upload(instance, id, big)).status).toBe(422);
        expect(store.puts).toEqual([]);
      });

      it("cleans up the stored file when extraction fails", async () => {
        const logged = vi.spyOn(console, "error");

        const failing = resumesApp({
          generate: async ({ prompt }) => {
            throw leakyError(prompt);
          },
        });

        const id = await profile();
        const res = await upload(failing.instance, id);

        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "Could not read the résumé" });
        expect(failing.store.removed).toEqual([failing.store.puts[0].key]);
        expect(logged.mock.calls).toEqual([
          ["résumé extraction failed", { name: "Error", message: "gateway down" }],
        ]);
        logged.mockRestore();

        const notResume = resumesApp({ draft: { ...draft, isResume: false } });
        const refused = await upload(notResume.instance, id);

        expect(refused.status).toBe(422);
        expect(await refused.json()).toEqual({ error: "File is not a résumé" });
        expect(notResume.store.removed).toEqual([notResume.store.puts[0].key]);
        expect((await request(notResume.instance, id, "/me/resume")).status).toBe(404);

        const stuck = resumesApp({ draft: { ...draft, isResume: false } });

        stuck.store.failRemove = true;

        expect((await upload(stuck.instance, id)).status).toBe(422);
      });

      it("cleans up the stored file when saving fails", async () => {
        const store: string[] = [];

        const instance = createApp(
          webOrigin,
          {
            ...repos,
            resumes: {
              ...repos.resumes,
              replaceBase: () => Promise.reject(new Error("db down")),
            },
          },
          {
            ...appOptions,
            generateStructured: async ({ schema }) => schema.parse(draft),
            storage: {
              put: async () => undefined,
              remove: async (keys) => {
                store.push(...keys);
              },
              removePrefix: async () => undefined,
            },
          },
        );

        const res = await upload(instance, await profile());

        expect(res.status).toBe(500);
        expect(store).toHaveLength(1);
      });

      it("answers 503 when upload is not configured", async () => {
        const id = await profile();

        for (const options of [{ storage: false }, { generate: null }]) {
          const { instance, store } = resumesApp(options);
          const res = await upload(instance, id);

          expect(res.status).toBe(503);
          expect(await res.json()).toEqual({ error: "Résumé upload not configured" });
          expect(store.puts).toEqual([]);
        }
      });

      it("reads and edits the résumé", async () => {
        const { instance } = resumesApp();
        const id = await profile();

        expect(await (await request(instance, id, "/me/resume")).json()).toEqual({
          error: "Résumé not found",
        });
        expect(
          (await request(instance, id, "/me/resume", { method: "PATCH", json: { content: {} } }))
            .status,
        ).toBe(422);

        const emptyContent = {
          headline: { text: "" },
          summary: { text: "" },
          experiences: [],
          education: [],
          skills: [],
          languages: [],
          contact: { email: null, phone: null, city: null, links: [] },
        };

        const missing = await request(instance, id, "/me/resume", {
          method: "PATCH",
          json: { content: emptyContent },
        });

        expect(missing.status).toBe(404);

        const created = await (await upload(instance, id)).json();
        const read = await request(instance, id, "/me/resume");

        expect(read.status).toBe(200);
        expect(await read.json()).toEqual(created);
      });

      it("assigns and validates node ids on edit", async () => {
        const { instance } = resumesApp();
        const id = await profile();

        const created = await (await upload(instance, id)).json();
        const { id: _headlineId, ...headline } = created.content.headline;

        const edited = {
          ...created.content,
          headline: { ...headline, text: "Nova" },
          skills: [{ name: "Go" }, { name: "Rust" }],
        };

        const ok = await request(instance, id, "/me/resume", {
          method: "PATCH",
          json: { content: edited },
        });

        expect(ok.status).toBe(200);

        const saved = await ok.json();

        expect(saved.content.headline.text).toBe("Nova");
        expect(saved.content.headline.id).toEqual(expect.any(String));
        expect(saved.content.skills.map((skill: { id: string }) => skill.id)).toHaveLength(2);

        const duplicate = await request(instance, id, "/me/resume", {
          method: "PATCH",
          json: {
            content: {
              ...edited,
              headline: { id: "same", text: "a" },
              summary: { id: "same", text: "b" },
            },
          },
        });

        expect(duplicate.status).toBe(422);
        expect(await duplicate.json()).toEqual({ error: "Duplicate node ids" });

        const invalid = await request(instance, id, "/me/resume", {
          method: "PATCH",
          json: { content: { headline: 1 } },
        });

        expect(invalid.status).toBe(422);
        expect(await invalid.json()).toEqual({ error: "Invalid résumé content" });
      });

      it("validates edits structurally and against the content limits", async () => {
        const { instance } = resumesApp();
        const id = await profile();

        const created = await (await upload(instance, id)).json();

        const structural = await request(instance, id, "/me/resume", {
          method: "PATCH",
          json: { content: { ...created.content, skills: [{ name: 1 }] } },
        });

        expect(structural.status).toBe(422);
        expect(await structural.json()).toEqual({ error: "Invalid résumé content" });

        const tooMany = await request(instance, id, "/me/resume", {
          method: "PATCH",
          json: {
            content: {
              ...created.content,
              skills: Array.from({ length: 51 }, (_, index) => ({ name: `Skill ${index}` })),
            },
          },
        });

        expect(tooMany.status).toBe(422);
        expect(await tooMany.json()).toEqual({ error: "Invalid résumé content" });

        const failing = createApp(
          webOrigin,
          {
            ...repos,
            resumes: {
              ...repos.resumes,
              updateBaseContent: () => Promise.reject(new Error("db down")),
            },
          },
          appOptions,
        );

        const crashed = await request(failing, id, "/me/resume", {
          method: "PATCH",
          json: { content: created.content },
        });

        expect(crashed.status).toBe(500);
      });

      it("guards the résumé routes", async () => {
        const { instance } = resumesApp();
        const id = await profile();

        expect((await request(instance, id, "/me/resume", { session: "admin" })).status).toBe(403);
        expect((await request(instance, id, "/me/resume", { session: "anonymous" })).status).toBe(
          401,
        );

        const subscription = await repos.billing.getSubscription();

        if (!subscription) throw new Error("missing subscription");

        await repos.billing.updateSubscription(subscription.id, { status: "canceled" });

        expect((await upload(instance, id)).status).toBe(402);
        expect((await request(instance, id, "/me/export")).status).toBe(200);
      });

      function scoreJobs() {
        return db
          .select({
            subject: backgroundJobs.subject,
            status: backgroundJobs.status,
            attempts: backgroundJobs.attempts,
            runAfter: backgroundJobs.runAfter,
            lastError: backgroundJobs.lastError,
          })
          .from(backgroundJobs)
          .where(eq(backgroundJobs.kind, "score_resume"))
          .orderBy(backgroundJobs.createdAt);
      }

      async function scoredResume() {
        const app = resumesApp();
        const id = await profile();
        const created = await (await upload(app.instance, id)).json();
        const bullet = created.content.experiences[0].bullets[0];

        app.scoring.output = {
          score: 72,
          suggestions: [
            {
              targetNodeId: bullet.id,
              suggestedText: "Reduziu o tempo de deploy com X",
              rationale: "Mostra o impacto",
              estimatedGain: 6,
            },
            {
              targetNodeId: created.content.headline.id,
              suggestedText: "Engenheira de Software Sênior",
              rationale: "Destaca a senioridade",
              estimatedGain: 4,
            },
          ],
        };

        await app.settle();

        const suggestions = await (
          await request(app.instance, id, "/me/resume/suggestions")
        ).json();

        return { ...app, id, created, bullet, suggestions };
      }

      it("scores an uploaded résumé in the background and lists its suggestions", async () => {
        const { instance, id, created, bullet, suggestions, scoring } = await scoredResume();

        expect(scoring.calls).toBe(1);
        expect(await scoreJobs()).toMatchObject([{ subject: created.id, status: "done" }]);
        expect(await (await request(instance, id, "/me/resume")).json()).toMatchObject({
          id: created.id,
          score: 72,
          scoredAt: expect.any(String),
        });
        expect(suggestions).toEqual([
          {
            id: expect.any(String),
            targetNodeId: bullet.id,
            originalText: "Fez X",
            suggestedText: "Reduziu o tempo de deploy com X",
            rationale: "Mostra o impacto",
            estimatedGain: 6,
          },
          {
            id: expect.any(String),
            targetNodeId: created.content.headline.id,
            originalText: "Engenheira de Software",
            suggestedText: "Engenheira de Software Sênior",
            rationale: "Destaca a senioridade",
            estimatedGain: 4,
          },
        ]);
      });

      it("enqueues one score job per change and kicks a drain after each", async () => {
        const app = resumesApp();
        const id = await profile();
        const created = await (await upload(app.instance, id)).json();

        expect(await scoreJobs()).toMatchObject([{ subject: created.id, status: "pending" }]);

        const patched = await request(app.instance, id, "/me/resume", {
          method: "PATCH",
          json: { content: created.content },
        });

        expect(patched.status).toBe(200);
        expect(await scoreJobs()).toHaveLength(1);

        await app.settle();

        expect(app.scoring.calls).toBe(1);
        expect(await scoreJobs()).toMatchObject([{ status: "done" }]);
      });

      it("applies a suggestion and scores the new text", async () => {
        const { instance, id, bullet, suggestions, settle } = await scoredResume();

        expect(
          (
            await request(instance, id, "/me/resume/suggestions/not-a-uuid/apply", {
              method: "POST",
            })
          ).status,
        ).toBe(422);

        const missing = await request(
          instance,
          id,
          `/me/resume/suggestions/${crypto.randomUUID()}/apply`,
          { method: "POST" },
        );

        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: "Suggestion not found" });

        const applied = await request(
          instance,
          id,
          `/me/resume/suggestions/${suggestions[0].id}/apply`,
          { method: "POST" },
        );

        expect(applied.status).toBe(200);

        const resume = await applied.json();

        expect(resume.score).toBeNull();
        expect(resume.content.experiences[0].bullets[0]).toEqual({
          id: bullet.id,
          text: "Reduziu o tempo de deploy com X",
        });
        expect(await scoreJobs()).toMatchObject([
          { status: "done" },
          { subject: resume.id, status: "pending" },
        ]);
        expect(await matchJobs()).toMatchObject([
          { subject: id, status: "done" },
          { subject: id, status: "pending" },
        ]);
        expect(
          (await (await request(instance, id, "/me/resume/suggestions")).json()).map(
            (suggestion: { id: string }) => suggestion.id,
          ),
        ).toEqual([suggestions[1].id]);

        await settle();

        expect(await (await request(instance, id, "/me/resume")).json()).toMatchObject({
          score: 72,
        });
      });

      it("refuses to apply a suggestion whose text was edited", async () => {
        const { instance, id, created, suggestions } = await scoredResume();

        const edited = await request(instance, id, "/me/resume", {
          method: "PATCH",
          json: {
            content: {
              ...created.content,
              experiences: [
                {
                  ...created.content.experiences[0],
                  bullets: [{ ...created.content.experiences[0].bullets[0], text: "Fez Y" }],
                },
              ],
            },
          },
        });

        expect(edited.status).toBe(200);
        expect(
          (await (await request(instance, id, "/me/resume/suggestions")).json()).map(
            (suggestion: { id: string }) => suggestion.id,
          ),
        ).toEqual([suggestions[1].id]);

        const pending = await scoreJobs();

        const stale = await request(
          instance,
          id,
          `/me/resume/suggestions/${suggestions[0].id}/apply`,
          { method: "POST" },
        );

        expect(stale.status).toBe(409);
        expect(await stale.json()).toEqual({ error: "Résumé changed since this suggestion" });
        expect(await (await request(instance, id, "/me/resume")).json()).toEqual(
          await edited.json(),
        );
        expect(await scoreJobs()).toEqual(pending);
      });

      it("dismisses a suggestion", async () => {
        const { instance, id, suggestions } = await scoredResume();
        const path = `/me/resume/suggestions/${suggestions[0].id}/dismiss`;

        expect(
          (
            await request(instance, id, "/me/resume/suggestions/not-a-uuid/dismiss", {
              method: "POST",
            })
          ).status,
        ).toBe(422);

        const dismissed = await request(instance, id, path, { method: "POST" });

        expect(dismissed.status).toBe(204);
        expect(
          (await (await request(instance, id, "/me/resume/suggestions")).json()).map(
            (suggestion: { id: string }) => suggestion.id,
          ),
        ).toEqual([suggestions[1].id]);

        const again = await request(instance, id, path, { method: "POST" });

        expect(again.status).toBe(404);
        expect(await again.json()).toEqual({ error: "Suggestion not found" });
      });

      it("hides suggestions from another profile", async () => {
        const { instance, suggestions } = await scoredResume();
        const other = await profile("outra.pessoal@example.com", 1);

        expect(await (await request(instance, other, "/me/resume/suggestions")).json()).toEqual([]);

        for (const action of ["apply", "dismiss"]) {
          const res = await request(
            instance,
            other,
            `/me/resume/suggestions/${suggestions[0].id}/${action}`,
            { method: "POST" },
          );

          expect(res.status).toBe(404);
        }

        expect(
          (await request(instance, other, "/me/resume/suggestions", { session: "admin" })).status,
        ).toBe(403);
      });

      it("postpones scoring over the daily cap without calling the model", async () => {
        const app = resumesApp();
        const id = await profile();

        for (let call = 0; call < 30; call += 1) {
          await repos.llmUsage.takeLlmCall(id, new Date());
        }

        await upload(app.instance, id);
        await app.settle();

        const [job] = await scoreJobs();

        expect(app.scoring.calls).toBe(0);
        expect(job).toMatchObject({ status: "pending", attempts: 0, lastError: null });
        expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
        expect((await (await request(app.instance, id, "/me/resume")).json()).score).toBeNull();
      });

      it("retries scoring when the AI is not configured", async () => {
        const id = await profile();
        const created = await (await upload(resumesApp().instance, id)).json();
        const unconfigured = resumesApp({ generate: null });

        await request(unconfigured.instance, id, "/me/resume", {
          method: "PATCH",
          json: { content: created.content },
        });
        await unconfigured.settle();

        expect(await scoreJobs()).toMatchObject([
          { status: "pending", attempts: 1, lastError: "Error: AI not configured" },
        ]);
        expect(await matchJobs()).toMatchObject([
          { status: "pending", attempts: 1, lastError: "Error: AI not configured" },
        ]);
        expect(await db.select().from(llmUsage).where(eq(llmUsage.profileId, id))).toEqual([]);
      });

      it("completes an already scored résumé without calling the model", async () => {
        const { instance, id, created, scoring } = await scoredResume();
        const usage = () => db.select().from(llmUsage).where(eq(llmUsage.profileId, id));
        const before = await usage();

        await repos.background.enqueue("score_resume", created.id);

        const drained = await instance.handle(
          new Request("http://localhost/api/background/drain", {
            method: "POST",
            headers: { authorization: `Bearer ${cronSecret}` },
          }),
        );

        expect(await drained.json()).toEqual({ processed: 1, failed: 0 });
        expect(scoring.calls).toBe(1);
        expect(await usage()).toEqual(before);
        expect(before).toMatchObject([{ calls: 1 }]);
        expect(await scoreJobs()).toMatchObject([{ status: "done" }, { status: "done" }]);
      });

      it("kicks only the score of the edited résumé, leaving older jobs to the cron", async () => {
        const app = resumesApp();
        const id = await profile();
        const other = await profile("outra.pessoal@example.com", 1);
        const created = await (await upload(app.instance, id)).json();

        await app.settle();

        const past = new Date(Date.now() - 60_000);
        const backlog = crypto.randomUUID();

        await repos.background.enqueue("compute_matches", id, {}, past);
        await repos.background.enqueue("compute_matches", other, {}, past);
        await repos.background.enqueue("score_resume", backlog, {}, past);

        await request(app.instance, id, "/me/resume", {
          method: "PATCH",
          json: { content: created.content },
        });

        expect(await app.kicks()).toBe(1);
        expect(app.scoring.calls).toBe(2);
        expect(
          (
            await db
              .select({
                kind: backgroundJobs.kind,
                subject: backgroundJobs.subject,
                status: backgroundJobs.status,
              })
              .from(backgroundJobs)
              .where(eq(backgroundJobs.status, "pending"))
          )
            .map((job) => `${job.kind}:${job.subject}`)
            .sort(),
        ).toEqual(
          [`compute_matches:${id}`, `compute_matches:${other}`, `score_resume:${backlog}`].sort(),
        );
        expect(await scoreJobs()).toMatchObject([
          { subject: created.id, status: "done" },
          { subject: backlog, status: "pending" },
          { subject: created.id, status: "done" },
        ]);
      });

      it("keeps a saved résumé when enqueueing its score fails", async () => {
        const instance = createApp(
          webOrigin,
          {
            ...repos,
            background: {
              ...repos.background,
              enqueue: () => Promise.reject(new Error("queue down")),
            },
          },
          {
            ...appOptions,
            generateStructured: async ({ schema }) => schema.parse(draft),
            storage: {
              put: async () => undefined,
              remove: async () => undefined,
              removePrefix: async () => undefined,
            },
            runInBackground: () => {
              throw new Error("should not kick a drain");
            },
          },
        );

        const id = await profile();
        const uploaded = await upload(instance, id);

        expect(uploaded.status).toBe(200);
        expect(await request(instance, id, "/me/resume").then((res) => res.json())).toEqual(
          await uploaded.json(),
        );
        expect(await scoreJobs()).toEqual([]);
      });

      it("drains due jobs from the cron route", async () => {
        const { instance } = resumesApp();

        await repos.background.enqueue("score_resume", crypto.randomUUID());

        const drainRequest = (method: string, authorization?: string) =>
          new Request("http://localhost/api/background/drain", {
            method,
            headers: authorization ? { authorization } : {},
          });

        expect((await instance.handle(drainRequest("GET"))).status).toBe(401);
        expect(
          (await instance.handle(drainRequest("POST", "Bearer test-cron-wrong!"))).status,
        ).toBe(401);
        expect(
          (
            await createApp(webOrigin, repos, { auth, sendEmail }).handle(
              drainRequest("GET", `Bearer ${cronSecret}`),
            )
          ).status,
        ).toBe(401);

        const drained = await instance.handle(drainRequest("POST", `Bearer ${cronSecret}`));

        expect(drained.status).toBe(200);
        expect(await drained.json()).toEqual({ processed: 1, failed: 0 });
        expect(await scoreJobs()).toMatchObject([{ status: "done" }]);

        const idle = await instance.handle(drainRequest("GET", `Bearer ${cronSecret}`));

        expect(idle.status).toBe(200);
        expect(await idle.json()).toEqual({ processed: 0, failed: 0 });
      });

      it("swallows a background drain that fails", async () => {
        let claims = 0;

        const instance = createApp(
          webOrigin,
          {
            ...repos,
            background: {
              ...repos.background,
              claim: () => {
                claims += 1;

                return Promise.reject(new Error("queue down"));
              },
            },
          },
          {
            auth,
            sendEmail,
            generateStructured: async ({ schema }) => schema.parse(draft),
            storage: {
              put: async () => undefined,
              remove: async () => undefined,
              removePrefix: async () => undefined,
            },
          },
        );

        expect((await upload(instance, await profile())).status).toBe(200);
        await vi.waitFor(() => expect(claims).toBe(1));
      });

      function matchJobs() {
        return db
          .select({
            subject: backgroundJobs.subject,
            status: backgroundJobs.status,
            attempts: backgroundJobs.attempts,
            runAfter: backgroundJobs.runAfter,
            lastError: backgroundJobs.lastError,
          })
          .from(backgroundJobs)
          .where(eq(backgroundJobs.kind, "compute_matches"))
          .orderBy(backgroundJobs.createdAt);
      }

      function storedMatches(profileId: string) {
        return db.select().from(jobMatches).where(eq(jobMatches.profileId, profileId));
      }

      async function openJobs(titles: string[]) {
        await db.insert(jobs).values(
          titles.map(
            (title, index) =>
              ({
                origin: "external",
                source: "seed",
                sourceKey: `match-${index}`,
                title,
                company: "Acme",
                description: `Vaga de ${title}`,
                url: `https://jobs.example.com/match-${index}`,
                postedAt: new Date(Date.UTC(2026, 0, 31 - index)),
              }) satisfies typeof jobs.$inferInsert,
          ),
        );
      }

      async function listedMatches(
        instance: ReturnType<typeof resumesApp>["instance"],
        talentId: string,
      ) {
        const listed = await (await request(instance, talentId, "/me/jobs")).json();

        return listed.items.map((item: { title: string; match: { score: number } | null }) => [
          item.title,
          item.match?.score ?? null,
        ]);
      }

      it("lists jobs by match score after an upload", async () => {
        const app = resumesApp();
        const id = await profile();

        await openJobs(["Engenheira de Software", "Designer", "Analista de Dados"]);
        app.matching.scores = {
          "Engenheira de Software": 40,
          Designer: 90,
          "Analista de Dados": 70,
        };

        await upload(app.instance, id);
        await app.settle();

        expect(app.matching.batches).toHaveLength(1);
        expect(await matchJobs()).toMatchObject([{ subject: id, status: "done" }]);
        expect(await listedMatches(app.instance, id)).toEqual([
          ["Designer", 90],
          ["Analista de Dados", 70],
          ["Engenheira de Software", 40],
        ]);
        expect((await (await request(app.instance, id, "/me/jobs")).json()).items[0].match).toEqual(
          { score: 90, reasons: ["Combina com Designer"] },
        );
      });

      it("hides matches of an edited résumé until they are recomputed", async () => {
        const app = resumesApp();
        const id = await profile();

        await openJobs(["Engenheira de Software", "Designer"]);
        app.matching.scores = { "Engenheira de Software": 30, Designer: 80 };

        const created = await (await upload(app.instance, id)).json();

        await app.settle();

        const edited = await request(app.instance, id, "/me/resume", {
          method: "PATCH",
          json: {
            content: {
              ...created.content,
              headline: { ...created.content.headline, text: "Designer" },
            },
          },
        });

        expect(edited.status).toBe(200);
        expect(await listedMatches(app.instance, id)).toEqual([
          ["Engenheira de Software", null],
          ["Designer", null],
        ]);
        expect(await matchJobs()).toMatchObject([{ status: "done" }, { status: "pending" }]);

        await app.settle();

        expect(app.matching.batches).toHaveLength(2);
        expect(await listedMatches(app.instance, id)).toEqual([
          ["Designer", 80],
          ["Engenheira de Software", 30],
        ]);
      });

      it("postpones matching at the daily cap", async () => {
        const app = resumesApp();
        const id = await profile();

        const usage = () =>
          db.select({ calls: llmUsage.calls }).from(llmUsage).where(eq(llmUsage.profileId, id));

        await upload(app.instance, id);
        await app.settle();

        expect(await usage()).toEqual([{ calls: 1 }]);

        await openJobs(Array.from({ length: 25 }, (_, index) => `Vaga ${index}`));
        await db.update(llmUsage).set({ calls: 29 }).where(eq(llmUsage.profileId, id));
        await repos.background.enqueue("compute_matches", id);
        await app.settle();

        const day = new Date(Date.now() - 3 * 60 * 60_000).toISOString().slice(0, 10);
        const [, postponed] = await matchJobs();

        expect(app.matching.batches.map((batch) => batch.length)).toEqual([10]);
        expect(await usage()).toEqual([{ calls: 30 }]);
        expect(await storedMatches(id)).toHaveLength(10);
        expect(postponed).toMatchObject({
          subject: id,
          status: "pending",
          attempts: 0,
          lastError: null,
        });
        expect(postponed.runAfter.getTime()).toBe(
          Date.parse(`${day}T03:00:00.000Z`) + 24 * 60 * 60_000,
        );

        await db.update(llmUsage).set({ calls: 0 }).where(eq(llmUsage.profileId, id));
        await db
          .update(backgroundJobs)
          .set({ runAfter: new Date() })
          .where(
            and(eq(backgroundJobs.kind, "compute_matches"), eq(backgroundJobs.status, "pending")),
          );
        await app.settle();

        expect(app.matching.batches.map((batch) => batch.length)).toEqual([10, 10, 5]);
        expect(new Set(app.matching.batches.flat()).size).toBe(25);
        expect(await usage()).toEqual([{ calls: 2 }]);
        expect(await storedMatches(id)).toHaveLength(25);
        expect((await matchJobs()).map((job) => job.status)).toEqual(["done", "done"]);
      });

      it("stops matching when the résumé changes during a run", async () => {
        const app = resumesApp();
        const id = await profile();

        await openJobs(Array.from({ length: 15 }, (_, index) => `Vaga ${index}`));

        const created = await (await upload(app.instance, id)).json();

        app.matching.before = async () => {
          await repos.resumes.updateBaseContent(id, created.content);
        };

        await app.settle();

        expect(app.matching.batches).toHaveLength(1);
        expect(await storedMatches(id)).toEqual([]);
        expect(await matchJobs()).toMatchObject([{ status: "done" }]);
      });

      it("completes matching for a profile without a base résumé", async () => {
        const app = resumesApp();

        await openJobs(["Designer"]);
        await repos.background.enqueue("compute_matches", crypto.randomUUID());
        await app.settle();

        expect(app.matching.batches).toEqual([]);
        expect(await matchJobs()).toMatchObject([{ status: "done", attempts: 1 }]);
      });

      it("enqueues matching when enqueueing the score fails", async () => {
        let kicks = 0;

        const instance = createApp(
          webOrigin,
          {
            ...repos,
            background: {
              ...repos.background,
              enqueue: (kind, ...rest) =>
                kind === "score_resume"
                  ? Promise.reject(new Error("queue down"))
                  : repos.background.enqueue(kind, ...rest),
            },
          },
          {
            ...appOptions,
            generateStructured: async ({ schema }) => schema.parse(draft),
            storage: {
              put: async () => undefined,
              remove: async () => undefined,
              removePrefix: async () => undefined,
            },
            runInBackground: () => {
              kicks += 1;
            },
          },
        );

        const id = await profile();

        expect((await upload(instance, id)).status).toBe(200);
        expect(kicks).toBe(0);
        expect(await scoreJobs()).toEqual([]);
        expect(await matchJobs()).toMatchObject([{ subject: id, status: "pending" }]);
      });

      describe("tailored résumés", () => {
        const emptyTailoring = {
          rewrites: [],
          experienceOrder: [],
          bulletOrder: [],
          skillIds: [],
        };

        async function openJob(sourceKey: string, closedAt?: Date) {
          const [job] = await db
            .insert(jobs)
            .values({
              origin: "external",
              source: "seed",
              sourceKey,
              title: "Backend",
              company: "Acme",
              description: "Vaga de backend",
              url: `https://jobs.example.com/${sourceKey}`,
              closedAt,
            })
            .returning({ id: jobs.id });

          return job.id;
        }

        function usage(profileId: string) {
          return db
            .select({ calls: llmUsage.calls })
            .from(llmUsage)
            .where(eq(llmUsage.profileId, profileId));
        }

        function tailoredRows(profileId: string) {
          return db
            .select({
              id: resumes.id,
              jobId: resumes.jobId,
              status: resumes.status,
              content: resumes.content,
              matchScore: resumes.matchScore,
              updatedAt: resumes.updatedAt,
            })
            .from(resumes)
            .where(and(eq(resumes.profileId, profileId), eq(resumes.kind, "tailored")));
        }

        async function tailoringApp(email = personalEmail, caseIndex = 0) {
          const app = resumesApp();
          const id = await profile(email, caseIndex);
          const base = await (await upload(app.instance, id)).json();

          await app.settle();

          app.tailoring.output = {
            ...emptyTailoring,
            rewrites: [{ nodeId: base.content.headline.id, text: "Engenheira Backend" }],
          };
          app.matching.scores = { Backend: 88 };
          app.calls.length = 0;

          const call = (
            path: string,
            init: { method?: string; json?: unknown; session?: string } = {},
            talentId = id,
          ) => request(app.instance, talentId, path, init);

          const tailor = (jobId: string, talentId = id) =>
            call(`/me/jobs/${jobId}/tailor`, { method: "POST" }, talentId);

          const ready = (versionId: string, talentId = id) =>
            call(`/me/resumes/${versionId}/ready`, { method: "POST" }, talentId);

          const apply = (jobId: string, resumeId: string, talentId = id) =>
            call(`/me/jobs/${jobId}/apply`, { method: "POST", json: { resumeId } }, talentId);

          return { app, id, base, call, tailor, ready, apply };
        }

        it("tailors a résumé for a job, edits it and applies with it once ready", async () => {
          const jobId = await openJob("fluxo");
          const { app, id, base, call, tailor, ready, apply } = await tailoringApp();
          const queued = await db.select().from(backgroundJobs);
          const [before] = await usage(id);

          const tailored = await tailor(jobId);

          expect(tailored.status).toBe(200);

          const body = await tailored.json();

          const headlineDiff = {
            nodeId: base.content.headline.id,
            kind: "headline",
            before: "Engenheira de Software",
            after: "Engenheira Backend",
          };

          expect(body).toEqual({
            version: {
              id: expect.any(String),
              job: { id: jobId, title: "Backend", company: "Acme" },
              status: "draft",
              matchScore: 88,
              content: {
                ...base.content,
                headline: { ...base.content.headline, text: "Engenheira Backend" },
              },
              application: null,
              updatedAt: expect.any(String),
            },
            diff: [headlineDiff],
          });
          expect(app.calls.map((modelCall) => modelCall.kind)).toEqual(["tailor", "match"]);
          expect(app.calls[1].prompt).toContain("Engenheira Backend");
          expect(await usage(id)).toEqual([{ calls: before.calls + 2 }]);

          const versionId = body.version.id;

          expect(await (await call("/me/resumes")).json()).toEqual([body.version]);
          expect(await (await call(`/me/resumes/${versionId}`)).json()).toEqual(body);

          const marked = await ready(versionId);

          expect(marked.status).toBe(200);
          expect(await marked.json()).toMatchObject({ id: versionId, status: "ready" });

          const edited = await call(`/me/resumes/${versionId}`, {
            method: "PATCH",
            json: {
              content: {
                ...body.version.content,
                experiences: [
                  {
                    ...body.version.content.experiences[0],
                    bullets: [
                      ...body.version.content.experiences[0].bullets,
                      { text: "Escreveu testes" },
                    ],
                  },
                ],
              },
            },
          });

          expect(edited.status).toBe(200);

          const editedBody = await edited.json();
          const added = editedBody.version.content.experiences[0].bullets[1];

          expect(editedBody.version).toMatchObject({
            id: versionId,
            status: "draft",
            matchScore: 88,
          });
          expect(added).toEqual({ id: expect.any(String), text: "Escreveu testes" });
          expect(editedBody.diff).toEqual([
            headlineDiff,
            { nodeId: added.id, kind: "bullet", before: "", after: "Escreveu testes" },
          ]);
          expect((await ready(versionId)).status).toBe(200);
          expect(await db.select().from(backgroundJobs)).toEqual(queued);

          const applied = await apply(jobId, versionId);

          expect(applied.status).toBe(201);

          const { applicationId } = await applied.json();

          expect(await (await call("/me/resumes")).json()).toEqual([
            expect.objectContaining({
              id: versionId,
              status: "ready",
              application: { id: applicationId, status: "sent", appliedAt: expect.any(String) },
            }),
          ]);

          const locked = await call(`/me/resumes/${versionId}`, {
            method: "PATCH",
            json: { content: base.content },
          });

          expect(locked.status).toBe(409);
          expect(await locked.json()).toEqual({ error: "Already applied with this version" });
        });

        it("refuses to tailor for a job already applied to without spending AI calls", async () => {
          const jobId = await openJob("usada");
          const baseJobId = await openJob("usada-base");
          const { app, id, base, tailor, ready, apply } = await tailoringApp();
          const { version } = await (await tailor(jobId)).json();

          await ready(version.id);
          expect((await apply(jobId, version.id)).status).toBe(201);
          expect((await apply(baseJobId, base.id)).status).toBe(201);

          const [stored] = await tailoredRows(id);
          const [before] = await usage(id);

          app.tailoring.output = {
            ...emptyTailoring,
            rewrites: [{ nodeId: base.content.headline.id, text: "Outra versão" }],
          };
          app.calls.length = 0;

          for (const appliedJobId of [jobId, baseJobId]) {
            const again = await tailor(appliedJobId);

            expect(again.status).toBe(409);
            expect(await again.json()).toEqual({ error: "Already applied" });
          }

          expect(app.calls).toEqual([]);
          expect(await usage(id)).toEqual([before]);
          expect(await tailoredRows(id)).toEqual([stored]);
          expect(stored).toMatchObject({ status: "ready", matchScore: 88 });
        });

        it("refuses to replace a version used by an application sent while tailoring", async () => {
          const jobId = await openJob("corrida");
          const { app, id, base, tailor, ready, apply } = await tailoringApp();
          const { version } = await (await tailor(jobId)).json();

          await ready(version.id);

          const [stored] = await tailoredRows(id);
          const sent: number[] = [];

          app.tailoring.output = {
            ...emptyTailoring,
            rewrites: [{ nodeId: base.content.headline.id, text: "Outra versão" }],
          };
          app.matching.before = async () => {
            sent.push((await apply(jobId, version.id)).status);
          };

          const raced = await tailor(jobId);

          expect(sent).toEqual([201]);
          expect(raced.status).toBe(409);
          expect(await raced.json()).toEqual({ error: "Already applied with this version" });
          expect(await tailoredRows(id)).toEqual([stored]);
        });

        it("requires a ready résumé for this job", async () => {
          const jobId = await openJob("pronta");
          const otherJobId = await openJob("outra");
          const { id, tailor, ready, apply } = await tailoringApp();
          const other = await tailoringApp("outra.pessoal@example.com", 1);

          const { version: draftVersion } = await (await tailor(jobId)).json();
          const { version: otherJobVersion } = await (await tailor(otherJobId)).json();
          const { version: foreignVersion } = await (await other.tailor(jobId)).json();

          await ready(otherJobVersion.id);
          await other.ready(foreignVersion.id);

          for (const resumeId of [
            draftVersion.id,
            otherJobVersion.id,
            foreignVersion.id,
            other.base.id,
          ]) {
            const refused = await apply(jobId, resumeId);

            expect(refused.status).toBe(422);
            expect(await refused.json()).toEqual({ error: "Résumé not ready for this job" });
          }

          expect(await db.select().from(applications)).toEqual([]);
          expect(await tailoredRows(id)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: draftVersion.id, status: "draft" }),
            ]),
          );

          await ready(draftVersion.id);

          expect((await apply(jobId, draftVersion.id)).status).toBe(201);
        });

        it("writes nothing when the cap is hit mid-tailoring", async () => {
          const jobId = await openJob("teto");
          const { app, id, base, tailor } = await tailoringApp();

          await db.update(llmUsage).set({ calls: 29 }).where(eq(llmUsage.profileId, id));

          const capped = await tailor(jobId);

          expect(capped.status).toBe(429);
          expect(await capped.json()).toEqual({ error: "Daily AI limit reached" });
          expect(app.calls.map((modelCall) => modelCall.kind)).toEqual(["tailor"]);
          expect(await usage(id)).toEqual([{ calls: 30 }]);
          expect(await tailoredRows(id)).toEqual([]);

          app.calls.length = 0;

          const exhausted = await tailor(jobId);

          expect(exhausted.status).toBe(429);
          expect(app.calls).toEqual([]);

          await db.update(llmUsage).set({ calls: 0 }).where(eq(llmUsage.profileId, id));

          expect((await tailor(jobId)).status).toBe(200);

          const [saved] = await tailoredRows(id);

          await db.update(llmUsage).set({ calls: 29 }).where(eq(llmUsage.profileId, id));
          app.tailoring.output = {
            ...emptyTailoring,
            rewrites: [{ nodeId: base.content.headline.id, text: "Outra versão" }],
          };
          app.matching.scores = { Backend: 10 };
          app.calls.length = 0;

          expect((await tailor(jobId)).status).toBe(429);
          expect(app.calls.map((modelCall) => modelCall.kind)).toEqual(["tailor"]);
          expect(await tailoredRows(id)).toEqual([saved]);
          expect(saved).toMatchObject({ status: "draft", matchScore: 88 });
        });

        it("checks the base, the job, the AI and the cap in order", async () => {
          const { app, id, tailor } = await tailoringApp();
          const jobId = await openJob("ordem");
          const closedId = await openJob("fechada", new Date());
          const unconfigured = resumesApp({ generate: null });
          const bare = await profile("sem.curriculo@example.com", 1);

          const noBase = await tailor(crypto.randomUUID(), bare);

          expect(noBase.status).toBe(409);
          expect(await noBase.json()).toEqual({ error: "Upload a résumé first" });

          for (const missing of [crypto.randomUUID(), closedId]) {
            const notFound = await request(
              unconfigured.instance,
              id,
              `/me/jobs/${missing}/tailor`,
              {
                method: "POST",
              },
            );

            expect(notFound.status).toBe(404);
            expect(await notFound.json()).toEqual({ error: "Job not found" });
          }

          await db.update(llmUsage).set({ calls: 30 }).where(eq(llmUsage.profileId, id));

          const noAi = await request(unconfigured.instance, id, `/me/jobs/${jobId}/tailor`, {
            method: "POST",
          });

          expect(noAi.status).toBe(503);
          expect(await noAi.json()).toEqual({ error: "AI not configured" });
          expect(await usage(id)).toEqual([{ calls: 30 }]);
          expect((await tailor("not-a-uuid")).status).toBe(422);
          expect(
            (
              await request(app.instance, id, `/me/jobs/${jobId}/tailor`, {
                method: "POST",
                session: "admin",
              })
            ).status,
          ).toBe(403);
          expect(app.calls).toEqual([]);
        });

        it("answers a failed model call without writing a version", async () => {
          const jobId = await openJob("falha");
          const { app, id, tailor } = await tailoringApp();
          const [before] = await usage(id);
          const logged = vi.spyOn(console, "error");

          app.tailoring.fail = true;

          const tailorFailed = await tailor(jobId);

          expect(tailorFailed.status).toBe(502);
          expect(await tailorFailed.json()).toEqual({ error: "Could not tailor the résumé" });
          expect(await usage(id)).toEqual([{ calls: before.calls + 1 }]);

          app.tailoring.fail = false;
          app.matching.fail = true;

          const matchFailed = await tailor(jobId);

          expect(matchFailed.status).toBe(502);
          expect(await matchFailed.json()).toEqual({ error: "Could not tailor the résumé" });
          expect(await usage(id)).toEqual([{ calls: before.calls + 3 }]);
          expect(app.calls.map((modelCall) => modelCall.kind)).toEqual([
            "tailor",
            "tailor",
            "match",
          ]);
          expect(await tailoredRows(id)).toEqual([]);
          expect(logged.mock.calls).toEqual([
            ["résumé tailoring failed", { name: "Error", message: "gateway down" }],
            ["résumé fit scoring failed", { name: "Error", message: "gateway down" }],
          ]);
          logged.mockRestore();

          app.matching.fail = false;
          app.matching.omit = true;

          const unscored = await tailor(jobId);

          expect(unscored.status).toBe(200);
          expect((await unscored.json()).version.matchScore).toBeNull();
        });

        it("lists jobs with a tailored version present", async () => {
          const jobId = await openJob("lista");
          const { app, id, tailor } = await tailoringApp();

          expect(await listedMatches(app.instance, id)).toEqual([["Backend", 50]]);
          expect((await tailor(jobId)).status).toBe(200);

          const queued = await db.select().from(backgroundJobs);

          await app.settle();

          expect(await listedMatches(app.instance, id)).toEqual([["Backend", 50]]);
          expect(await db.select().from(backgroundJobs)).toEqual(queued);
          expect(app.matching.batches).toEqual([["Backend"], ["Backend"]]);
        });

        it("reads and edits only the profile's own tailored versions", async () => {
          const jobId = await openJob("leitura");
          const { id, base, call, tailor, ready } = await tailoringApp();
          const other = await tailoringApp("outra.pessoal@example.com", 1);
          const { version } = await (await tailor(jobId)).json();
          const { version: foreign } = await (await other.tailor(jobId)).json();

          const edit = (versionId: string, body: { content: object }) =>
            call(`/me/resumes/${versionId}`, { method: "PATCH", json: body });

          for (const missing of [foreign.id, base.id, crypto.randomUUID()]) {
            const read = await call(`/me/resumes/${missing}`);

            expect(read.status).toBe(404);
            expect(await read.json()).toEqual({ error: "Résumé version not found" });
            expect((await edit(missing, { content: base.content })).status).toBe(404);
            expect((await ready(missing)).status).toBe(404);
          }

          for (const path of ["/me/resumes/not-a-uuid", "/me/resumes/not-a-uuid/ready"]) {
            expect(
              (await call(path, { method: path.endsWith("ready") ? "POST" : "GET" })).status,
            ).toBe(422);
          }

          const invalid = await edit(version.id, {
            content: { ...version.content, headline: { text: "x".repeat(2_001) } },
          });

          expect(invalid.status).toBe(422);
          expect(await invalid.json()).toEqual({ error: "Invalid résumé content" });

          const malformed = await edit(version.id, { content: { headline: 1 } });

          expect(malformed.status).toBe(422);
          expect(await malformed.json()).toEqual({ error: "Invalid résumé content" });

          const duplicated = await edit(version.id, {
            content: { ...version.content, summary: { ...version.content.headline } },
          });

          expect(duplicated.status).toBe(422);
          expect(await duplicated.json()).toEqual({ error: "Duplicate node ids" });
          expect(await tailoredRows(id)).toEqual([
            expect.objectContaining({ content: version.content }),
          ]);
          expect((await call("/me/resumes", { session: "admin" })).status).toBe(403);
          expect(await (await other.call("/me/resumes")).json()).toEqual([foreign]);

          await db.delete(resumes).where(and(eq(resumes.profileId, id), eq(resumes.kind, "base")));

          expect(await (await call(`/me/resumes/${version.id}`)).json()).toEqual({
            version,
            diff: [],
          });

          const edited = await edit(version.id, { content: version.content });

          expect(edited.status).toBe(200);
          expect((await edited.json()).diff).toEqual([]);

          const tailorWithoutBase = await tailor(jobId);

          expect(tailorWithoutBase.status).toBe(409);
        });

        it("answers 500 when saving an edited version fails", async () => {
          const jobId = await openJob("quebra");
          const { id, tailor } = await tailoringApp();
          const { version } = await (await tailor(jobId)).json();

          const failing = createApp(
            webOrigin,
            {
              ...repos,
              resumeVersions: {
                ...repos.resumeVersions,
                update: () => Promise.reject(new Error("db down")),
              },
            },
            appOptions,
          );

          const crashed = await request(failing, id, `/me/resumes/${version.id}`, {
            method: "PATCH",
            json: { content: version.content },
          });

          expect(crashed.status).toBe(500);
          expect(await tailoredRows(id)).toEqual([
            expect.objectContaining({ content: version.content }),
          ]);
        });
      });

      it("exports the person's data", async () => {
        const { instance, scoring, settle } = resumesApp();
        const id = await profile();
        const created = await (await upload(instance, id)).json();

        scoring.output = {
          score: 64,
          suggestions: [
            {
              targetNodeId: created.content.experiences[0].bullets[0].id,
              suggestedText: "Fez X com impacto",
              rationale: "Mostra o impacto",
              estimatedGain: 5,
            },
          ],
        };

        await settle();

        const [job] = await db
          .insert(jobs)
          .values({
            origin: "external",
            source: "seed",
            sourceKey: "export-job",
            title: "Backend",
            company: "Acme",
            url: "https://jobs.example.com/export-job",
          })
          .returning({ id: jobs.id });

        await repos.applications.apply(id, job.id, created.id);

        const [tailoredJob] = await db
          .insert(jobs)
          .values({
            origin: "external",
            source: "seed",
            sourceKey: "export-tailored",
            title: "Frontend",
            company: "Globex",
            url: "https://jobs.example.com/export-tailored",
          })
          .returning({ id: jobs.id });

        const version = await repos.resumeVersions.saveDraft(
          id,
          tailoredJob.id,
          created.content,
          77,
          new Date(),
        );

        if (version === "used") throw new Error(version);

        await repos.resumeVersions.markReady(id, version.id, new Date());
        await repos.applications.apply(id, tailoredJob.id, version.id);
        await db
          .update(applications)
          .set({ appliedAt: new Date("2026-01-01T00:00:00Z") })
          .where(eq(applications.jobId, job.id));
        await db
          .update(resumes)
          .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
          .where(eq(resumes.id, created.id));
        await db.insert(jobMatches).values({
          profileId: id,
          jobId: job.id,
          score: 81,
          reasons: ["Stack em comum"],
          resumeUpdatedAt: new Date("2026-01-01T00:00:00Z"),
          computedAt: new Date("2026-02-01T00:00:00Z"),
        });

        await db.insert(publicPages).values({
          profileId: id,
          slug: "export-page",
          enabled: true,
          resumeId: version.id,
          createdAt: new Date("2026-03-01T00:00:00Z"),
          updatedAt: new Date("2026-03-02T00:00:00Z"),
        });
        await db.insert(publicPageDailyViews).values([
          { profileId: id, day: "2026-03-03", visits: 4, recruiterVisits: 1 },
          { profileId: id, day: "2026-03-02", visits: 2, recruiterVisits: 0 },
        ]);

        const res = await request(instance, id, "/me/export");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-disposition")).toBe(
          'attachment; filename="offboard-dados.json"',
        );
        expect(res.headers.get("cache-control")).toBe("no-store");

        const body = await res.json();

        expect(body.profile).toEqual({
          name: expect.any(String),
          email: personalEmail,
          sponsoredUntil,
          termsAcceptedAt: expect.any(String),
          shareOutcomeWithHr: false,
          firstSignedInAt: null,
          createdAt: expect.any(String),
        });
        expect(body.resumes).toEqual([
          {
            kind: "base",
            status: "ready",
            content: expect.any(Object),
            score: 64,
            scoredAt: expect.any(String),
            updatedAt: expect.any(String),
            job: null,
            matchScore: null,
            suggestions: [
              {
                originalText: "Fez X",
                suggestedText: "Fez X com impacto",
                rationale: "Mostra o impacto",
                estimatedGain: 5,
                status: "open",
                createdAt: expect.any(String),
              },
            ],
          },
          {
            kind: "tailored",
            status: "ready",
            content: created.content,
            score: null,
            scoredAt: null,
            updatedAt: expect.any(String),
            job: {
              title: "Frontend",
              company: "Globex",
              url: "https://jobs.example.com/export-tailored",
            },
            matchScore: 77,
            suggestions: [],
          },
        ]);
        expect(body.applications).toEqual([
          expect.objectContaining({
            job: expect.objectContaining({ title: "Frontend" }),
            resume: { kind: "tailored", job: { title: "Frontend", company: "Globex" } },
          }),
          expect.objectContaining({
            job: expect.objectContaining({ title: "Backend" }),
            resume: { kind: "base", job: null },
          }),
        ]);
        expect(JSON.stringify(body)).not.toContain(version.id);
        expect(body.matches).toEqual([
          {
            job: { title: "Backend", company: "Acme", url: "https://jobs.example.com/export-job" },
            score: 81,
            reasons: ["Stack em comum"],
            computedAt: "2026-02-01T00:00:00.000Z",
          },
        ]);
        expect(body.page).toEqual({
          slug: "export-page",
          enabled: true,
          resume: { kind: "tailored", job: { title: "Frontend", company: "Globex" } },
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-02T00:00:00.000Z",
        });
        expect(body.pageViews).toEqual([
          { day: "2026-03-02", visits: 2, recruiterVisits: 0 },
          { day: "2026-03-03", visits: 4, recruiterVisits: 1 },
        ]);
        expect((await request(instance, id, "/me/export", { session: "admin" })).status).toBe(403);
      });

      it("answers 404 when the profile disappears during export", async () => {
        const instance = createApp(
          webOrigin,
          { ...repos, account: { ...repos.account, exportData: async () => undefined } },
          appOptions,
        );

        const res = await request(instance, await profile(), "/me/export");

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Profile not found" });
      });

      describe("preferences", () => {
        const emptyField = { value: null, share: false };

        const defaults = {
          mode: "review",
          hybridThreshold: 75,
          targetTitles: [],
          jobPreferences: {
            workModels: [],
            locations: [],
            relocate: false,
            salaryFloorCents: null,
            seniorities: [],
            excludedCompanies: [],
          },
          profileFields: {
            phone: emptyField,
            city: emptyField,
            linkedin: emptyField,
            portfolio: emptyField,
            workAuthorization: emptyField,
            availability: emptyField,
            noticePeriod: emptyField,
            salaryExpectation: emptyField,
          },
        };

        type PreferencesJson =
          | string
          | number
          | boolean
          | null
          | PreferencesJson[]
          | { [key: string]: PreferencesJson };

        const save = (
          instance: ReturnType<typeof resumesApp>["instance"],
          id: string,
          json: PreferencesJson,
        ) => request(instance, id, "/me/preferences", { method: "PUT", json });

        const matchJobs = () =>
          db
            .select({ subject: backgroundJobs.subject })
            .from(backgroundJobs)
            .where(eq(backgroundJobs.kind, "compute_matches"));

        it("requires an active talent session", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          expect(
            (await request(instance, id, "/me/preferences", { session: "admin" })).status,
          ).toBe(403);
          expect((await save(instance, id, { mode: "hybrid" })).status).toBe(200);
          expect(
            (await instance.handle(new Request("http://localhost/api/me/preferences"))).status,
          ).toBe(403);
        });

        it("returns full defaults before anything is saved", async () => {
          const { instance } = resumesApp();
          const res = await request(instance, await profile(), "/me/preferences");

          expect(res.status).toBe(200);
          expect(await res.json()).toEqual(defaults);
        });

        it("saves a partial update and keeps the rest", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          const first = await save(instance, id, { mode: "hybrid", hybridThreshold: 90 });

          expect(first.status).toBe(200);
          expect(await first.json()).toEqual({ ...defaults, mode: "hybrid", hybridThreshold: 90 });

          const second = await save(instance, id, {
            jobPreferences: {
              workModels: ["remote"],
              locations: [{ city: " Campinas ", state: "SP" }],
              excludedCompanies: ["Acme", "acme"],
            },
            profileFields: { phone: { value: " 11 90000-0000 ", share: true } },
          });

          const body = await second.json();

          expect(body.mode).toBe("hybrid");
          expect(body.jobPreferences).toEqual({
            ...defaults.jobPreferences,
            workModels: ["remote"],
            locations: [{ city: "Campinas", state: "SP" }],
            excludedCompanies: ["Acme"],
          });
          expect(body.profileFields.phone).toEqual({ value: "11 90000-0000", share: true });
          expect(await (await request(instance, id, "/me/preferences")).json()).toEqual(body);
        });

        it("rejects invalid input with one error body", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          const invalid: PreferencesJson[] = [
            {},
            { unknown: 1 },
            { mode: "manual" },
            { hybridThreshold: 49 },
            { hybridThreshold: "80" },
            { targetTitles: ["a"] },
            { targetTitles: "Backend" },
            { jobPreferences: { locations: [{ city: null, state: "XX" }] } },
            { jobPreferences: { salaryFloorCents: -5 } },
            { profileFields: { phone: { value: "x".repeat(501), share: true } } },
            { profileFields: { phone: { value: "1" } } },
          ];

          for (const json of invalid) {
            const res = await save(instance, id, json);

            expect(res.status).toBe(422);
            expect(await res.json()).toEqual({ error: "Invalid preferences" });
          }

          expect(await (await request(instance, id, "/me/preferences")).json()).toEqual(defaults);
        });

        it("leaves a malformed body to the framework", async () => {
          const { instance } = resumesApp();

          const res = await instance.handle(
            new Request("http://localhost/api/me/preferences", {
              method: "PUT",
              headers: {
                "x-test-session": "talent",
                "x-test-talent-id": await profile(),
                origin: webOrigin,
                "content-type": "application/json",
              },
              body: "{",
            }),
          );

          expect(res.status).toBe(400);
        });

        it("isolates preferences between people", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const other = await profile("outra.pessoal@example.com", 1);

          await save(instance, id, { mode: "automatic", targetTitles: ["Backend"] });

          expect(await (await request(instance, other, "/me/preferences")).json()).toEqual(
            defaults,
          );
        });

        it("enqueues matching only when the titles change", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          await save(instance, id, { mode: "hybrid" });
          await save(instance, id, { targetTitles: [] });

          expect(await matchJobs()).toEqual([]);

          await save(instance, id, { targetTitles: ["Backend", "SRE"] });

          expect(await matchJobs()).toEqual([{ subject: id }]);

          await db.delete(backgroundJobs);
          await save(instance, id, { targetTitles: ["sre", "BACKEND"] });

          expect(await matchJobs()).toEqual([]);

          await save(instance, id, { targetTitles: ["Backend"] });

          expect(await matchJobs()).toEqual([{ subject: id }]);
        });

        it("still saves when enqueueing matching fails", async () => {
          const logged = vi.spyOn(console, "error");

          const instance = createApp(
            webOrigin,
            {
              ...repos,
              background: {
                ...repos.background,
                enqueue: async () => {
                  throw new Error("queue down");
                },
              },
            },
            appOptions,
          );

          const id = await profile();
          const res = await save(instance, id, { targetTitles: ["Backend"] });

          expect(res.status).toBe(200);
          expect((await res.json()).targetTitles).toEqual(["Backend"]);
          expect(logged).toHaveBeenCalledWith("title re-match enqueue failed", {
            name: "Error",
            message: "queue down",
          });
          logged.mockRestore();
        });

        it("includes preferences in the export", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          await save(instance, id, { mode: "automatic", targetTitles: ["Backend"] });

          const exported = await (await request(instance, id, "/me/export")).json();

          expect(exported.preferences).toMatchObject({
            mode: "automatic",
            targetTitles: ["Backend"],
            profileFields: defaults.profileFields,
          });
        });
      });

      it("deletes the account", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();

        await upload(instance, id);

        store.failRemove = true;

        const failed = await request(instance, id, "/me", { method: "DELETE" });

        expect(failed.status).toBe(502);
        expect(await failed.json()).toEqual({ error: "Could not delete stored files" });
        expect((await request(instance, id, "/me")).status).toBe(200);

        store.failRemove = false;

        const deleted = await request(instance, id, "/me", { method: "DELETE" });

        expect(deleted.status).toBe(204);
        expect(store.prefixes).toEqual([`resumes/${id}/`]);
        expect((await request(instance, id, "/me")).status).toBe(403);
      });

      it("deletes every stored file of the profile, including unrecorded ones", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "account-delete-"));
        const storage = diskStorage(root);

        try {
          const instance = createApp(webOrigin, repos, {
            ...appOptions,
            generateStructured: async ({ schema }) => schema.parse(draft),
            storage,
          });

          const id = await profile();
          const other = await profile("outra.pessoal@example.com", 1);

          expect((await upload(instance, id)).status).toBe(200);
          expect((await upload(instance, other)).status).toBe(200);

          await storage.put(`resumes/${id}/orphan.pdf`, pdf, "application/pdf");

          expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
          expect(await readdir(path.join(root, "resumes"))).toEqual([other]);
          expect(await readdir(path.join(root, "resumes", other))).toHaveLength(1);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });

      it("deletes an account without files even when storage is missing", async () => {
        const { instance } = resumesApp({ storage: false });
        const id = await profile();

        expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
      });

      it("refuses to delete files when storage is missing", async () => {
        const withStorage = resumesApp();
        const id = await profile();

        await upload(withStorage.instance, id);

        const { instance } = resumesApp({ storage: false });
        const res = await request(instance, id, "/me", { method: "DELETE" });

        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "File storage not configured" });
        expect((await request(instance, id, "/me")).status).toBe(200);
      });
    });
  });

  describe("job sources", () => {
    const greenhouseBody = (ids: number[]) =>
      Response.json({
        jobs: ids.map((id) => ({
          id,
          title: `Engenheira ${id}`,
          company_name: "Acme Pagamentos",
          absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
          location: { name: "São Paulo, Brasil" },
          first_published: "2026-11-02T10:15:00-03:00",
          content: "&lt;p&gt;Vaga&lt;/p&gt;",
        })),
      });

    const acme = { kind: "greenhouse", target: "acme", label: null } satisfies CatalogSource;

    function sourcesApp(
      catalog: readonly CatalogSource[] | undefined,
      overrides: Partial<typeof repos> = {},
    ) {
      const fetched: string[] = [];

      const instance = createApp(
        webOrigin,
        { ...repos, ...overrides },
        {
          ...appOptions,
          catalog,
          fetchFeedImpl: async (input) => {
            const target = String(input);

            fetched.push(target);

            return target.includes("broken")
              ? new Response("missing", { status: 404 })
              : greenhouseBody([1, 2]);
          },
        },
      );

      const drainNow = async (method = "POST") =>
        (
          await instance.handle(
            new Request("http://localhost/api/background/drain", {
              method,
              headers: { authorization: `Bearer ${cronSecret}` },
            }),
          )
        ).json();

      const asTalent = (profileId: string, path: string) =>
        instance.handle(
          new Request(`http://localhost/api${path}`, {
            headers: {
              "x-test-session": "talent",
              "x-test-talent-id": profileId,
              origin: webOrigin,
            },
          }),
        );

      return { fetched, drainNow, asTalent };
    }

    function queued(kind: string) {
      return db
        .select({ subject: backgroundJobs.subject, status: backgroundJobs.status })
        .from(backgroundJobs)
        .where(eq(backgroundJobs.kind, kind));
    }

    function registry() {
      return db
        .select({
          id: jobSources.id,
          target: jobSources.target,
          enabled: jobSources.enabled,
          lastError: jobSources.lastError,
          updatedAt: jobSources.updatedAt,
        })
        .from(jobSources)
        .orderBy(jobSources.target);
    }

    function importedJobs() {
      return db
        .select({
          id: jobs.id,
          sourceKey: jobs.sourceKey,
          origin: jobs.origin,
          company: jobs.company,
          closedAt: jobs.closedAt,
        })
        .from(jobs)
        .where(eq(jobs.source, "greenhouse"))
        .orderBy(jobs.sourceKey);
    }

    async function matchingProfile() {
      const cases: { id: string }[] = await (await call("/offboardings")).json();

      const created = await repos.talent.enable({
        caseId: cases[0].id,
        personalEmail: "fontes.pessoal@example.com",
        sponsoredUntil: "2099-12-31",
      });

      if (
        created === "case_not_found" ||
        created === "already_enabled" ||
        created === "email_taken"
      ) {
        throw new Error(created);
      }

      await repos.talent.acceptTerms(created.id);
      await db.insert(resumes).values({
        profileId: created.id,
        kind: "base",
        content: {
          headline: { id: "h", text: "Engenheira" },
          summary: { id: "s", text: "Dados" },
          experiences: [],
          education: [],
          skills: [],
          languages: [],
          contact: { email: null, phone: null, city: null, links: [] },
        },
      });

      return created.id;
    }

    it("syncs the catalog and imports due sources from the cron", async () => {
      const app = sourcesApp([acme]);

      expect(await app.drainNow("GET")).toEqual({ processed: 1, failed: 0 });
      expect(app.fetched).toEqual([
        "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
      ]);
      expect(await importedJobs()).toMatchObject([
        { sourceKey: "acme:1", origin: "external", company: "Acme Pagamentos", closedAt: null },
        { sourceKey: "acme:2", origin: "external", company: "Acme Pagamentos", closedAt: null },
      ]);

      const [source] = await registry();

      expect(source).toMatchObject({ target: "acme", enabled: true, lastError: null });
      expect(await queued("ingest_jobs")).toEqual([{ subject: source.id, status: "done" }]);
    });

    it("schedules nothing new and changes nothing with an unchanged or empty catalog", async () => {
      const empty = sourcesApp([]);

      expect(await empty.drainNow()).toEqual({ processed: 0, failed: 0 });
      expect(empty.fetched).toEqual([]);
      expect(await registry()).toEqual([]);

      const app = sourcesApp([acme]);

      await app.drainNow();

      const sources = await registry();
      const scheduled = await queued("ingest_jobs");

      expect(await app.drainNow()).toEqual({ processed: 0, failed: 0 });
      expect(app.fetched).toHaveLength(1);
      expect(await registry()).toEqual(sources);
      expect(await queued("ingest_jobs")).toEqual(scheduled);
    });

    it("syncs the reviewed catalog by default", async () => {
      const app = sourcesApp(undefined);

      expect(await app.drainNow()).toEqual({ processed: 2, failed: 0 });
      expect(app.fetched.sort()).toEqual([
        "https://boards-api.greenhouse.io/v1/boards/quintoandar/jobs?content=true",
        "https://boards-api.greenhouse.io/v1/boards/stone/jobs?content=true",
      ]);
      expect((await registry()).map((source) => [source.target, source.enabled])).toEqual([
        ["quintoandar", true],
        ["stone", true],
      ]);
    });

    it("schedules only due enabled sources before draining", async () => {
      const due = { ...acme, target: "due" };
      const fresh = { ...acme, target: "fresh" };
      const app = sourcesApp([due, fresh]);
      const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60_000);

      await repos.sources.syncCatalog([due, fresh], new Date());
      await db
        .insert(jobSources)
        .values({ kind: "greenhouse", target: "disabled", enabled: false });
      await db
        .update(jobSources)
        .set({ lastSyncedAt: sevenHoursAgo })
        .where(eq(jobSources.target, "due"));
      await db
        .update(jobSources)
        .set({ lastSyncedAt: new Date() })
        .where(eq(jobSources.target, "fresh"));

      expect(await app.drainNow("GET")).toEqual({ processed: 1, failed: 0 });
      expect(app.fetched).toEqual([
        "https://boards-api.greenhouse.io/v1/boards/due/jobs?content=true",
      ]);

      expect(await app.drainNow()).toEqual({ processed: 0, failed: 0 });
      expect(app.fetched).toHaveLength(1);
    });

    it("still drains when scheduling sources fails", async () => {
      const logged = vi.spyOn(console, "error");

      const app = sourcesApp([acme], {
        sources: { ...repos.sources, dueIds: () => Promise.reject(new Error("db down")) },
      });

      await repos.background.enqueue("ingest_jobs", crypto.randomUUID());

      expect(await app.drainNow()).toEqual({ processed: 1, failed: 0 });
      expect(app.fetched).toEqual([]);
      expect(logged.mock.calls).toEqual([
        ["source scheduling failed", { name: "Error", message: "db down" }],
      ]);
      logged.mockRestore();
    });

    it("completes ingest jobs of missing or disabled sources without fetching", async () => {
      const app = sourcesApp([]);

      const [disabled] = await db
        .insert(jobSources)
        .values({ kind: "greenhouse", target: "disabled", enabled: false })
        .returning({ id: jobSources.id });

      await repos.background.enqueue("ingest_jobs", disabled.id);
      await repos.background.enqueue("ingest_jobs", crypto.randomUUID());

      expect(await app.drainNow()).toEqual({ processed: 2, failed: 0 });
      expect(app.fetched).toEqual([]);
      expect(await queued("ingest_jobs")).toMatchObject([{ status: "done" }, { status: "done" }]);
    });

    it("records a failed fetch without retrying it", async () => {
      const app = sourcesApp([{ kind: "lever", target: "broken", label: null }]);

      expect(await app.drainNow()).toEqual({ processed: 1, failed: 0 });
      expect(app.fetched).toEqual(["https://api.lever.co/v0/postings/broken?mode=json"]);
      expect(await registry()).toMatchObject([{ target: "broken", lastError: "http_404" }]);
      expect(await queued("compute_matches")).toEqual([]);
    });

    it("logs a failed fetch with only its identifying fields", async () => {
      const logged = vi.spyOn(console, "error");

      const app = sourcesApp([
        { kind: "lever", target: "broken", label: null },
        { kind: "greenhouse", target: "acme", label: null },
      ]);

      await app.drainNow();

      expect(logged.mock.calls).toEqual([
        [
          "source sync failed",
          { kind: "lever", target: "broken", error: "http_error", status: 404 },
        ],
      ]);
      logged.mockRestore();
    });

    it("logs a failed fetch without a status when it is not an http error", async () => {
      const logged = vi.spyOn(console, "error");

      const instance = createApp(webOrigin, repos, {
        ...appOptions,
        catalog: [acme],
        fetchFeedImpl: () => Promise.reject(new Error("offline")),
      });

      await instance.handle(
        new Request("http://localhost/api/background/drain", {
          method: "POST",
          headers: { authorization: `Bearer ${cronSecret}` },
        }),
      );

      expect(logged.mock.calls).toEqual([
        ["source sync failed", { kind: "greenhouse", target: "acme", error: "network" }],
      ]);
      logged.mockRestore();
    });

    it("fans out matching when a sync creates jobs", async () => {
      const profileId = await matchingProfile();
      const app = sourcesApp([acme]);

      await app.drainNow();

      expect((await queued("compute_matches")).map((row) => row.subject)).toEqual([profileId]);

      const [source] = await registry();

      await db.delete(backgroundJobs);
      await repos.background.enqueue("ingest_jobs", source.id);
      await app.drainNow();

      expect(await queued("ingest_jobs")).toEqual([{ subject: source.id, status: "done" }]);
      expect(await queued("compute_matches")).toEqual([]);
    });

    it("fans out nothing when the company subscription is not active", async () => {
      await matchingProfile();

      const subscription = await repos.billing.getSubscription();

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(subscription.id, { status: "canceled" });

      const app = sourcesApp([acme]);

      expect(await app.drainNow()).toEqual({ processed: 1, failed: 0 });
      expect(await importedJobs()).toHaveLength(2);
      expect(await queued("compute_matches")).toEqual([]);
    });

    it("keeps imported jobs when fanning out matching fails", async () => {
      const logged = vi.spyOn(console, "error");

      await matchingProfile();

      const app = sourcesApp([acme], {
        background: {
          ...repos.background,
          enqueueMany: (kind, subjects) =>
            kind === "compute_matches"
              ? Promise.reject(new Error("queue down"))
              : repos.background.enqueueMany(kind, subjects),
        },
      });

      expect(await app.drainNow()).toEqual({ processed: 1, failed: 0 });
      expect(await importedJobs()).toHaveLength(2);
      expect(await queued("compute_matches")).toEqual([]);
      expect(logged.mock.calls).toEqual([
        ["source match fan-out failed", { name: "Error", message: "queue down" }],
      ]);
      logged.mockRestore();
    });

    it("disables removed sources and closes their jobs", async () => {
      const profileId = await matchingProfile();

      await sourcesApp([acme]).drainNow();

      const [first] = await importedJobs();

      await db.insert(applications).values({ profileId, jobId: first.id });

      const app = sourcesApp([]);

      expect(await app.drainNow()).toMatchObject({ failed: 0 });
      expect(await registry()).toMatchObject([{ target: "acme", enabled: false }]);
      expect((await importedJobs()).every((job) => job.closedAt instanceof Date)).toBe(true);

      const listed = await app.asTalent(profileId, "/me/applications");

      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject([{ job: { id: first.id, title: "Engenheira 1" } }]);
      expect(await (await app.asTalent(profileId, "/me/jobs")).json()).toMatchObject({
        total: 0,
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      correiosServer.close(() => resolve());
    });

    await db.$client.end();
  });

  it("serves no route for HR job sharing, partner recruiters or job feed admin", async () => {
    for (const [path, method] of [
      ["/jobs/share", "POST"],
      ["/recruiters/jobs", "POST"],
      ["/recruiter-partners", "GET"],
      ["/recruiter-partners", "POST"],
      ["/job-feeds", "GET"],
      ["/job-feeds", "POST"],
      [`/job-feeds/${crypto.randomUUID()}`, "PATCH"],
      [`/job-feeds/${crypto.randomUUID()}`, "DELETE"],
    ] as const) {
      expect((await call(path, method)).status).toBe(404);
    }
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
