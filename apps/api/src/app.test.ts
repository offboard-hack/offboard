import { createHmac, randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
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
  aiApplications,
  answerQuestions,
  applicationPackages,
  applications,
  authRateLimit,
  authSession,
  authUser,
  backgroundJobs,
  candidateContactRequests,
  demoSearchUsage,
  benefitAssignments,
  benefitPolicies,
  checklistModels,
  defaultOrgId,
  exitSurveys,
  employeeAccess,
  employeeStates,
  equipment,
  interviews,
  jobSources,
  jobMatches,
  jobRejections,
  jobs,
  llmUsage,
  offboardingCases,
  organizations,
  plans,
  publicPageDailyViews,
  publicPages,
  resumes,
  integrations,
  subscriptions,
  talentPreferences,
  talentProfiles,
  talentSubscriptions,
  tasks,
} from "@offboard/db/schema";
import { seedDatabase, testSeedFixtures } from "@offboard/db/seed-database";
import { slackTokenReader } from "./features/integrations/routes.js";
import { secretBox } from "./shared/secret-box.js";
import {
  emptyEmployeePlan,
  employeeGrantHeader,
  employeeStateSchema,
  type EmployeeState,
} from "@offboard/employee";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { status } from "elysia";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "./app.ts";
import type { TrackingConfig } from "./features/offboardings/correios.ts";
import { codeAudienceHeader, createAuth, createRuntimeAuth } from "./features/auth/auth.js";
import { catalogSources, type CatalogSource } from "./features/sources/catalog.js";
import type { GenerateStructured } from "./shared/ai.js";
import { type Embed, textHash } from "./shared/embed.js";
import type { Captcha } from "./shared/turnstile.js";
import type { Rerank } from "./features/candidates/routes.js";
import { matchScore } from "./shared/profile-card.js";
import { diskStorage } from "./shared/disk-storage.js";
import type { ObjectStorage } from "./shared/object-storage.js";
import { zipSync } from "fflate";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import type { PortalAuth } from "./shared/portal-auth.js";
import { addMonths, saoPauloDate } from "./shared/sao-paulo-date.js";

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
      principal: {
        id: headers.get("x-test-member-id") ?? "test-member",
        name: "Test Member",
        email: "member@example.com",
        role,
        orgId: headers.get("x-test-org-id") ?? defaultOrgId,
        orgName: "Test Org",
      },
    });
  },
};

const browserbase = { apiKey: "bb-key", projectId: "bb-project" };

const appOptions = {
  auth,
  sendEmail,
  cronSecret,
  webhookSecret,
  slackSigningSecret,
  secretKey: "integration-secret-key-for-tests-0001",
  catalog: [],
  runInBackground: () => undefined,
};

function vectorAt(offset: number) {
  return Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : index === 1 ? offset : 0));
}

function fakeEmbed() {
  const calls: string[][] = [];
  const state = { fail: false };

  const embed: Embed = async (texts) => {
    calls.push(texts);

    if (state.fail) throw new Error("embeddings down");

    return texts.map((text) => vectorAt(Number(/Vaga (\d+)/.exec(text)?.[1] ?? 0)));
  };

  return { calls, state, embed };
}

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
const otherOrgId = "00000000-0000-0000-0000-0000000000b2";

type SurveyPayload = {
  caseId: string;
  npsScore: number;
  responses: Record<string, boolean>;
  topics: string[];
};

describe.skipIf(!url)("api", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);

  let trackingBody = "";
  let trackingStatus = 200;

  const trackingServer = createServer((_req, res) => {
    res.writeHead(trackingStatus, { "content-type": "application/json" });
    res.end(trackingBody);
  });

  let trackingConfig: TrackingConfig;

  type Hook = {
    task?: { id: string; status: string };
    equipment?: { id: string; tag: string; status: string; previousStatus: string };
    case?: { id: string; name: string };
  };

  const hooks: Hook[] = [];

  const hookServer = createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      hooks.push(JSON.parse(body));
      res.writeHead(200);
      res.end();
    });
  });

  let hookUrl = "";

  const app = createApp(webOrigin, repos, appOptions);

  type Payload = {
    name?: string;
    email?: string | null;
    invite?: boolean;
    plan?: typeof emptyEmployeePlan;
    revision?: number;
    role?: string;
    department?: string;
    deadline?: string;
    status?: string;
    rows?:
      | { name: string; department?: string }[]
      | { person: string; item: string; tag: string; returnMethod: string }[];
    actionId?: string;
    enabled?: boolean;
    shareOutcomeWithHr?: boolean | string;
    searchable?: boolean;
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
    botToken?: string;
    item?: string;
    tag?: string;
    returnMethod?: string;
    caseId?: string;
    trigger?: string;
    conditions?: Record<string, string>;
    actions?: object[];
    cronSchedule?: string | null;
  };

  function call(
    path: string,
    method = "GET",
    body?: Payload | Parameters<typeof repos.actionConfigs.saveChecklist>[1],
    target = app,
  ) {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const headers = new Headers({ "content-type": "application/json", origin: webOrigin });

    if (path.startsWith("/webhooks/inbound/")) {
      headers.set("authorization", `Bearer ${webhookSecret}`);
    }

    if (path === "/integrations/slack/events") {
      return app.handle(slackRequest(encoded ?? ""));
    }

    return target.handle(
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
      trackingServer.listen(0, "127.0.0.1", resolve);
    });

    await new Promise<void>((resolve) => {
      hookServer.listen(0, "127.0.0.1", resolve);
    });

    // WARNING: listen(0) guarantees AddressInfo with a port
    hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}`;

    // WARNING: listen(0) guarantees AddressInfo with a port
    const addr = trackingServer.address() as AddressInfo;

    trackingConfig = {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      apiKey: "test-api-key",
    };
  });

  beforeEach(async () => {
    invitedEmails.length = 0;
    sentTexts.length = 0;
    inviteFailures.remaining = 0;
    await seedDatabase(db, testSeedFixtures);
  });

  async function onPlan(
    slug: string,
    status: (typeof subscriptions.$inferInsert)["status"] = "active",
  ) {
    const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, slug));

    await db
      .update(subscriptions)
      .set({ planId: plan.id, status })
      .where(eq(subscriptions.orgId, defaultOrgId));
  }

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

    it("enables talent access without inviting a person who signs in as a collaborator", async () => {
      const cases: { id: string }[] = await (await call("/offboardings")).json();
      const [first, second] = cases;
      const body = { sponsoredUntil };

      await db.insert(employeeAccess).values([
        {
          caseId: first.id,
          orgId: defaultOrgId,
          email: "bia@example.com",
          plan: emptyEmployeePlan,
        },
        { caseId: second.id, orgId: defaultOrgId, email: null, plan: emptyEmployeePlan },
      ]);

      const granted = await asSession("rh", `/offboardings/${first.id}/talent-access`, "POST", {
        ...body,
        personalEmail,
      });

      expect(granted.status).toBe(201);
      expect(invitedEmails).toEqual([]);

      const revoked = await asSession("rh", `/offboardings/${second.id}/talent-access`, "POST", {
        ...body,
        personalEmail: "outra@example.com",
      });

      expect(revoked.status).toBe(201);
      expect(invitedEmails).toEqual(["outra@example.com"]);
    });

    it("rejects a duplicate personal email and invalid input without inviting", async () => {
      const cases: { id: string }[] = await (await call("/offboardings")).json();
      const [first, second] = cases;

      await repos.talent.enable({
        orgId: defaultOrgId,
        caseId: first.id,
        personalEmail,
        sponsoredUntil,
      });

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

      const created = await repos.talent.enable({
        orgId: defaultOrgId,
        caseId,
        personalEmail,
        sponsoredUntil,
      });

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

      await repos.talent.enable({
        orgId: defaultOrgId,
        caseId: first.id,
        personalEmail,
        sponsoredUntil,
      });
      await repos.talent.enable({
        orgId: defaultOrgId,
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

    it("isolates talent across organizations", async () => {
      const otherOrg = { "x-test-org-id": otherOrgId };
      const ownCase = await firstCaseId();
      const ownPath = `/offboardings/${ownCase}/talent-access`;

      await db
        .insert(organizations)
        .values({ id: otherOrgId, name: "Org B", slug: "org-b" })
        .onConflictDoNothing();

      const [otherCase] = await db
        .insert(offboardingCases)
        .values({
          orgId: otherOrgId,
          name: "Pessoa da Org B",
          role: "Dev",
          department: "Eng",
          deadline: "2026-12-01",
        })
        .returning({ id: offboardingCases.id });

      const otherPath = `/offboardings/${otherCase.id}/talent-access`;
      const body = { personalEmail, sponsoredUntil };

      expect((await asSession("rh", ownPath, "POST", body, otherOrg)).status).toBe(404);
      expect(invitedEmails).toEqual([]);
      expect((await asSession("rh", ownPath, "POST", body)).status).toBe(201);
      expect((await asSession("rh", ownPath, "GET", undefined, otherOrg)).status).toBe(404);

      const foreignPatch = await asSession(
        "rh",
        ownPath,
        "PATCH",
        { personalEmail: "invasora@example.com", sponsoredUntil: "2100-01-31" },
        otherOrg,
      );

      expect(foreignPatch.status).toBe(404);
      expect(invitedEmails).toEqual([personalEmail]);
      expect(await repos.talent.findByCase(defaultOrgId, ownCase)).toMatchObject({
        email: personalEmail,
        sponsoredUntil,
      });

      const otherEmail = "pessoa.b@example.com";

      const created = await asSession(
        "rh",
        otherPath,
        "POST",
        { personalEmail: otherEmail, sponsoredUntil },
        otherOrg,
      );

      expect(created.status).toBe(201);
      expect(invitedEmails).toEqual([personalEmail, otherEmail]);
      expect((await asSession("rh", otherPath)).status).toBe(404);

      const own = await repos.talent.findByCase(defaultOrgId, ownCase);
      const other = await repos.talent.findByCase(otherOrgId, otherCase.id);

      if (!own || !other) throw new Error("missing talent profiles");

      expect(other.orgId).toBe(otherOrgId);
      expect(await repos.talent.findByCase(defaultOrgId, otherCase.id)).toBeUndefined();

      const [job] = await db
        .insert(jobs)
        .values({
          origin: "external",
          source: "seed",
          sourceKey: "isolation",
          title: "Analista",
          company: "Acme",
          url: "https://jobs.example.com/isolation",
        })
        .returning({ id: jobs.id });

      const sponsoredBy = async (orgId: string, total: number) => {
        const rows = await db
          .insert(talentProfiles)
          .values(
            Array.from({ length: total }, (_, index) => ({
              orgId,
              name: `Pessoa ${orgId.slice(-2)} ${index}`,
              personalEmail: `pessoa.${orgId.slice(-2)}.${index}@example.com`,
              sponsoredUntil,
            })),
          )
          .returning({ id: talentProfiles.id });

        return rows.map((row) => row.id);
      };

      const ownPeople = [own.id, ...(await sponsoredBy(defaultOrgId, 4))];
      const otherPeople = [other.id, ...(await sponsoredBy(otherOrgId, 3))];

      await db
        .insert(applications)
        .values([...ownPeople, ...otherPeople].map((profileId) => ({ profileId, jobId: job.id })));

      const ownAggregates = await asSession("rh", "/talent/aggregates");

      const otherAggregates = await asSession(
        "rh",
        "/talent/aggregates",
        "GET",
        undefined,
        otherOrg,
      );

      expect(await ownAggregates.json()).toEqual({
        enabled: 5,
        activated: null,
        funnel: { sent: 5, responded: null, interviews: null, offers: null },
        hiresShared: null,
        topJobs: [{ title: "Analista", company: "Acme", applications: 5 }],
      });
      expect(await otherAggregates.json()).toEqual({
        enabled: 4,
        activated: null,
        funnel: { sent: null, responded: null, interviews: null, offers: null },
        hiresShared: null,
        topJobs: [],
      });

      const [plan] = await db.select({ id: plans.id }).from(plans).limit(1);

      await db.insert(subscriptions).values({
        orgId: otherOrgId,
        planId: plan.id,
        currentPeriodStart: "2026-11-01",
        currentPeriodEnd: "2099-12-01",
      });

      const ownSubscription = await repos.billing.getSubscription(defaultOrgId);

      if (!ownSubscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(defaultOrgId, ownSubscription.id, {
        status: "canceled",
      });

      const entitlement = async (profileId: string) => {
        const me = await asSession("talent", "/me", "GET", undefined, {
          "x-test-talent-id": profileId,
        });

        return z.object({ entitlement: z.object({ kind: z.string() }) }).parse(await me.json())
          .entitlement.kind;
      };

      expect(await entitlement(own.id)).toBe("lapsed");
      expect(await entitlement(other.id)).toBe("sponsored");

      const resume = {
        headline: { id: "h", text: "Engenheira" },
        summary: { id: "s", text: "Dados" },
        experiences: [],
        education: [],
        skills: [],
        languages: [],
        contact: { email: null, phone: null, city: null, links: [] },
      };

      await db.insert(resumes).values([
        { profileId: own.id, kind: "base", content: resume },
        { profileId: other.id, kind: "base", content: resume },
      ]);
      await db.insert(publicPages).values([
        { profileId: own.id, slug: "pessoa-org-a", enabled: true },
        { profileId: other.id, slug: "pessoa-org-b", enabled: true },
      ]);

      expect((await call("/public/pages/pessoa-org-a")).status).toBe(404);
      expect((await call("/public/pages/pessoa-org-b")).status).toBe(200);
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

      const created = await repos.talent.enable({
        orgId: defaultOrgId,
        caseId,
        personalEmail,
        sponsoredUntil,
      });

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
        searchable: false,
        aiApply: { eligible: false, consented: false, available: false },
        entitlement: { kind: "sponsored", until: sponsoredUntil },
      });

      const accepted = await asSession("talent", "/me/terms", "POST", undefined, talentHeaders);

      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({ termsAccepted: true });

      const subscription = await repos.billing.getSubscription(defaultOrgId);

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(defaultOrgId, subscription.id, { status: "canceled" });

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
        const created = await repos.talent.enable({
          orgId: defaultOrgId,
          caseId,
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

      const findable = await asSession(
        "talent",
        "/me/search-consent",
        "PUT",
        { searchable: true },
        asMine,
      );

      expect(await findable.json()).toMatchObject({ searchable: true, shareOutcomeWithHr: false });
      expect((await repos.talent.findById(mine.id))?.searchableAt).toEqual(expect.any(String));
      expect((await repos.talent.findById(other.id))?.searchableAt).toBeNull();

      const hidden = await asSession(
        "talent",
        "/me/search-consent",
        "PUT",
        { searchable: false },
        asMine,
      );

      expect(await hidden.json()).toMatchObject({ searchable: false });
      expect((await repos.talent.findById(mine.id))?.searchableAt).toBeNull();
      expect(
        (await asSession("rh", "/me/search-consent", "PUT", { searchable: true })).status,
      ).toBe(403);

      await repos.talent.setConsent(mine.id, true, new Date());

      const subscription = await repos.billing.getSubscription(defaultOrgId);

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(defaultOrgId, subscription.id, { status: "canceled" });

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

    it("stores AI Apply consent", async () => {
      const [firstCase, secondCase] = await db
        .select({ id: offboardingCases.id })
        .from(offboardingCases);

      const enable = async (caseId: string, email: string) => {
        const created = await repos.talent.enable({
          orgId: defaultOrgId,
          caseId,
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

        return created;
      };

      const mine = await enable(firstCase.id, personalEmail);
      const other = await enable(secondCase.id, "outra@example.com");

      await onPlan("platinum-premium");

      const gated = createApp(webOrigin, repos, {
        ...appOptions,
        generateStructured: async ({ schema }) => schema.parse({}),
        browserbase,
      });

      const withoutBrowser = createApp(webOrigin, repos, {
        ...appOptions,
        generateStructured: async ({ schema }) => schema.parse({}),
      });

      const call = (
        instance: typeof gated,
        session: string,
        path: string,
        method: string,
        id: string,
        body?: { accept: boolean | string },
      ) =>
        instance.handle(
          new Request(`http://localhost/api${path}`, {
            method,
            headers: {
              "x-test-session": session,
              "x-test-talent-id": id,
              origin: webOrigin,
              "content-type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        );

      const seedAttempt = async (
        profileId: string,
        sourceKey: string,
        state: (typeof aiApplications.$inferInsert)["state"],
      ) => {
        const [job] = await db
          .insert(jobs)
          .values({
            origin: "external",
            source: "seed",
            sourceKey,
            title: sourceKey,
            company: "Acme",
            url: `https://jobs.example.com/${sourceKey}`,
          })
          .returning({ id: jobs.id });

        const [row] = await db
          .insert(aiApplications)
          .values({
            profileId,
            jobId: job.id,
            state,
            form: { questions: [] },
            draft: [],
            preparedAt: new Date("2026-11-01T00:00:00Z"),
          })
          .returning({ id: aiApplications.id });

        return row.id;
      };

      const stateOf = async (id: string) => {
        const [row] = await db
          .select({
            state: aiApplications.state,
            reason: aiApplications.reason,
            finishedAt: aiApplications.finishedAt,
            liveUrl: aiApplications.liveUrl,
          })
          .from(aiApplications)
          .where(eq(aiApplications.id, id));

        return row;
      };

      const consentOf = async (id: string) => {
        const [row] = await db
          .select({
            at: talentProfiles.aiApplyConsentAt,
            version: talentProfiles.aiApplyConsentVersion,
          })
          .from(talentProfiles)
          .where(eq(talentProfiles.id, id));

        return row;
      };

      const put = (instance: typeof gated, session: string, id: string, accept: boolean | string) =>
        call(instance, session, "/me/ai-apply/consent", "PUT", id, { accept });

      expect((await put(gated, "rh", mine.id, true)).status).toBe(403);
      expect((await put(gated, "talent", mine.id, "yes")).status).toBe(422);

      expect(await (await call(gated, "talent", "/me", "GET", mine.id)).json()).toMatchObject({
        aiApply: { eligible: true, consented: false, available: false },
      });

      const accepted = await put(gated, "talent", mine.id, true);

      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        id: mine.id,
        aiApply: { eligible: true, consented: true, available: true },
      });

      expect(
        await (await call(withoutBrowser, "talent", "/me", "GET", mine.id)).json(),
      ).toMatchObject({
        aiApply: { eligible: true, consented: true, available: false },
      });

      await onPlan("gold");

      expect(await (await call(gated, "talent", "/me", "GET", mine.id)).json()).toMatchObject({
        aiApply: { eligible: false, consented: true, available: false },
      });

      await db.insert(talentSubscriptions).values({
        profileId: mine.id,
        status: "active",
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(await (await call(gated, "talent", "/me", "GET", mine.id)).json()).toMatchObject({
        aiApply: { eligible: true, consented: true, available: true },
      });
      expect(await (await call(gated, "talent", "/me/plan", "GET", mine.id)).json()).toEqual({
        company: { name: "Gold", includesAiApply: false, sponsoredUntil },
        individual: {
          plan: "carreira-pro",
          status: "active",
          currentPeriodEnd: null,
          cancelable: false,
        },
        benefit: null,
        aiApply: { allowedBy: "individual", dailyLimit: 10 },
        upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
        copay: null,
      });

      await db.delete(talentSubscriptions).where(eq(talentSubscriptions.profileId, mine.id));
      await onPlan("platinum-premium");

      const stored = await consentOf(mine.id);

      expect(stored.at).toBeInstanceOf(Date);
      expect(stored.version).toBe("2026-11-25");
      expect(await (await call(app, "talent", "/me", "GET", mine.id)).json()).toMatchObject({
        aiApply: { eligible: true, consented: true, available: false },
      });

      const draft = await seedAttempt(mine.id, "ai-draft", "draft");
      const queued = await seedAttempt(mine.id, "ai-queued", "queued");
      const running = await seedAttempt(mine.id, "ai-running", "running");
      const submitted = await seedAttempt(mine.id, "ai-submitted", "submitted");
      const others = await seedAttempt(other.id, "ai-other", "draft");

      await db
        .update(aiApplications)
        .set({ liveUrl: "https://www.browserbase.com/devtools-fullscreen/inspector.html" })
        .where(eq(aiApplications.id, running));

      await put(gated, "talent", other.id, true);

      const older = new Date("2020-01-01T00:00:00Z");

      await db
        .update(talentProfiles)
        .set({ aiApplyConsentAt: older, aiApplyConsentVersion: "2020-01-01" })
        .where(eq(talentProfiles.id, mine.id));
      await put(gated, "talent", mine.id, true);

      const refreshed = await consentOf(mine.id);

      expect(refreshed.at?.getTime()).toBeGreaterThan(older.getTime());
      expect(refreshed.version).toBe("2026-11-25");

      const withdrawn = await put(gated, "talent", mine.id, false);

      expect(await withdrawn.json()).toMatchObject({
        aiApply: { eligible: true, consented: false, available: false },
      });
      expect(await consentOf(mine.id)).toEqual({ at: null, version: null });

      for (const id of [draft, queued, running]) {
        expect(await stateOf(id)).toEqual({
          state: "cancelled",
          reason: "consent_withdrawn",
          finishedAt: expect.any(Date),
          liveUrl: null,
        });
      }

      expect(await stateOf(submitted)).toEqual({
        state: "submitted",
        reason: null,
        finishedAt: null,
        liveUrl: null,
      });
      expect(await stateOf(others)).toEqual({
        state: "draft",
        reason: null,
        finishedAt: null,
        liveUrl: null,
      });
      expect((await consentOf(other.id)).at).toBeInstanceOf(Date);

      await put(gated, "talent", mine.id, true);

      expect((await stateOf(draft)).state).toBe("cancelled");
    });

    it("prepares an AI Apply draft through the composed app", async () => {
      const [firstCase] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

      const created = await repos.talent.enable({
        orgId: defaultOrgId,
        caseId: firstCase.id,
        personalEmail,
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
      await repos.talent.setAiApplyConsent(created.id, true, new Date());

      await db.insert(resumes).values({
        profileId: created.id,
        kind: "base",
        content: {
          headline: { id: "h", text: "Engenheira" },
          summary: { id: "s", text: "Backend" },
          experiences: [],
          education: [],
          skills: [],
          languages: [],
          contact: { email: null, phone: null, city: null, links: [] },
        },
      });

      await db.insert(jobs).values({
        origin: "external",
        source: "greenhouse",
        sourceKey: "acme:42",
        title: "Backend",
        company: "Acme",
        url: "https://job-boards.greenhouse.io/acme/jobs/42",
      });

      const [job] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.sourceKey, "acme:42"));

      const [common] = await db
        .select({ id: answerQuestions.id, text: answerQuestions.text })
        .from(answerQuestions)
        .where(eq(answerQuestions.text, "Como você soube da vaga?"));

      await repos.answers.answer(created.id, common.id, "Resposta pronta", new Date());

      const urls: string[] = [];

      await onPlan("platinum-premium");

      const instance = createApp(webOrigin, repos, {
        ...appOptions,
        browserbase,
        generateStructured: async ({ schema }) => schema.parse({ answers: [] }),
        fetchGreenhouseImpl: async (input) => {
          urls.push(String(input));

          return new Response(
            JSON.stringify({
              questions: [
                {
                  label: common.text,
                  required: false,
                  fields: [{ name: "question_1", type: "input_text", values: [] }],
                },
                {
                  label: "Telefone",
                  required: true,
                  fields: [{ name: "phone", type: "input_text", values: [] }],
                },
              ],
            }),
          );
        },
      });

      const res = await instance.handle(
        new Request(`http://localhost/api/me/jobs/${job.id}/ai-apply`, {
          method: "POST",
          headers: {
            "x-test-session": "talent",
            "x-test-talent-id": created.id,
            origin: webOrigin,
          },
        }),
      );

      expect(res.status).toBe(201);
      expect(urls).toEqual([
        "https://boards-api.greenhouse.io/v1/boards/acme/jobs/42?questions=true",
      ]);
      const { attempt } = await res.json();

      expect(attempt.answers).toEqual([
        {
          questionId: "question_1",
          value: "Resposta pronta",
          source: "library",
          inferred: false,
          status: "filled",
        },
        {
          questionId: "phone",
          value: null,
          source: null,
          inferred: false,
          status: "blank",
        },
      ]);

      const confirmed = await instance.handle(
        new Request(`http://localhost/api/me/ai-applications/${attempt.id}/confirm`, {
          method: "POST",
          headers: {
            "x-test-session": "talent",
            "x-test-talent-id": created.id,
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            answers: [
              { questionId: "question_1", value: "Resposta final" },
              { questionId: "phone", value: "11 99999-8888" },
            ],
          }),
        }),
      );

      expect(confirmed.status).toBe(200);
      expect(
        (await repos.answers.library(created.id)).questions.find((item) => item.id === common.id)
          ?.answer,
      ).toBe("Resposta final");
      expect((await repos.preferences.get(created.id)).profileFields.phone).toEqual({
        value: "11 99999-8888",
        share: true,
      });

      const [saved] = await db
        .select({ updatedAt: talentPreferences.updatedAt })
        .from(talentPreferences)
        .where(eq(talentPreferences.profileId, created.id));

      const [row] = await db
        .select({ confirmedAt: aiApplications.confirmedAt })
        .from(aiApplications)
        .where(eq(aiApplications.id, attempt.id));

      expect(saved.updatedAt).toEqual(row.confirmedAt);
    });

    it("runs a confirmed AI application from the scheduled drain", async () => {
      const [firstCase] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

      const created = await repos.talent.enable({
        orgId: defaultOrgId,
        caseId: firstCase.id,
        personalEmail,
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
      await repos.talent.setAiApplyConsent(created.id, true, new Date());

      await db.insert(resumes).values({
        profileId: created.id,
        kind: "base",
        content: {
          headline: { id: "h", text: "Engenheira" },
          summary: { id: "s", text: "Backend" },
          experiences: [],
          education: [],
          skills: [],
          languages: [],
          contact: { email: null, phone: null, city: null, links: [] },
        },
      });

      const [job] = await db
        .insert(jobs)
        .values({
          origin: "external",
          source: "greenhouse",
          sourceKey: "acme:42",
          title: "Backend",
          company: "Acme",
          url: "https://job-boards.greenhouse.io/acme/jobs/42",
        })
        .returning({ id: jobs.id });

      const browser: string[] = [];
      const logged = vi.spyOn(console, "error");

      await onPlan("platinum-premium");

      const instance = createApp(webOrigin, repos, {
        ...appOptions,
        browserbase,
        generateStructured: async ({ schema }) => schema.parse({ answers: [] }),
        fetchGreenhouseImpl: async () =>
          new Response(
            JSON.stringify({
              questions: [
                {
                  label: "Por que a Acme?",
                  required: true,
                  fields: [{ name: "question_1", type: "input_text", values: [] }],
                },
              ],
            }),
          ),
        fetchBrowserImpl: async (input, init) => {
          const target = String(input);

          browser.push(`${init?.method ?? "GET"} ${target}`);

          return target === "https://api.browserbase.com/v1/sessions"
            ? Response.json({ id: "s1", connectUrl: "wss://connect.test/s1" })
            : new Response(null);
        },
      });

      const talentHeaders = {
        "x-test-session": "talent",
        "x-test-talent-id": created.id,
        origin: webOrigin,
        "content-type": "application/json",
      };

      const prepared = await instance.handle(
        new Request(`http://localhost/api/me/jobs/${job.id}/ai-apply`, {
          method: "POST",
          headers: talentHeaders,
        }),
      );

      const { attempt } = await prepared.json();

      const confirmed = await instance.handle(
        new Request(`http://localhost/api/me/ai-applications/${attempt.id}/confirm`, {
          method: "POST",
          headers: talentHeaders,
          body: JSON.stringify({ answers: [{ questionId: "question_1", value: "Pagamentos" }] }),
        }),
      );

      expect(confirmed.status).toBe(200);
      expect(
        (await db.select().from(backgroundJobs)).map((row) => [row.kind, row.subject, row.status]),
      ).toEqual([["ai_apply", attempt.id, "pending"]]);

      await db.delete(backgroundJobs);

      const drained = await instance.handle(
        new Request("http://localhost/api/background/drain", {
          method: "POST",
          headers: { authorization: `Bearer ${cronSecret}` },
        }),
      );

      expect(await drained.json()).toEqual({ processed: 1, failed: 0 });
      expect(
        (await db.select().from(aiApplications).where(eq(aiApplications.id, attempt.id)))[0],
      ).toMatchObject({ state: "assisted", reason: "error" });
      expect(browser).toEqual([
        "POST https://api.browserbase.com/v1/sessions",
        "GET https://api.browserbase.com/v1/sessions/s1/debug",
        "GET https://connect.test/s1",
        "POST https://api.browserbase.com/v1/sessions/s1",
      ]);
      expect(logged).toHaveBeenCalledWith("Browserbase live view failed", { name: "SyntaxError" });
      expect(logged).toHaveBeenCalledWith("AI application run failed", {
        name: "CdpError",
        message: "no websocket",
      });
      logged.mockRestore();
    });

    describe("running an AI application now", () => {
      const live =
        "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.test/s1";

      async function confirmedAttempt(
        fetchBrowserImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
      ) {
        const [firstCase] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

        const created = z.object({ id: z.uuid() }).parse(
          await repos.talent.enable({
            orgId: defaultOrgId,
            caseId: firstCase.id,
            personalEmail,
            sponsoredUntil,
          }),
        );

        await repos.talent.acceptTerms(created.id);
        await repos.talent.setAiApplyConsent(created.id, true, new Date());

        await db.insert(resumes).values({
          profileId: created.id,
          kind: "base",
          content: {
            headline: { id: "h", text: "Engenheira" },
            summary: { id: "s", text: "Backend" },
            experiences: [],
            education: [],
            skills: [],
            languages: [],
            contact: { email: null, phone: null, city: null, links: [] },
          },
          updatedAt: new Date(Date.now() - 60_000),
        });

        const [job] = await db
          .insert(jobs)
          .values({
            origin: "external",
            source: "greenhouse",
            sourceKey: "acme:42",
            title: "Backend",
            company: "Acme",
            url: "https://job-boards.greenhouse.io/acme/jobs/42",
          })
          .returning({ id: jobs.id });

        await onPlan("platinum-premium");

        const instance = createApp(webOrigin, repos, {
          ...appOptions,
          browserbase,
          generateStructured: async ({ schema }) => schema.parse({ answers: [] }),
          fetchGreenhouseImpl: async () =>
            new Response(
              JSON.stringify({
                questions: [
                  {
                    label: "Por que a Acme?",
                    required: true,
                    fields: [{ name: "question_1", type: "input_text", values: [] }],
                  },
                ],
              }),
            ),
          fetchBrowserImpl,
        });

        const headers = {
          "x-test-session": "talent",
          "x-test-talent-id": created.id,
          origin: webOrigin,
          "content-type": "application/json",
        };

        const prepared = await instance.handle(
          new Request(`http://localhost/api/me/jobs/${job.id}/ai-apply`, {
            method: "POST",
            headers,
          }),
        );

        const { attempt } = await prepared.json();

        const confirmed = await instance.handle(
          new Request(`http://localhost/api/me/ai-applications/${attempt.id}/confirm`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              answers: [{ questionId: "question_1", value: "Pagamentos" }],
              rehearsal: true,
            }),
          }),
        );

        expect(confirmed.status).toBe(200);

        const id = z.uuid().parse(attempt.id);

        const call = (path: string, method = "GET", talentId = created.id) =>
          instance.handle(
            new Request(`http://localhost/api${path}`, {
              method,
              headers: { ...headers, "x-test-talent-id": talentId },
            }),
          );

        return { instance, id, call, run: () => call(`/me/ai-applications/${id}/run`, "POST") };
      }

      const jobsOf = async (id: string) =>
        (await db.select().from(backgroundJobs).where(eq(backgroundJobs.subject, id))).map(
          (row) => row.status,
        );

      it("runs the attempt in the request and shows the live view only while running", async () => {
        const browser: string[] = [];
        const seen: { state: string; liveUrl: string | null }[] = [];
        const logged = vi.spyOn(console, "error");
        const [, otherCase] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

        const other = z.object({ id: z.uuid() }).parse(
          await repos.talent.enable({
            orgId: defaultOrgId,
            caseId: otherCase.id,
            personalEmail: "outra.pessoa@example.com",
            sponsoredUntil,
          }),
        );

        await repos.talent.acceptTerms(other.id);

        const theirs: number[] = [];

        const setup = await confirmedAttempt(async (input, init) => {
          const target = String(input);

          browser.push(`${init?.method ?? "GET"} ${target}`);

          if (target === "https://api.browserbase.com/v1/sessions") {
            return Response.json({ id: "s1", connectUrl: "wss://connect.test/s1" });
          }

          if (target.endsWith("/sessions/s1/debug")) {
            return Response.json({ debuggerFullscreenUrl: live, wsUrl: "wss://connect.test/s1" });
          }

          if (target === "https://connect.test/s1") {
            const mine = await setup.call(`/me/ai-applications/${setup.id}`);
            seen.push(await mine.json());
            theirs.push(
              (await setup.call(`/me/ai-applications/${setup.id}`, "GET", other.id)).status,
            );
          }

          return new Response(null);
        });

        await db.delete(backgroundJobs);

        const response = await setup.run();

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          id: setup.id,
          state: "assisted",
          reason: "error",
          liveUrl: null,
        });
        expect(seen).toMatchObject([{ state: "running", liveUrl: `${live}&navbar=false` }]);
        expect(theirs).toEqual([404]);
        expect(browser).toEqual([
          "POST https://api.browserbase.com/v1/sessions",
          "GET https://api.browserbase.com/v1/sessions/s1/debug",
          "GET https://connect.test/s1",
          "POST https://api.browserbase.com/v1/sessions/s1",
        ]);
        expect(await jobsOf(setup.id)).toEqual(["done"]);
        expect(
          (await db.select().from(aiApplications).where(eq(aiApplications.id, setup.id)))[0],
        ).toMatchObject({ state: "assisted", liveUrl: null });
        expect(JSON.stringify(logged.mock.calls)).not.toContain("browserbase.com/devtools");
        logged.mockRestore();
      });

      it("runs once when the cron got there first", async () => {
        const browser: string[] = [];
        const signals = new EventEmitter();
        const atSession = once(signals, "session");

        const logged = vi.spyOn(console, "error");

        const setup = await confirmedAttempt(async (input, init) => {
          const target = String(input);

          browser.push(`${init?.method ?? "GET"} ${target}`);

          if (target === "https://api.browserbase.com/v1/sessions") {
            signals.emit("session");
            await once(signals, "proceed");

            return Response.json({ id: "s1", connectUrl: "wss://connect.test/s1" });
          }

          return new Response(null);
        });

        const cron = setup.instance.handle(
          new Request("http://localhost/api/background/drain", {
            method: "POST",
            headers: { authorization: `Bearer ${cronSecret}` },
          }),
        );

        await atSession;

        const response = await setup.run();

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({ id: setup.id, state: "running" });

        signals.emit("proceed");

        expect(await (await cron).json()).toEqual({ processed: 1, failed: 0 });
        expect(
          browser.filter((call) => call === "POST https://api.browserbase.com/v1/sessions"),
        ).toHaveLength(1);
        expect(await jobsOf(setup.id)).toEqual(["done"]);
        expect(logged).toHaveBeenCalledWith("AI application run failed", {
          name: "CdpError",
          message: "no websocket",
        });
        logged.mockRestore();
      });

      it("leaves a job the cron already claimed to the cron", async () => {
        const browser: string[] = [];

        const setup = await confirmedAttempt(async (input) => {
          browser.push(String(input));

          return new Response(null);
        });

        expect(
          await repos.background.claim(1, new Date(), {
            target: { kind: "ai_apply", subject: setup.id },
          }),
        ).toHaveLength(1);

        const response = await setup.run();

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({ id: setup.id, state: "queued" });
        expect(browser).toEqual([]);
        expect(await jobsOf(setup.id)).toEqual(["running"]);
      });

      it("answers 202 when the job waits for a later retry", async () => {
        const browser: string[] = [];

        const setup = await confirmedAttempt(async (input) => {
          browser.push(String(input));

          return new Response(null);
        });

        await db
          .update(backgroundJobs)
          .set({ runAfter: new Date(Date.now() + 5 * 60_000) })
          .where(eq(backgroundJobs.subject, setup.id));

        const response = await setup.run();

        expect(response.status).toBe(202);
        expect(await response.json()).toMatchObject({ state: "queued" });
        expect(browser).toEqual([]);
        expect(await jobsOf(setup.id)).toEqual(["pending"]);
      });
    });

    it("answers 500 without data and rolls back every library save when a confirm fails", async () => {
      const [firstCase] = await db.select({ id: offboardingCases.id }).from(offboardingCases);

      const created = await repos.talent.enable({
        orgId: defaultOrgId,
        caseId: firstCase.id,
        personalEmail,
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
      await repos.talent.setAiApplyConsent(created.id, true, new Date());

      await db.insert(resumes).values({
        profileId: created.id,
        kind: "base",
        content: {
          headline: { id: "h", text: "Engenheira" },
          summary: { id: "s", text: "Backend" },
          experiences: [],
          education: [],
          skills: [],
          languages: [],
          contact: { email: null, phone: null, city: null, links: [] },
        },
      });

      const [job] = await db
        .insert(jobs)
        .values({
          origin: "external",
          source: "greenhouse",
          sourceKey: "acme:43",
          title: "Backend",
          company: "Acme",
          url: "https://job-boards.greenhouse.io/acme/jobs/43",
        })
        .returning({ id: jobs.id });

      const text = (name: string) => ({
        label: `Pergunta ${name}`,
        required: false,
        fields: [{ name, type: "input_text", values: [] }],
      });

      await onPlan("platinum-premium");

      const instance = createApp(webOrigin, repos, {
        ...appOptions,
        browserbase,
        generateStructured: async ({ schema }) => schema.parse({ answers: [] }),
        fetchGreenhouseImpl: async () =>
          new Response(JSON.stringify({ questions: [text("one"), text("two")] })),
      });

      const headers = {
        "x-test-session": "talent",
        "x-test-talent-id": created.id,
        origin: webOrigin,
        "content-type": "application/json",
      };

      const prepared = await instance.handle(
        new Request(`http://localhost/api/me/jobs/${job.id}/ai-apply`, {
          method: "POST",
          headers,
        }),
      );

      const { attempt } = await prepared.json();

      await db.execute(
        sql`alter table talent_answers add constraint boom_check check (answer <> 'segredo-da-ana')`,
      );

      try {
        const res = await instance.handle(
          new Request(`http://localhost/api/me/ai-applications/${attempt.id}/confirm`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              answers: [
                { questionId: "one", value: "resposta-valida" },
                { questionId: "two", value: "segredo-da-ana" },
              ],
            }),
          }),
        );

        expect(res.status).toBe(500);
        expect(await res.text()).toBe('{"error":"Internal error"}');
      } finally {
        await db.execute(sql`alter table talent_answers drop constraint boom_check`);
      }

      const [row] = await db
        .select({ state: aiApplications.state, confirmed: aiApplications.confirmed })
        .from(aiApplications)
        .where(eq(aiApplications.id, attempt.id));

      expect(row).toEqual({ state: "draft", confirmed: null });
      expect(
        (await repos.answers.library(created.id)).questions.filter((item) => item.answer !== null),
      ).toEqual([]);
    });

    it("hides the message of an error that carries its own code", async () => {
      const logged = vi.spyOn(console, "error");

      const failures = [
        Object.assign(new Error("connect ECONNREFUSED 10.0.0.7:5432"), { code: "ECONNREFUSED" }),
        new DOMException("signal timed out for ana@example.com", "TimeoutError"),
        new Error("plain secret for ana@example.com"),
      ];

      try {
        for (const failure of failures) {
          const instance = createApp(webOrigin, repos, {
            ...appOptions,
            auth: {
              ...auth,
              handler: async () => {
                throw failure;
              },
            },
          });

          const res = await instance.handle(new Request("http://localhost/api/auth/session"));

          expect(res.status).toBe(500);
          expect(await res.text()).toBe('{"error":"Internal error"}');
        }

        expect(JSON.stringify(logged.mock.calls)).not.toContain("ana@example.com");
        expect(JSON.stringify(logged.mock.calls)).not.toContain("10.0.0.7");
        expect(logged).toHaveBeenCalledWith("unhandled error", {
          name: "Error",
          code: "ECONNREFUSED",
        });
        expect(logged).toHaveBeenCalledWith("unhandled error", { name: "TimeoutError" });
        expect(logged).toHaveBeenCalledWith("unhandled error", { name: "Error" });
      } finally {
        logged.mockRestore();
      }
    });

    it("keeps a thrown status response", async () => {
      const instance = createApp(webOrigin, repos, {
        ...appOptions,
        auth: {
          ...auth,
          handler: async () => {
            throw status(409, { error: "Conflict" });
          },
        },
      });

      const res = await instance.handle(new Request("http://localhost/api/auth/session"));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Conflict" });
    });

    it("keeps Elysia's own answer for a malformed JSON body", async () => {
      const instance = createApp(webOrigin, repos, appOptions);

      for (const path of ["/api/me/resume", "/api/me/resumes/any"]) {
        const res = await instance.handle(
          new Request(`http://localhost${path}`, {
            method: "PATCH",
            headers: {
              "x-test-session": "talent",
              "content-type": "application/json",
              origin: webOrigin,
            },
            body: "{",
          }),
        );

        expect(res.status).toBe(400);
        expect(await res.text()).not.toContain("Internal error");
      }
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

        const created = await repos.talent.enable({
          orgId: defaultOrgId,
          caseId,
          personalEmail,
          sponsoredUntil,
        });

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

        const compatible = await asSession("talent", "/me/jobs", "GET", undefined, talentHeaders);

        expect(await compatible.json()).toMatchObject({ items: [], total: 0, matching: false });

        const listed = await asSession(
          "talent",
          "/me/jobs?view=all",
          "GET",
          undefined,
          talentHeaders,
        );

        const body = await listed.json();

        expect(listed.status).toBe(200);
        expect(body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
        expect(body.items.map((item: { title: string }) => item.title)).toEqual(["A", "B"]);
        expect(body.items[0]).toMatchObject({
          match: null,
          applied: false,
          aiApplyCapable: false,
          description: "",
        });

        const remote = await asSession(
          "talent",
          "/me/jobs?view=all&workModel=remote",
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
        expect(
          (await asSession("talent", "/me/jobs?view=none", "GET", undefined, talentHeaders)).status,
        ).toBe(422);
        expect((await asSession("admin", "/me/jobs")).status).toBe(403);

        const subscription = await repos.billing.getSubscription(defaultOrgId);

        if (!subscription) throw new Error("missing subscription");

        await repos.billing.updateSubscription(defaultOrgId, subscription.id, {
          status: "canceled",
        });

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
          orgId: defaultOrgId,
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
        expect(listed[0]).toMatchObject({ status: "sent", closedReason: null, channel: "manual" });
      });

      it("refuses a manual application while an AI submission awaits its check", async () => {
        const headers = await talentProfile(personalEmail, 0);
        const jobId = await seedJob("pending");
        const body = await baseResume(headers);

        const [pending] = await db
          .insert(aiApplications)
          .values({
            profileId: headers["x-test-talent-id"],
            jobId,
            state: "submitting",
            form: { questions: [] },
            draft: [],
            preparedAt: new Date(),
          })
          .returning({ id: aiApplications.id });

        for (const state of ["submitting", "needs_check"] as const) {
          await db.update(aiApplications).set({ state }).where(eq(aiApplications.id, pending.id));

          const refused = await send(headers, `/me/jobs/${jobId}/apply`, "POST", body);

          expect(refused.status).toBe(409);
          expect(await refused.json()).toEqual({ error: "AI application pending check" });
        }

        await db
          .update(aiApplications)
          .set({ state: "assisted", reason: "not_sent" })
          .where(eq(aiApplications.id, pending.id));

        expect((await send(headers, `/me/jobs/${jobId}/apply`, "POST", body)).status).toBe(201);
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

        const subscription = await repos.billing.getSubscription(defaultOrgId);

        if (!subscription) throw new Error("missing subscription");

        await repos.billing.updateSubscription(defaultOrgId, subscription.id, {
          status: "canceled",
        });

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

          const subscription = await repos.billing.getSubscription(defaultOrgId);

          if (!subscription) throw new Error("missing subscription");

          await repos.billing.updateSubscription(defaultOrgId, subscription.id, {
            status: "canceled",
          });
          await expectHidden("ana-dev");
        });

        it("keeps a collaborator's page public without sponsorship or subscription", async () => {
          const headers = await publicProfile();
          const profileId = headers["x-test-talent-id"];

          await publish(headers, "ana-dev");

          const [profile] = await db
            .update(talentProfiles)
            .set({ sponsoredUntil: "2000-01-01" })
            .where(eq(talentProfiles.id, profileId))
            .returning({ caseId: talentProfiles.caseId });

          const subscription = await repos.billing.getSubscription(defaultOrgId);

          if (!subscription?.id || !profile.caseId) throw new Error("missing fixtures");

          await repos.billing.updateSubscription(defaultOrgId, subscription.id, {
            status: "canceled",
          });

          expect((await visit("/public/pages/ana-dev")).status).toBe(404);

          await db.insert(employeeAccess).values({
            caseId: profile.caseId,
            orgId: defaultOrgId,
            email: `colaboradora-${randomUUID()}@example.com`,
            plan: emptyEmployeePlan,
          });

          expect((await visit("/public/pages/ana-dev")).status).toBe(200);

          await db
            .update(employeeAccess)
            .set({ email: null })
            .where(eq(employeeAccess.caseId, profile.caseId));

          expect((await visit("/public/pages/ana-dev")).status).toBe(404);
        });

        it("keeps the page public while the person has an active Carreira Pro", async () => {
          const headers = await publicProfile();
          const profileId = headers["x-test-talent-id"];

          await publish(headers, "ana-dev");
          await db
            .update(talentProfiles)
            .set({ sponsoredUntil: "2000-01-01" })
            .where(eq(talentProfiles.id, profileId));

          expect((await visit("/public/pages/ana-dev")).status).toBe(404);

          await db.insert(talentSubscriptions).values({
            profileId,
            status: "active",
            currentPeriodEnd: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          expect((await visit("/public/pages/ana-dev")).status).toBe(200);

          await db
            .update(talentSubscriptions)
            .set({ status: "past_due" })
            .where(eq(talentSubscriptions.profileId, profileId));

          expect((await visit("/public/pages/ana-dev")).status).toBe(404);
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

      type BillingStub = {
        configured: boolean;
        createSubscriptionCheckout: () => Promise<{ id: string; url: string }>;
        cancelSubscription: (id: string) => Promise<void>;
        refundCheckout: () => Promise<void>;
      };

      function billingStub(cancelled: string[], fail = false) {
        return {
          configured: true,
          createSubscriptionCheckout: async () => ({ id: "bill", url: "https://pay.example/bill" }),
          cancelSubscription: async (id) => {
            if (fail) throw new Error("gateway down");

            cancelled.push(id);
          },
          refundCheckout: async () => undefined,
        } satisfies BillingStub;
      }

      type Scoring = { output: object; calls: number; prompts: string[] };

      const rubric = [
        ["length", 5],
        ["consistency", 10],
        ["summary", 10],
        ["actionVerbs", 10],
        ["structure", 15],
        ["clarity", 15],
        ["keywords", 15],
        ["results", 20],
      ] as const;

      function assessed(total: number) {
        let left = total;

        return Object.fromEntries(
          rubric.map(([criterion, max]) => {
            const points = Math.min(max, left);

            left -= points;

            return [criterion, { points, reason: `Nota de ${criterion}` }];
          }),
        );
      }

      function breakdown(total: number) {
        const max = Object.fromEntries(rubric);

        return Object.fromEntries(
          Object.entries(assessed(total)).map(([criterion, entry]) => [
            criterion,
            { ...entry, max: max[criterion] },
          ]),
        );
      }

      type Matching = {
        scores: Record<string, number>;
        batches: string[][];
        before?: () => Promise<void>;
        omit?: boolean;
        fail?: boolean;
      };

      type Tailoring = { output: object; fail?: boolean };

      type Cover = { letter: string; fail?: boolean };

      type ModelCall = { kind: "tailor" | "match" | "cover"; prompt: string };

      const jobsInPrompt = z.array(z.object({ id: z.string(), title: z.string() }));

      function resumesApp(
        options: {
          generate?: GenerateStructured | null;
          storage?: boolean;
          draft?: object;
          embed?: Embed;
          embedProfile?: Embed;
          billing?: BillingStub;
          rerank?: Rerank;
          captcha?: Captcha;
        } = {},
      ) {
        const store: Store = { puts: [], removed: [], prefixes: [], failRemove: false };

        const scoring: Scoring = {
          output: { criteria: assessed(0), suggestions: [] },
          calls: 0,
          prompts: [],
        };

        const matching: Matching = { scores: {}, batches: [] };

        const tailoring: Tailoring = {
          output: { rewrites: [], experienceOrder: [], bulletOrder: [], skillIds: [] },
        };

        const cover: Cover = { letter: "Tenho experiência com backend." };

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
          get: async () => null,
        };

        const generate: GenerateStructured = async ({ schema, system, prompt }) => {
          if (system.startsWith("You write one cover letter")) {
            calls.push({ kind: "cover", prompt });

            if (cover.fail) throw leakyError(prompt);

            return schema.parse({ coverLetter: cover.letter });
          }

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
          scoring.prompts.push(prompt);

          return schema.parse(scoring.output);
        };

        const instance = createApp(webOrigin, repos, {
          ...appOptions,
          generateStructured:
            options.generate === null ? undefined : (options.generate ?? generate),
          embed: options.embed,
          embedProfile: options.embedProfile,
          captcha: options.captcha,
          storage: options.storage === false ? undefined : storage,
          abacatepay: options.billing,
          rerank: options.rerank,
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

        return { instance, store, scoring, matching, tailoring, cover, calls, kicks, settle };
      }

      async function profile(email = personalEmail, caseIndex = 0) {
        const cases: { id: string }[] = await (await call("/offboardings")).json();

        const created = await repos.talent.enable({
          orgId: defaultOrgId,
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

      function upload(instance: ReturnType<typeof resumesApp>["instance"], talentId: string) {
        const { isResume: _isResume, ...content } = draft;

        return create(instance, talentId, JSON.stringify(content), { bytes: pdf, name: "cv.pdf" });
      }

      function docx() {
        return zipSync({
          "word/document.xml": new TextEncoder().encode(
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Maria CV</w:t></w:r></w:p></w:body></w:document>',
          ),
          "[Content_Types].xml": new TextEncoder().encode("<Types/>"),
        });
      }

      function create(
        instance: ReturnType<typeof resumesApp>["instance"],
        talentId: string,
        content: string,
        file?: { bytes: Uint8Array; name: string },
      ) {
        const form = new FormData();

        form.set("content", content);

        if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name));

        return request(instance, talentId, "/me/resume", { method: "POST", body: form });
      }

      function readFile(
        instance: ReturnType<typeof resumesApp>["instance"],
        talentId: string,
        bytes: Uint8Array = pdf,
      ) {
        const form = new FormData();

        form.set("file", new File([new Uint8Array(bytes)], "cv.pdf", { type: "application/pdf" }));

        return request(instance, talentId, "/me/resume/read", { method: "POST", body: form });
      }

      const reviewed = {
        headline: { text: "Engenheira de Software" },
        summary: { text: "" },
        experiences: [
          { company: "Acme", role: "Dev", start: "2019", end: null, bullets: [{ text: "Fez X" }] },
        ],
        education: [],
        skills: [{ name: "Go" }],
        languages: [{ name: "Inglês", level: "Fluente" }],
        contact: { email: null, phone: null, city: "Recife", links: [] },
      };

      it("reads a résumé without saving or storing it", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();

        const res = await readFile(instance, id);

        expect(res.status).toBe(200);

        const { content } = await res.json();

        expect(content.headline).toEqual({
          id: expect.any(String),
          text: "Engenheira de Software",
        });
        expect(content.experiences[0].bullets[0].text).toBe("Fez X");
        expect(store.puts).toEqual([]);
        expect((await request(instance, id, "/me/resume")).status).toBe(404);
      });

      it("refuses to read unsupported files, non-résumés and failed extractions", async () => {
        const id = await profile();
        const { instance } = resumesApp();
        const html = await readFile(instance, id, new TextEncoder().encode("<html></html>"));

        expect(html.status).toBe(422);
        expect(await html.json()).toEqual({ error: "Unsupported file" });

        const bomb = zipSync({ "word/document.xml": new Uint8Array(3_000_000).fill(0x61) });
        const large = await readFile(instance, id, bomb);

        expect(large.status).toBe(422);
        expect(await large.json()).toEqual({ error: "File too large" });

        const notResume = resumesApp({ draft: { ...draft, isResume: false } });
        const refused = await readFile(notResume.instance, id);

        expect(refused.status).toBe(422);
        expect(await refused.json()).toEqual({ error: "File is not a résumé" });

        const logged = vi.spyOn(console, "error");

        const failing = resumesApp({
          generate: async ({ prompt }) => {
            throw leakyError(prompt);
          },
        });

        const failed = await readFile(failing.instance, id);

        expect(failed.status).toBe(502);
        expect(await failed.json()).toEqual({ error: "Could not read the résumé" });
        logged.mockRestore();

        const unconfigured = await readFile(resumesApp({ generate: null }).instance, id);

        expect(unconfigured.status).toBe(503);
        expect(await unconfigured.json()).toEqual({ error: "Résumé reading not configured" });
      });

      it("creates the résumé from reviewed content and keeps the file", async () => {
        const { instance, store, settle } = resumesApp();
        const id = await profile();

        const first = await create(instance, id, JSON.stringify(reviewed), {
          bytes: pdf,
          name: "cv.pdf",
        });

        expect(first.status).toBe(200);

        const created = await first.json();

        expect(created).toMatchObject({ kind: "base", score: null, rescoring: true });
        expect(created.content.skills[0]).toEqual({ id: expect.any(String), name: "Go" });
        expect(created.content.contact.city).toBe("Recife");
        expect(store.puts).toEqual([
          {
            key: expect.stringMatching(new RegExp(`^resumes/${id}/[0-9a-f-]+\\.pdf$`)),
            contentType: "application/pdf",
          },
        ]);

        await settle();

        const fromScratch = await create(
          instance,
          id,
          JSON.stringify({ ...reviewed, experiences: [] }),
        );

        expect(fromScratch.status).toBe(200);
        expect((await fromScratch.json()).id).toBe(created.id);
        expect(store.puts).toHaveLength(1);
        expect(store.removed).toEqual([store.puts[0].key]);

        const asJson = await request(instance, id, "/me/resume", {
          method: "POST",
          json: { content: reviewed },
        });

        expect(asJson.status).toBe(200);

        const docxFile = await create(instance, id, JSON.stringify(reviewed), {
          bytes: docx(),
          name: "cv.docx",
        });

        expect(docxFile.status).toBe(200);
        expect(store.puts[1].key).toMatch(/\.docx$/);
      });

      it("refuses invalid, empty or unstorable résumés", async () => {
        const { instance, store } = resumesApp();
        const id = await profile();

        for (const content of ["{", JSON.stringify({ headline: {} })]) {
          const res = await create(instance, id, content);

          expect(res.status).toBe(422);
          expect(await res.json()).toEqual({ error: "Invalid résumé content" });
        }

        const tooLong = await create(
          instance,
          id,
          JSON.stringify({ ...reviewed, headline: { text: "a".repeat(2_001) } }),
        );

        expect(tooLong.status).toBe(422);
        expect(await tooLong.json()).toEqual({ error: "Invalid résumé content" });

        const malformed = await instance.handle(
          new Request("http://localhost/api/me/resume", {
            method: "POST",
            headers: {
              "x-test-session": "talent",
              "x-test-talent-id": id,
              origin: webOrigin,
              "content-type": "multipart/form-data; boundary=x",
            },
            body: "--x\r\nbroken",
          }),
        );

        expect(malformed.status).toBe(400);

        const duplicate = await create(
          instance,
          id,
          JSON.stringify({
            ...reviewed,
            skills: [
              { id: "same", name: "Go" },
              { id: "same", name: "Rust" },
            ],
          }),
        );

        expect(duplicate.status).toBe(422);
        expect(await duplicate.json()).toEqual({ error: "Duplicate node ids" });

        const empty = await create(
          instance,
          id,
          JSON.stringify({
            ...reviewed,
            headline: { text: "  " },
            experiences: [],
          }),
        );

        expect(empty.status).toBe(422);
        expect(await empty.json()).toEqual({ error: "Résumé is empty" });

        const html = await create(instance, id, JSON.stringify(reviewed), {
          bytes: new TextEncoder().encode("<html></html>"),
          name: "cv.pdf",
        });

        expect(html.status).toBe(422);
        expect(await html.json()).toEqual({ error: "Unsupported file" });

        expect(store.puts).toEqual([]);

        const noStorage = resumesApp({ storage: false });

        const unstorable = await create(noStorage.instance, id, JSON.stringify(reviewed), {
          bytes: pdf,
          name: "cv.pdf",
        });

        expect(unstorable.status).toBe(503);
        expect(await unstorable.json()).toEqual({ error: "Résumé upload not configured" });
        expect((await create(noStorage.instance, id, JSON.stringify(reviewed))).status).toBe(200);
      });

      it("removes the stored file when creating the résumé fails", async () => {
        const removed: string[] = [];

        const storage: ObjectStorage = {
          put: async () => undefined,
          remove: async (keys) => {
            removed.push(...keys);
          },
          removePrefix: async () => undefined,
          get: async () => null,
        };

        const failing = (fileStorage?: ObjectStorage) =>
          createApp(
            webOrigin,
            {
              ...repos,
              resumes: {
                ...repos.resumes,
                replaceBase: () => Promise.reject(new Error("db down")),
              },
            },
            { ...appOptions, storage: fileStorage },
          );

        const id = await profile();

        const withFile = await create(failing(storage), id, JSON.stringify(reviewed), {
          bytes: pdf,
          name: "cv.pdf",
        });

        expect(withFile.status).toBe(500);
        expect(removed).toHaveLength(1);
        expect((await create(failing(storage), id, JSON.stringify(reviewed))).status).toBe(500);
        expect((await create(failing(), id, JSON.stringify(reviewed))).status).toBe(500);
        expect(removed).toHaveLength(1);
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

        const subscription = await repos.billing.getSubscription(defaultOrgId);

        if (!subscription) throw new Error("missing subscription");

        await repos.billing.updateSubscription(defaultOrgId, subscription.id, {
          status: "canceled",
        });

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
          criteria: assessed(72),
          suggestions: [
            {
              targetNodeId: bullet.id,
              criterion: "results",
              suggestedText: "Reduziu o tempo de deploy com X",
              rationale: "Mostra o impacto",
              estimatedGain: 6,
              extraGainWithFacts: 5,
            },
            {
              targetNodeId: created.content.headline.id,
              criterion: "keywords",
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
          scoreBreakdown: breakdown(72),
          scoredAt: expect.any(String),
        });
        expect(suggestions).toEqual([
          {
            id: expect.any(String),
            targetNodeId: bullet.id,
            originalText: "Fez X",
            suggestedText: "Reduziu o tempo de deploy com X",
            rationale: "Mostra o impacto",
            criterion: "results",
            estimatedGain: 6,
            extraGainWithFacts: 5,
          },
          {
            id: expect.any(String),
            targetNodeId: created.content.headline.id,
            originalText: "Engenheira de Software",
            suggestedText: "Engenheira de Software Sênior",
            rationale: "Destaca a senioridade",
            criterion: "keywords",
            estimatedGain: 4,
            extraGainWithFacts: 0,
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
        const { instance, id, bullet, suggestions, settle, scoring } = await scoredResume();

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

        expect(resume).toMatchObject({
          score: 78,
          scoreBreakdown: {
            ...breakdown(72),
            results: { points: 6, max: 20, reason: expect.any(String) },
          },
          scoredAt: expect.any(String),
          rescoring: true,
        });
        expect(await (await request(instance, id, "/me/resume")).json()).toEqual(resume);
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

        scoring.output = {
          criteria: { ...assessed(72), results: { points: 7, reason: "Um número" } },
          suggestions: [],
        };

        await settle();

        expect(await (await request(instance, id, "/me/resume")).json()).toMatchObject({
          score: 79,
          scoreBreakdown: { results: { points: 7, max: 20, reason: "Um número" } },
          rescoring: false,
        });

        const anchored = scoring.prompts.at(-1) ?? "";

        expect(anchored).toContain('"points": 6');
        expect(anchored).toContain("<previous>");
        expect(anchored).toContain('"after": "Reduziu o tempo de deploy com X"');
      });

      it("rescores a résumé scored before the criteria when it is read", async () => {
        const { instance, id, created, scoring, kicks, settle } = await scoredResume();

        await db
          .update(resumes)
          .set({ scoreBreakdown: null, score: 64 })
          .where(eq(resumes.id, created.id));

        const first = await (await request(instance, id, "/me/resume")).json();
        const again = await (await request(instance, id, "/me/resume")).json();

        expect(first).toMatchObject({ score: 64, scoreBreakdown: null, rescoring: true });
        expect(again).toEqual(first);
        expect(await scoreJobs()).toMatchObject([
          { status: "done" },
          { subject: created.id, status: "pending" },
        ]);
        expect(await matchJobs()).toMatchObject([{ status: "done" }]);
        expect(await kicks()).toBe(1);
        expect(scoring.calls).toBe(2);
        expect(scoring.prompts[1]).not.toContain("<previous>");

        await settle();

        expect(await (await request(instance, id, "/me/resume")).json()).toMatchObject({
          score: 72,
          scoreBreakdown: breakdown(72),
          rescoring: false,
        });
        expect(await scoreJobs()).toHaveLength(2);
      });

      it("keeps the previous score when its rescore failed, and never rescores without AI", async () => {
        const { instance, id, created, scoring } = await scoredResume();

        await db
          .update(resumes)
          .set({ scoreBreakdown: null, score: 64 })
          .where(eq(resumes.id, created.id));
        await db
          .update(backgroundJobs)
          .set({ status: "failed" })
          .where(eq(backgroundJobs.subject, created.id));

        expect(await (await request(instance, id, "/me/resume")).json()).toMatchObject({
          score: 64,
          rescoring: false,
        });

        await db.delete(backgroundJobs).where(eq(backgroundJobs.subject, created.id));

        const unconfigured = resumesApp({ generate: null });

        expect(await (await request(unconfigured.instance, id, "/me/resume")).json()).toMatchObject(
          { score: 64, rescoring: false },
        );
        expect(await scoreJobs()).toEqual([]);
        expect(scoring.calls).toBe(1);
      });

      it("runs the pending score in the request", async () => {
        const app = resumesApp();
        const id = await profile();
        const run = () => request(app.instance, id, "/me/resume/score/run", { method: "POST" });

        expect((await run()).status).toBe(404);
        expect(await (await run()).json()).toEqual({ error: "Résumé not found" });

        const created = await (await upload(app.instance, id)).json();

        expect(created).toMatchObject({ score: null, rescoring: true });

        app.scoring.output = { criteria: assessed(66), suggestions: [] };

        const ran = await run();

        expect(ran.status).toBe(200);
        expect(await ran.json()).toMatchObject({
          id: created.id,
          score: 66,
          scoreBreakdown: breakdown(66),
          rescoring: false,
        });
        expect(app.scoring.calls).toBe(1);
        expect(await scoreJobs()).toMatchObject([{ status: "done" }]);

        const idle = await run();

        expect(await idle.json()).toMatchObject({ score: 66, rescoring: false });
        expect(app.scoring.calls).toBe(1);
        expect(
          (
            await request(app.instance, id, "/me/resume/score/run", {
              method: "POST",
              session: "admin",
            })
          ).status,
        ).toBe(403);
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
              get: async () => null,
            },
            runInBackground: () => {
              throw new Error("should not kick a drain");
            },
          },
        );

        const id = await profile();
        const uploaded = await upload(instance, id);

        expect(uploaded.status).toBe(200);

        const view = await uploaded.json();

        expect(await request(instance, id, "/me/resume").then((res) => res.json())).toEqual(view);

        await db
          .update(resumes)
          .set({ score: 50, scoredAt: new Date() })
          .where(eq(resumes.id, view.id));

        expect(await request(instance, id, "/me/resume").then((res) => res.json())).toMatchObject({
          score: 50,
          rescoring: false,
        });
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
              get: async () => null,
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
        const listed = await (await request(instance, talentId, "/me/jobs?view=all")).json();

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
        expect(
          (await (await request(app.instance, id, "/me/jobs?view=all")).json()).items[0].match,
        ).toEqual({ score: 90, reasons: ["Combina com Designer"] });
      });

      it("does not score jobs the person rejected", async () => {
        const app = resumesApp();
        const id = await profile();

        await openJobs(["Engenheira de Software", "Designer", "Analista de Dados"]);

        const [designer] = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.title, "Designer"));

        await db
          .insert(jobRejections)
          .values({ profileId: id, jobId: designer.id, reason: "other" });

        await upload(app.instance, id);
        await app.settle();

        expect(app.matching.batches.flat().sort()).toEqual([
          "Analista de Dados",
          "Engenheira de Software",
        ]);
        expect((await storedMatches(id)).map((row) => row.jobId)).not.toContain(designer.id);
      });

      it("searches for the target titles before the résumé terms", async () => {
        const app = resumesApp();
        const id = await profile();

        await openJobs([
          ...Array.from({ length: 34 }, (_, index) => `Vaga ${index}`),
          "Zootecnista Veterinária",
        ]);

        await upload(app.instance, id);
        await app.settle();

        expect(app.matching.batches.flat()).not.toContain("Zootecnista Veterinária");

        await db.delete(jobMatches);
        await db.insert(talentPreferences).values({ profileId: id, targetTitles: ["Zootecnista"] });
        await repos.background.enqueue("compute_matches", id);
        await app.settle();

        expect(app.matching.batches.flat()).toContain("Zootecnista Veterinária");
      });

      async function embedOpenJobs(only?: (index: number) => boolean) {
        const rows = await db.select({ id: jobs.id, title: jobs.title }).from(jobs);

        for (const row of rows) {
          const index = Number(/Vaga (\d+)/.exec(row.title)?.[1]);

          if (only?.(index) === false) continue;

          await db
            .update(jobs)
            .set({ embedding: vectorAt(index), embeddedAt: new Date() })
            .where(eq(jobs.id, row.id));
        }
      }

      const vagas = (count: number) => Array.from({ length: count }, (_, index) => `Vaga ${index}`);

      it("scores the nearest embedded jobs and nothing more on a repeat run", async () => {
        const embedder = fakeEmbed();
        const app = resumesApp({ embed: embedder.embed });
        const id = await profile();

        await openJobs(vagas(60));
        await embedOpenJobs();
        await upload(app.instance, id);
        await app.settle();

        const first = app.matching.batches.flat();

        expect(first).toHaveLength(50);
        expect(new Set(first)).toEqual(new Set(vagas(50)));
        expect(embedder.calls).toHaveLength(1);
        expect(embedder.calls[0]).toHaveLength(1);

        await repos.background.enqueue("compute_matches", id);
        await app.settle();

        expect(app.matching.batches.flat()).toHaveLength(50);
        expect(embedder.calls).toHaveLength(1);
      });

      it("scores a new job inside the nearest fifty and ignores one outside", async () => {
        const embedder = fakeEmbed();
        const app = resumesApp({ embed: embedder.embed });
        const id = await profile();

        await openJobs(vagas(60));
        await embedOpenJobs();
        await upload(app.instance, id);
        await app.settle();

        await db.insert(jobs).values(
          [
            { title: "Perto", offset: 0 },
            { title: "Longe", offset: 1000 },
          ].map(({ title, offset }) => ({
            origin: "external" as const,
            source: "seed",
            sourceKey: title,
            title,
            company: "Acme",
            description: title,
            url: `https://jobs.example.com/${title}`,
            embedding: vectorAt(offset),
          })),
        );
        await repos.background.enqueue("compute_matches", id);
        await app.settle();

        expect(app.matching.batches.flat().slice(50)).toEqual(["Perto"]);
      });

      async function profileEmbedding(profileId: string) {
        const [row] = await db
          .select({ embedding: resumes.profileEmbedding, hash: resumes.profileEmbeddedHash })
          .from(resumes)
          .where(and(eq(resumes.profileId, profileId), eq(resumes.kind, "base")));

        return row;
      }

      it("embeds the whole profile for people search when the résumé is created or edited", async () => {
        const embedder = fakeEmbed();
        const app = resumesApp({ embedProfile: embedder.embed });
        const id = await profile();
        const profileCalls = () => embedder.calls.filter((call) => call.length === 1);

        const created = await (await upload(app.instance, id)).json();

        await app.settle();

        const first = await profileEmbedding(id);

        expect(first.embedding).toHaveLength(1024);
        expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(profileCalls()).toEqual([
          [
            "Engenheira de Software\nDez anos de experiência\nDev · Acme · 2019 – atual\nFez X\nTypeScript",
          ],
        ]);

        await repos.background.enqueue("embed_profile", created.id);
        await app.settle();

        expect(profileCalls()).toHaveLength(1);

        const edited = await request(app.instance, id, "/me/resume", {
          method: "PATCH",
          json: {
            content: {
              ...created.content,
              languages: [{ name: "Inglês", level: "Fluente" }],
              contact: { ...created.content.contact, email: "maria@example.com", city: "Recife" },
            },
          },
        });

        expect(edited.status).toBe(200);

        await app.settle();

        expect(profileCalls()).toHaveLength(2);
        expect(profileCalls()[1][0]).toContain("Inglês (Fluente)\nRecife");
        expect(profileCalls()[1][0]).not.toContain("maria@example.com");
        expect((await profileEmbedding(id)).hash).not.toBe(first.hash);
      });

      it("finds only people who opted in to the public candidate search", async () => {
        const embedder = fakeEmbed();

        const fakeRerank: Rerank = async (_query, candidates) =>
          candidates.map((c) => ({ ...c, match: matchScore(c.distance) }));

        const app = resumesApp({ embedProfile: embedder.embed, rerank: fakeRerank });
        const visible = await profile();
        const hidden = await profile("outra.pessoal@example.com", 1);

        await upload(app.instance, visible);
        await upload(app.instance, hidden);
        await app.settle();
        await repos.talent.setSearchable(visible, true, new Date());

        const find = (instance: typeof app.instance, q: string) =>
          instance.handle(
            new Request(`http://localhost/api/candidates/search?q=${encodeURIComponent(q)}`),
          );

        const res = await find(app.instance, "engenheira backend");

        expect(res.status).toBe(200);

        const cards = await res.json();

        expect(cards).toEqual([
          {
            id: expect.any(String),
            name: expect.any(String),
            headline: "Engenheira de Software",
            summary: "Dez anos de experiência",
            city: null,
            match: expect.any(Number),
            experiences: [{ role: "Dev", company: "Acme", start: "2019", end: null }],
            skills: ["TypeScript"],
            languages: [],
          },
        ]);
        expect(JSON.stringify(cards)).not.toContain("@");

        const noRerank = resumesApp({ embedProfile: embedder.embed });
        const plain = await find(noRerank.instance, "engenheira backend");

        expect(plain.status).toBe(200);

        expect((await find(resumesApp().instance, "dev")).status).toBe(503);
        expect((await find(app.instance, "a")).status).toBe(422);

        const logged = vi.spyOn(console, "error");

        embedder.state.fail = true;

        const failed = await find(app.instance, "dev");

        expect(failed.status).toBe(502);
        expect(logged.mock.calls).toContainEqual([
          "candidate search embedding failed",
          { name: "Error", message: "embeddings down" },
        ]);
        logged.mockRestore();

        await db
          .update(demoSearchUsage)
          .set({ searches: 2_000 })
          .where(eq(demoSearchUsage.bucket, "candidates:all"));

        const capped = await find(app.instance, "dev");

        expect(capped.status).toBe(429);
        expect(await capped.json()).toEqual({ error: "Too many searches" });
      });

      it("emails an opted-in candidate once the sender confirms their address", async () => {
        const app = resumesApp({ embedProfile: fakeEmbed().embed });
        const visible = await profile();
        const hidden = await profile("outra.pessoal@example.com", 1);
        const shown = await (await upload(app.instance, visible)).json();
        const kept = await (await upload(app.instance, hidden)).json();

        await repos.talent.setSearchable(visible, true, new Date());
        await db.delete(demoSearchUsage);

        const post = (path: string, body: Record<string, string>) =>
          app.instance.handle(
            new Request(`http://localhost/api${path}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
          );

        const contact = (id: string, body: Record<string, string>) =>
          post(`/candidates/${id}/contact`, body);

        const confirm = (token: string) => post("/candidates/contact/confirm", { token });

        const lastToken = () => {
          const match = /confirmar\?token=([\w-]+)/.exec(sentTexts.at(-1) ?? "");

          return match?.[1] ?? "";
        };

        const message = {
          name: "  Rita Recrutadora ",
          email: "rita@empresa.example",
          company: " Empresa X ",
          message: "  Temos uma vaga de backend sênior remota e seu perfil combina muito.  ",
        };

        const requested = await contact(shown.id, message);

        expect(requested.status).toBe(202);
        expect(invitedEmails.at(-1)).toBe("rita@empresa.example");
        expect(sentTexts.at(-1)).toContain("A mensagem só é enviada depois que você confirmar");
        expect(sentTexts.at(-1)).not.toContain("Temos uma vaga");

        const token = lastToken();

        expect(token).toMatch(/^[\w-]{43}$/);

        const confirmed = await confirm(token);

        expect(confirmed.status).toBe(204);
        expect(invitedEmails.at(-1)).toBe(personalEmail);
        expect(sentTexts.at(-1)).toContain("Rita Recrutadora (Empresa X) encontrou seu currículo");
        expect(sentTexts.at(-1)).toContain("\n\nTemos uma vaga de backend sênior remota");
        expect(sentTexts.at(-1)).toContain("responda direto para rita@empresa.example");

        const used = await confirm(token);

        expect(used.status).toBe(404);
        expect(await used.json()).toEqual({ error: "Link expired or already used" });
        expect((await confirm("x".repeat(43))).status).toBe(404);
        expect((await confirm("short")).status).toBe(422);

        const { company: _company, ...withoutCompany } = message;

        expect(
          (await contact(shown.id, { ...withoutCompany, email: "Outra@Empresa.example" })).status,
        ).toBe(202);
        expect((await confirm(lastToken())).status).toBe(204);
        expect(sentTexts.at(-1)).toContain("Rita Recrutadora encontrou seu currículo");

        expect((await contact(kept.id, message)).status).toBe(404);
        expect((await contact("not-a-uuid", message)).status).toBe(422);
        expect((await contact(shown.id, { ...message, message: "oi" })).status).toBe(422);

        await db.delete(demoSearchUsage);
        await contact(shown.id, message);

        const expiring = lastToken();

        await db
          .update(candidateContactRequests)
          .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
          .where(eq(candidateContactRequests.tokenHash, await textHash(expiring)));

        expect((await confirm(expiring)).status).toBe(404);

        await contact(shown.id, { ...message, email: "terceira@empresa.example" });

        const optedOut = lastToken();

        await repos.talent.setSearchable(visible, false, new Date());

        expect((await confirm(optedOut)).status).toBe(404);

        await repos.talent.setSearchable(visible, true, new Date());
        await db.delete(demoSearchUsage);

        const logged = vi.spyOn(console, "error");

        inviteFailures.remaining = 1;

        const unconfirmed = await contact(shown.id, message);

        expect(unconfirmed.status).toBe(502);
        expect(await unconfirmed.json()).toEqual({ error: "Could not send the confirmation" });

        await contact(shown.id, message);

        const retried = lastToken();

        inviteFailures.remaining = 1;

        const failed = await confirm(retried);

        expect(failed.status).toBe(502);
        expect(await failed.json()).toEqual({ error: "Could not send the message" });
        expect(logged.mock.calls).toContainEqual([
          "candidate contact confirmation failed",
          { name: "Error", message: "invite failed" },
        ]);
        expect(logged.mock.calls).toContainEqual([
          "candidate contact email failed",
          { name: "Error", message: "invite failed" },
        ]);
        logged.mockRestore();

        expect((await confirm(retried)).status).toBe(204);

        await db.delete(demoSearchUsage);
        await contact(shown.id, message);

        const busy = lastToken();

        await db.insert(demoSearchUsage).values({
          bucket: `contact:to:${shown.id}`,
          day: new Date().toISOString().slice(0, 10),
          searches: 5,
        });

        const full = await confirm(busy);

        expect(full.status).toBe(429);
        expect(await full.json()).toEqual({ error: "Too many messages" });
        await db.delete(demoSearchUsage);

        expect((await confirm(busy)).status).toBe(204);

        await db.delete(demoSearchUsage);

        for (let index = 0; index < 3; index += 1) {
          expect((await contact(shown.id, message)).status).toBe(202);
        }

        expect((await contact(shown.id, message)).status).toBe(429);

        await db.delete(demoSearchUsage);

        for (let index = 0; index < 5; index += 1) {
          await contact(kept.id, { ...message, email: `p${index}@empresa.example` });
        }

        const capped = await contact(shown.id, { ...message, email: "nova@empresa.example" });

        expect(capped.status).toBe(429);
        expect(await capped.json()).toEqual({ error: "Too many messages" });
      });

      it("asks for a captcha before sending a confirmation when one is configured", async () => {
        const verdicts: (boolean | Error)[] = [];
        const checked: [string, string | null][] = [];

        const captcha: Captcha = {
          siteKey: "site-key",
          verify: async (token, ip) => {
            checked.push([token, ip]);

            const verdict = verdicts.shift() ?? true;

            if (verdict instanceof Error) throw verdict;

            return verdict;
          },
        };

        const app = resumesApp({ captcha });
        const visible = await profile();
        const shown = await (await upload(app.instance, visible)).json();

        await repos.talent.setSearchable(visible, true, new Date());
        await db.delete(demoSearchUsage);

        const siteKey = async (instance: typeof app.instance) =>
          (
            await instance.handle(new Request("http://localhost/api/candidates/contact/captcha"))
          ).json();

        expect(await siteKey(app.instance)).toEqual({ siteKey: "site-key" });
        expect(await siteKey(resumesApp().instance)).toEqual({ siteKey: null });

        const contact = (body: Record<string, string>) =>
          app.instance.handle(
            new Request(`http://localhost/api/candidates/${shown.id}/contact`, {
              method: "POST",
              headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
              body: JSON.stringify({
                name: "Rita",
                email: "rita@empresa.example",
                message: "Temos uma vaga que combina com você.",
                ...body,
              }),
            }),
          );

        const missing = await contact({});

        expect(missing.status).toBe(403);
        expect(await missing.json()).toEqual({ error: "Captcha failed" });
        expect(checked).toEqual([]);

        verdicts.push(false);
        expect((await contact({ captcha: "bad" })).status).toBe(403);

        const logged = vi.spyOn(console, "error");

        verdicts.push(new Error("turnstile down"));
        expect((await contact({ captcha: "later" })).status).toBe(403);
        expect(logged.mock.calls).toContainEqual([
          "captcha verification failed",
          { name: "Error", message: "turnstile down" },
        ]);
        logged.mockRestore();

        expect((await contact({ captcha: "good" })).status).toBe(202);
        expect(checked.at(-1)).toEqual(["good", "203.0.113.9"]);
      });

      it("forgets contact requests after 30 days and search counters after a week", async () => {
        const app = resumesApp();
        const resume = await (await upload(app.instance, await profile())).json();
        const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const dayOf = (days: number) => daysAgo(days).toISOString().slice(0, 10);

        const request = (tokenHash: string, createdAt: Date) => ({
          resumeId: resume.id,
          name: "Rita",
          email: "rita@empresa.example",
          message: "Temos uma vaga que combina com você.",
          tokenHash,
          createdAt,
        });

        await db.delete(demoSearchUsage);
        await db
          .insert(candidateContactRequests)
          .values([request("old", daysAgo(31)), request("recent", daysAgo(29))]);
        await db.insert(demoSearchUsage).values([
          { bucket: "contact:all", day: dayOf(8), searches: 1 },
          { bucket: "contact:all", day: dayOf(6), searches: 1 },
        ]);

        await app.settle();

        const kept = await db
          .select({ tokenHash: candidateContactRequests.tokenHash })
          .from(candidateContactRequests);

        const days = await db.select({ day: demoSearchUsage.day }).from(demoSearchUsage);

        expect(kept).toEqual([{ tokenHash: "recent" }]);
        expect(days).toEqual([{ day: dayOf(6) }]);
      });

      it("backfills profiles without a search embedding and skips what it cannot embed", async () => {
        const embedder = fakeEmbed();
        const app = resumesApp({ embedProfile: embedder.embed });
        const id = await profile();
        const created = await (await upload(app.instance, id)).json();

        await db.delete(backgroundJobs).where(eq(backgroundJobs.kind, "embed_profile"));
        await app.settle();

        expect((await profileEmbedding(id)).embedding).toHaveLength(1024);
        expect(embedder.calls.length).toBeGreaterThan(0);

        const calls = embedder.calls.length;

        await repos.background.enqueue("embed_profile", crypto.randomUUID());
        await app.settle();

        expect(embedder.calls).toHaveLength(calls);

        const disabled = resumesApp();

        await db
          .update(resumes)
          .set({ profileEmbedding: null, profileEmbeddedHash: null })
          .where(eq(resumes.id, created.id));
        await repos.background.enqueue("embed_profile", created.id);
        await disabled.settle();

        expect(await profileEmbedding(id)).toEqual({ embedding: null, hash: null });
      });

      it("logs a failed profile backfill without stopping the drain", async () => {
        const logged = vi.spyOn(console, "error");

        const failing = createApp(
          webOrigin,
          {
            ...repos,
            resumes: {
              ...repos.resumes,
              withoutProfileEmbedding: () => Promise.reject(new Error("db down")),
            },
            demo: { ...repos.demo, stored: () => Promise.reject(new Error("demo down")) },
          },
          { ...appOptions, embedProfile: fakeEmbed().embed },
        );

        const drained = await failing.handle(
          new Request("http://localhost/api/background/drain", {
            method: "POST",
            headers: { authorization: `Bearer ${cronSecret}` },
          }),
        );

        expect(drained.status).toBe(200);
        expect(logged.mock.calls).toContainEqual([
          "profile embedding backfill failed",
          { name: "Error", message: "db down" },
        ]);
        expect(logged.mock.calls).toContainEqual([
          "demo embedding sync failed",
          { name: "Error", message: "demo down" },
        ]);
        logged.mockRestore();
      });

      it("embeds the résumé again once its version changes", async () => {
        const embedder = fakeEmbed();
        const app = resumesApp({ embed: embedder.embed });
        const id = await profile();

        const created = await (await upload(app.instance, id)).json();

        await app.settle();

        const [stored] = await db
          .select({ embedding: resumes.embedding, hash: resumes.embeddedHash })
          .from(resumes)
          .where(eq(resumes.profileId, id));

        expect(stored.embedding).toHaveLength(1024);
        expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(embedder.calls).toHaveLength(1);

        await repos.background.enqueue("compute_matches", id);
        await app.settle();

        expect(embedder.calls).toHaveLength(1);

        await request(app.instance, id, "/me/resume", {
          method: "PATCH",
          json: {
            content: {
              ...created.content,
              headline: { ...created.content.headline, text: "Designer" },
            },
          },
        });
        await app.settle();

        expect(embedder.calls).toHaveLength(2);
        expect(embedder.calls[1][0]).toContain("Designer");
      });

      it("embeds the résumé again when the target titles change", async () => {
        const embedder = fakeEmbed();
        const app = resumesApp({ embed: embedder.embed });
        const id = await profile();

        await upload(app.instance, id);
        await app.settle();

        expect(embedder.calls).toHaveLength(1);

        await db.insert(talentPreferences).values({ profileId: id, targetTitles: ["Zootecnista"] });
        await repos.background.enqueue("compute_matches", id);
        await app.settle();

        expect(embedder.calls).toHaveLength(2);
        expect(embedder.calls[1][0]).toContain("Zootecnista");
      });

      it("tops up with text-search candidates when too few jobs are embedded", async () => {
        const embedder = fakeEmbed();
        const app = resumesApp({ embed: embedder.embed });
        const id = await profile();

        await openJobs(vagas(60));
        await embedOpenJobs((index) => index >= 55);
        await upload(app.instance, id);
        await app.settle();

        const scored = app.matching.batches.flat();

        expect(scored).toHaveLength(50);
        expect(scored).toEqual(expect.arrayContaining(vagas(60).slice(55)));
        expect(new Set(scored).size).toBe(50);
      });

      it("falls back to text-search candidates when embedding the résumé fails", async () => {
        const logged = vi.spyOn(console, "error");
        const embedder = fakeEmbed();
        const app = resumesApp({ embed: embedder.embed });
        const id = await profile();

        embedder.state.fail = true;
        await openJobs(vagas(60));
        await embedOpenJobs();
        await upload(app.instance, id);
        await app.settle();

        expect(app.matching.batches.flat()).toHaveLength(50);
        expect(logged.mock.calls).toContainEqual(["resume embedding failed", { name: "Error" }]);
        logged.mockRestore();
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
              get: async () => null,
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

        describe("cover letter and package", () => {
          const letterCalls = (calls: { kind: string }[]) =>
            calls.filter((modelCall) => modelCall.kind === "cover").length;

          const packageRows = (profileId: string) =>
            db
              .select({
                jobId: applicationPackages.jobId,
                coverLetter: applicationPackages.coverLetter,
                createdAt: applicationPackages.createdAt,
                updatedAt: applicationPackages.updatedAt,
              })
              .from(applicationPackages)
              .where(eq(applicationPackages.profileId, profileId));

          it("keeps non-shared fields out of the package", async () => {
            const jobId = await openJob("pacote");
            const { app, id, base, call } = await tailoringApp();

            const [{ id: questionId }] = await db
              .select({ id: answerQuestions.id })
              .from(answerQuestions)
              .where(eq(answerQuestions.common, true))
              .orderBy(asc(answerQuestions.text))
              .limit(1);

            await db.insert(talentPreferences).values({
              profileId: id,
              profileFields: {
                phone: { value: "11 90000-0000", share: false },
                city: { value: null, share: true },
                linkedin: { value: "linkedin.com/in/eu", share: true },
                availability: { value: "Imediata", share: true },
                salaryExpectation: { value: "R$ 9.000", share: false },
              },
            });
            await repos.answers.answer(id, questionId, "Resposta pronta", new Date());

            const res = await call(`/me/jobs/${jobId}/package`);
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body).toEqual({
              job: { title: "Backend", company: "Acme", url: "https://jobs.example.com/pacote" },
              resume: { id: base.id, kind: "base" },
              coverLetter: null,
              profile: [
                { field: "linkedin", value: "linkedin.com/in/eu" },
                { field: "availability", value: "Imediata" },
              ],
              answers: [{ question: expect.any(String), answer: "Resposta pronta" }],
            });
            expect(JSON.stringify(body)).not.toContain("90000");
            expect(JSON.stringify(body)).not.toContain("9.000");
            expect(app.calls).toEqual([]);
          });

          it("lists only the shared CPF, birth date and address in the package", async () => {
            const jobId = await openJob("formulario");
            const { id, call } = await tailoringApp();

            await db.insert(talentPreferences).values({
              profileId: id,
              profileFields: {
                linkedin: { value: "linkedin.com/in/eu", share: true },
                cpf: { value: "52998224725", share: true },
                birthDate: { value: "1990-05-17", share: true },
                address: {
                  value: {
                    cep: "01310100",
                    street: "Avenida Paulista",
                    number: "1000",
                    complement: "Sala 2",
                    neighborhood: "Bela Vista",
                    city: "São Paulo",
                    state: "SP",
                  },
                  share: true,
                },
              },
            });

            const shown = await (await call(`/me/jobs/${jobId}/package`)).json();

            expect(shown.profile).toEqual([
              { field: "linkedin", value: "linkedin.com/in/eu" },
              { field: "cpf", value: "529.982.247-25" },
              { field: "birthDate", value: "17/05/1990" },
              {
                field: "address",
                value:
                  "Avenida Paulista, 1000 - Sala 2 - Bela Vista, São Paulo - SP, CEP 01310-100",
              },
            ]);

            await db
              .update(talentPreferences)
              .set({
                profileFields: {
                  cpf: { value: "52998224725", share: false },
                  birthDate: { value: null, share: true },
                  address: {
                    value: {
                      cep: "01310100",
                      street: "Rua A",
                      number: "5",
                      complement: null,
                      neighborhood: "Centro",
                      city: "Campinas",
                      state: "SP",
                    },
                    share: true,
                  },
                },
              })
              .where(eq(talentPreferences.profileId, id));

            const partial = await (await call(`/me/jobs/${jobId}/package`)).json();

            expect(partial.profile).toEqual([
              { field: "address", value: "Rua A, 5 - Centro, Campinas - SP, CEP 01310-100" },
            ]);
            expect(JSON.stringify(partial)).not.toContain("52998224725");
            expect(JSON.stringify(partial)).not.toContain("529.982.247-25");
          });

          it("writes, stores and replaces the cover letter", async () => {
            const jobId = await openJob("carta");
            const { app, id, call } = await tailoringApp();

            app.cover.letter = "Primeira carta.";

            const first = await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(first.status).toBe(200);
            expect(await first.json()).toEqual({ coverLetter: "Primeira carta." });

            const [created] = await packageRows(id);

            expect(created).toMatchObject({ jobId, coverLetter: "Primeira carta." });
            expect(created.createdAt).toEqual(created.updatedAt);
            expect(await usage(id)).toEqual([{ calls: expect.any(Number) }]);

            app.cover.letter = "Segunda carta.";

            const second = await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(await second.json()).toEqual({ coverLetter: "Segunda carta." });

            const [replaced] = await packageRows(id);

            expect(replaced).toMatchObject({ coverLetter: "Segunda carta." });
            expect(replaced.createdAt).toEqual(created.createdAt);
            expect(replaced.updatedAt?.getTime()).toBeGreaterThanOrEqual(
              created.updatedAt?.getTime() ?? 0,
            );
            expect((await packageRows(id)).length).toBe(1);

            const shown = await (await call(`/me/jobs/${jobId}/package`)).json();

            expect(shown.coverLetter).toBe("Segunda carta.");
          });

          it("rejects an invented number with 502 and stores nothing", async () => {
            const jobId = await openJob("inventada");
            const { app, id, call } = await tailoringApp();
            const logged = vi.spyOn(console, "error");

            app.cover.letter = "Aumentei vendas em 40%.";

            const res = await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(res.status).toBe(502);
            expect(await res.json()).toEqual({ error: "Could not write the cover letter" });
            expect(await packageRows(id)).toEqual([]);

            app.cover.letter = "Segunda tentativa";
            await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });
            app.cover.letter = "Aumentei vendas em 40%.";

            const kept = await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(kept.status).toBe(502);
            expect((await packageRows(id)).map((row) => row.coverLetter)).toEqual([
              "Segunda tentativa",
            ]);
            logged.mockRestore();
          });

          it("allows a digit that comes from the company name", async () => {
            const [job] = await db
              .insert(jobs)
              .values({
                origin: "external",
                source: "seed",
                sourceKey: "noventa",
                title: "Backend",
                company: "99",
                description: "Vaga de 500 pessoas",
                url: "https://jobs.example.com/noventa",
              })
              .returning({ id: jobs.id });

            const { app, call } = await tailoringApp();

            app.cover.letter = "Quero trabalhar na 99.";

            expect((await call(`/me/jobs/${job.id}/cover-letter`, { method: "POST" })).status).toBe(
              200,
            );

            app.cover.letter = "Quero atender 500 pessoas.";

            expect((await call(`/me/jobs/${job.id}/cover-letter`, { method: "POST" })).status).toBe(
              502,
            );
          });

          it("uses the ready tailored version and otherwise the base résumé", async () => {
            const jobId = await openJob("versao");
            const otherJobId = await openJob("outra-versao");
            const { app, base, call, tailor, ready } = await tailoringApp();
            const { version } = await (await tailor(jobId)).json();

            app.calls.length = 0;

            const draftPackage = await (await call(`/me/jobs/${jobId}/package`)).json();

            expect(draftPackage.resume).toEqual({ id: base.id, kind: "base" });

            await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(app.calls.at(-1)?.prompt).toContain("Engenheira de Software");

            await ready(version.id);

            expect((await (await call(`/me/jobs/${jobId}/package`)).json()).resume).toEqual({
              id: version.id,
              kind: "tailored",
            });

            await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(app.calls.at(-1)?.prompt).toContain("Engenheira Backend");
            expect(app.calls.at(-1)?.prompt).not.toContain("Engenheira de Software");

            expect((await (await call(`/me/jobs/${otherJobId}/package`)).json()).resume).toEqual({
              id: base.id,
              kind: "base",
            });
          });

          it("shows another profile only its own package", async () => {
            const jobId = await openJob("isolada");
            const { app, call } = await tailoringApp();
            const other = await tailoringApp("outra.pessoal@example.com", 1);

            app.cover.letter = "Carta da primeira pessoa.";
            await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            const theirs = await other.call(`/me/jobs/${jobId}/package`);

            expect(await theirs.json()).toMatchObject({ coverLetter: null, profile: [] });
            expect(
              JSON.stringify(await other.call(`/me/jobs/${jobId}/package`).then((r) => r.json())),
            ).not.toContain("primeira pessoa");
            expect((await (await call(`/me/jobs/${jobId}/package`)).json()).coverLetter).toBe(
              "Carta da primeira pessoa.",
            );
          });

          it("answers 429 without generating once the cap is reached", async () => {
            const jobId = await openJob("teto-carta");
            const { app, id, call } = await tailoringApp();

            await db.update(llmUsage).set({ calls: 30 }).where(eq(llmUsage.profileId, id));
            app.calls.length = 0;

            const res = await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(res.status).toBe(429);
            expect(await res.json()).toEqual({ error: "Daily AI limit reached" });
            expect(letterCalls(app.calls)).toBe(0);
            expect(await usage(id)).toEqual([{ calls: 30 }]);
            expect(await packageRows(id)).toEqual([]);
          });

          it("refuses a cover letter after applying without spending a call", async () => {
            const jobId = await openJob("carta-aplicada");
            const { app, id, base, call, apply } = await tailoringApp();

            expect((await apply(jobId, base.id)).status).toBe(201);

            const spent = await usage(id);

            app.calls.length = 0;

            const res = await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(res.status).toBe(409);
            expect(await res.json()).toEqual({ error: "Already applied" });
            expect(letterCalls(app.calls)).toBe(0);
            expect(await usage(id)).toEqual(spent);
            expect(await packageRows(id)).toEqual([]);
          });

          it("shows the package of a closed job only to someone who applied or has a package", async () => {
            const applied = await openJob("fechada-aplicada");
            const stored = await openJob("fechada-pacote");
            const untouched = await openJob("fechada-nada");
            const { id, base, call, apply } = await tailoringApp();
            const other = await tailoringApp("outra.fechada@example.com", 1);

            expect((await apply(applied, base.id)).status).toBe(201);
            await db.insert(applicationPackages).values({
              profileId: id,
              jobId: stored,
              coverLetter: "Carta guardada.",
            });
            await db.update(jobs).set({ closedAt: new Date() });

            const appliedRes = await call(`/me/jobs/${applied}/package`);

            expect(appliedRes.status).toBe(200);
            expect(await appliedRes.json()).toMatchObject({
              job: { title: "Backend" },
              resume: { id: base.id, kind: "base" },
            });

            const storedRes = await call(`/me/jobs/${stored}/package`);

            expect(storedRes.status).toBe(200);
            expect((await storedRes.json()).coverLetter).toBe("Carta guardada.");

            for (const jobId of [applied, stored, untouched]) {
              const denied = jobId === untouched ? call : other.call;
              const res = await denied(`/me/jobs/${jobId}/package`);

              expect(res.status).toBe(404);
              expect(await res.json()).toEqual({ error: "Job not found" });
            }

            const letter = await call(`/me/jobs/${stored}/cover-letter`, { method: "POST" });

            expect(letter.status).toBe(404);
          });

          it("answers 502 when the model fails and logs a summary", async () => {
            const jobId = await openJob("falha-carta");
            const { app, id, call } = await tailoringApp();
            const logged = vi.spyOn(console, "error");

            app.cover.fail = true;

            const res = await call(`/me/jobs/${jobId}/cover-letter`, { method: "POST" });

            expect(res.status).toBe(502);
            expect(await res.json()).toEqual({ error: "Could not write the cover letter" });
            expect(await packageRows(id)).toEqual([]);
            expect(logged.mock.calls).toEqual([
              ["cover letter failed", { name: "Error", message: "gateway down" }],
            ]);
            logged.mockRestore();
          });

          it("checks the job, the résumé and the AI before spending a call", async () => {
            const jobId = await openJob("ordem-carta");
            const closedId = await openJob("fechada-carta", new Date());
            const { app, id, call } = await tailoringApp();
            const unconfigured = resumesApp({ generate: null });
            const bare = await profile("sem.curriculo@example.com", 1);
            const spent = await usage(id);

            for (const missing of [crypto.randomUUID(), closedId, "not-a-uuid"]) {
              for (const [path, method] of [
                ["cover-letter", "POST"],
                ["package", "GET"],
              ]) {
                const res = await call(`/me/jobs/${missing}/${path}`, { method });

                expect(res.status).toBe(404);
                expect(await res.json()).toEqual({ error: "Job not found" });
              }
            }

            expect(await usage(id)).toEqual(spent);
            expect(letterCalls(app.calls)).toBe(0);

            const bareSpent = await usage(bare);

            const noBase = await request(app.instance, bare, `/me/jobs/${jobId}/cover-letter`, {
              method: "POST",
            });

            expect(noBase.status).toBe(409);
            expect(await noBase.json()).toEqual({ error: "Upload a résumé first" });
            expect(await usage(bare)).toEqual(bareSpent);

            const bareView = await request(app.instance, bare, `/me/jobs/${jobId}/package`);

            expect(await bareView.json()).toMatchObject({ resume: null, coverLetter: null });

            const before = await usage(id);

            const noAi = await request(
              unconfigured.instance,
              id,
              `/me/jobs/${jobId}/cover-letter`,
              {
                method: "POST",
              },
            );

            expect(noAi.status).toBe(503);
            expect(await noAi.json()).toEqual({ error: "AI not configured" });
            expect(await usage(id)).toEqual(before);

            for (const path of ["cover-letter", "package"]) {
              expect(
                (
                  await request(app.instance, id, `/me/jobs/${jobId}/${path}`, {
                    method: path === "package" ? "GET" : "POST",
                    session: "admin",
                  })
                ).status,
              ).toBe(403);
            }
          });
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
          criteria: assessed(64),
          suggestions: [
            {
              targetNodeId: created.content.experiences[0].bullets[0].id,
              criterion: "results",
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
          aiApplyConsentAt: null,
          aiApplyConsentVersion: null,
          searchableAt: null,
          firstSignedInAt: null,
          createdAt: expect.any(String),
        });
        expect(body.resumes).toEqual([
          {
            kind: "base",
            status: "ready",
            content: expect.any(Object),
            score: 64,
            scoreBreakdown: breakdown(64),
            scoredAt: expect.any(String),
            updatedAt: expect.any(String),
            job: null,
            matchScore: null,
            suggestions: [
              {
                originalText: "Fez X",
                suggestedText: "Fez X com impacto",
                rationale: "Mostra o impacto",
                criterion: "results",
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
            scoreBreakdown: null,
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

      describe("rejections", () => {
        const reject = (
          instance: ReturnType<typeof resumesApp>["instance"],
          id: string,
          jobId: string,
          json: { reason?: string | number; note?: string | number | null } = { reason: "salary" },
        ) => request(instance, id, `/me/jobs/${jobId}/reject`, { method: "POST", json });

        const unreject = (
          instance: ReturnType<typeof resumesApp>["instance"],
          id: string,
          jobId: string,
        ) => request(instance, id, `/me/jobs/${jobId}/reject`, { method: "DELETE" });

        async function openJob(title: string, values: Partial<typeof jobs.$inferInsert> = {}) {
          const [row] = await db
            .insert(jobs)
            .values({
              origin: "external",
              source: "seed",
              sourceKey: title,
              title,
              company: "Acme",
              url: `https://jobs.example.com/${title}`,
              ...values,
            })
            .returning({ id: jobs.id });

          return row.id;
        }

        async function listed(instance: ReturnType<typeof resumesApp>["instance"], id: string) {
          const body = await (await request(instance, id, "/me/jobs?view=all")).json();

          return body.items.map((item: { title: string }) => item.title);
        }

        it("requires an active talent session", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const jobId = await openJob("Vaga");

          expect((await reject(instance, id, jobId)).status).toBe(204);

          for (const [path, method] of [
            [`/me/jobs/${jobId}/reject`, "POST"],
            [`/me/jobs/${jobId}/reject`, "DELETE"],
            ["/me/rejections", "GET"],
          ]) {
            const json = method === "POST" ? { reason: "other" } : undefined;

            expect(
              (await request(instance, id, path, { method, json, session: "admin" })).status,
            ).toBe(403);
            expect(
              (
                await instance.handle(
                  new Request(`http://localhost/api${path}`, {
                    method,
                    headers: json ? { "content-type": "application/json" } : {},
                    body: json ? JSON.stringify(json) : undefined,
                  }),
                )
              ).status,
            ).toBe(403);
          }
        });

        it("hides rejected jobs and brings them back when the rejection is removed", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const other = await profile("outra.pessoal@example.com", 1);
          await openJob("Fica", { postedAt: new Date("2026-02-01T00:00:00Z") });
          const drop = await openJob("Some", { postedAt: new Date("2026-01-01T00:00:00Z") });

          expect(await listed(instance, id)).toEqual(["Fica", "Some"]);

          const res = await reject(instance, id, drop, { reason: "company" });

          expect(res.status).toBe(204);
          expect(await res.text()).toBe("");
          expect(await listed(instance, id)).toEqual(["Fica"]);
          expect(await listed(instance, other)).toEqual(["Fica", "Some"]);
          expect((await (await request(instance, id, "/me/jobs?view=all")).json()).total).toBe(1);

          expect((await unreject(instance, id, drop)).status).toBe(204);
          expect((await unreject(instance, id, drop)).status).toBe(204);
          expect((await unreject(instance, id, "not-a-uuid")).status).toBe(204);
          expect(await listed(instance, id)).toEqual(["Fica", "Some"]);
        });

        it("answers 404 for unknown, malformed and closed jobs", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const closed = await openJob("Fechada", { closedAt: new Date() });

          for (const jobId of [crypto.randomUUID(), "not-a-uuid", closed]) {
            const res = await reject(instance, id, jobId);

            expect(res.status).toBe(404);
            expect(await res.json()).toEqual({ error: "Job not found" });
          }
        });

        it("validates the reason and the note", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const jobId = await openJob("Vaga");

          const invalid = [
            {},
            { reason: "nope" },
            { reason: 1 },
            { reason: "other", note: 5 },
            { reason: "other", note: "x".repeat(501) },
            { reason: "other", note: `  ${"x".repeat(500)}  ${"y".repeat(1)}` },
          ];

          for (const json of invalid) {
            const res = await reject(instance, id, jobId, json);

            expect(res.status).toBe(422);
            expect(await res.json()).toEqual({ error: "Invalid rejection" });
          }

          expect(await db.select().from(jobRejections)).toEqual([]);
          expect(
            (
              await instance.handle(
                new Request(`http://localhost/api/me/jobs/${jobId}/reject`, {
                  method: "POST",
                  headers: {
                    "x-test-session": "talent",
                    "x-test-talent-id": id,
                    origin: webOrigin,
                  },
                }),
              )
            ).status,
          ).toBe(422);
        });

        it("answers 400 for a malformed body", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const jobId = await openJob("Vaga");

          const res = await instance.handle(
            new Request(`http://localhost/api/me/jobs/${jobId}/reject`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-test-session": "talent",
                "x-test-talent-id": id,
                origin: webOrigin,
              },
              body: "{",
            }),
          );

          expect(res.status).toBe(400);
        });

        it("stores a trimmed, sanitized note and overwrites on repeat", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const jobId = await openJob("Vaga");

          await reject(instance, id, jobId, { reason: "salary", note: `  paga\u0000 pouco  ` });

          const [first] = await db.select().from(jobRejections);

          expect(first).toMatchObject({ reason: "salary", note: "paga pouco" });

          await reject(instance, id, jobId, { reason: "location", note: "x".repeat(500) });

          const [second] = await db.select().from(jobRejections);

          expect(second.note).toHaveLength(500);
          expect(second.reason).toBe("location");
          expect(second.createdAt?.getTime()).toBeGreaterThanOrEqual(
            first.createdAt?.getTime() ?? 0,
          );

          await reject(instance, id, jobId, { reason: "other", note: "   " });
          await reject(instance, id, jobId, { reason: "other", note: null });

          expect(await db.select().from(jobRejections)).toMatchObject([
            { reason: "other", note: null },
          ]);
        });

        it("lists rejections with reason counts for the person only", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const other = await profile("outra.pessoal@example.com", 1);
          const a = await openJob("A");
          const b = await openJob("B", { closedAt: new Date() });
          const c = await openJob("C");

          await db.insert(jobRejections).values([
            {
              profileId: id,
              jobId: a,
              reason: "salary",
              createdAt: new Date("2026-01-01T00:00:00Z"),
            },
            {
              profileId: id,
              jobId: b,
              reason: "salary",
              note: "fechou",
              createdAt: new Date("2026-01-03T00:00:00Z"),
            },
            {
              profileId: id,
              jobId: c,
              reason: "company",
              createdAt: new Date("2026-01-02T00:00:00Z"),
            },
            { profileId: other, jobId: a, reason: "other" },
          ]);

          const res = await request(instance, id, "/me/rejections");

          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({
            items: [
              {
                job: { id: b, title: "B", company: "Acme" },
                reason: "salary",
                note: "fechou",
                createdAt: "2026-01-03T00:00:00.000Z",
              },
              {
                job: { id: c, title: "C", company: "Acme" },
                reason: "company",
                note: null,
                createdAt: "2026-01-02T00:00:00.000Z",
              },
              {
                job: { id: a, title: "A", company: "Acme" },
                reason: "salary",
                note: null,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            reasons: [
              { reason: "salary", count: 2 },
              { reason: "company", count: 1 },
            ],
          });
        });

        it("returns booleans when the fit is unknown in SQL", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          await openJob("Estranha", { workModel: null, state: "RJ" });
          await db.insert(talentPreferences).values({
            profileId: id,
            jobPreferences: { locations: [{ state: "SP", city: null }] },
          });

          const body = await (await request(instance, id, "/me/jobs?view=all")).json();

          expect(
            body.items.map((item: { fitsPreferences: boolean }) => item.fitsPreferences),
          ).toEqual([false]);
        });

        it("flags and ranks the jobs that fit the stored preferences", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          await openJob("Longe", { company: "Bad", postedAt: new Date("2026-03-01T00:00:00Z") });
          await openJob("Perto", { postedAt: new Date("2026-01-01T00:00:00Z") });
          await db
            .insert(talentPreferences)
            .values({ profileId: id, jobPreferences: { excludedCompanies: ["bad"] } });

          const body = await (await request(instance, id, "/me/jobs?view=all")).json();

          expect(
            body.items.map((item: { title: string; fitsPreferences: boolean }) => [
              item.title,
              item.fitsPreferences,
            ]),
          ).toEqual([
            ["Perto", true],
            ["Longe", false],
          ]);
        });
      });

      describe("answers", () => {
        type AnswerJson = { answer?: string | number | null };

        const answers = (instance: ReturnType<typeof resumesApp>["instance"], id: string) =>
          request(instance, id, "/me/answers");

        const put = (
          instance: ReturnType<typeof resumesApp>["instance"],
          id: string,
          questionId: string,
          json: AnswerJson,
        ) => request(instance, id, `/me/answers/${questionId}`, { method: "PUT", json });

        it("requires an active talent session", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          expect((await request(instance, id, "/me/answers", { session: "admin" })).status).toBe(
            403,
          );
          expect(
            (await instance.handle(new Request("http://localhost/api/me/answers"))).status,
          ).toBe(403);
        });

        it("lists the common questions unanswered", async () => {
          const { instance } = resumesApp();
          const res = await answers(instance, await profile());
          const body = await res.json();

          expect(res.status).toBe(200);
          expect(body.unanswered).toBe(10);
          expect(body.questions).toHaveLength(10);
          expect(body.questions[0]).toEqual({
            id: expect.any(String),
            text: expect.any(String),
            common: true,
            answer: null,
          });
        });

        it("saves, replaces and clears an answer returning the library", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const [{ id: questionId }] = (await (await answers(instance, id)).json()).questions;

          const saved = await put(instance, id, questionId, { answer: "  R$ 9.000  " });
          const body = await saved.json();

          expect(saved.status).toBe(200);
          expect(body.unanswered).toBe(9);
          expect(body.questions[0]).toMatchObject({ id: questionId, answer: "R$ 9.000" });
          expect(await (await answers(instance, id)).json()).toEqual(body);

          const replaced = await (await put(instance, id, questionId, { answer: "Outra" })).json();

          expect(replaced.questions[0].answer).toBe("Outra");

          const cleared = await put(instance, id, questionId, { answer: "   " });

          expect(cleared.status).toBe(200);
          expect((await cleared.json()).unanswered).toBe(10);
        });

        it("accepts 2000 characters and rejects 2001", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const [{ id: questionId }] = (await (await answers(instance, id)).json()).questions;

          expect((await put(instance, id, questionId, { answer: "a".repeat(2000) })).status).toBe(
            200,
          );

          const res = await put(instance, id, questionId, { answer: "a".repeat(2001) });

          expect(res.status).toBe(422);
          expect(await res.json()).toEqual({ error: "Invalid answer" });
          expect(
            (await put(instance, id, questionId, { answer: ` ${"a".repeat(2000)} ` })).status,
          ).toBe(200);
        });

        it("rejects malformed bodies", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const [{ id: questionId }] = (await (await answers(instance, id)).json()).questions;

          for (const json of [{}, { answer: 1 }, { answer: null }]) {
            const res = await put(instance, id, questionId, json);

            expect(res.status).toBe(422);
            expect(await res.json()).toEqual({ error: "Invalid answer" });
          }

          expect((await (await answers(instance, id)).json()).unanswered).toBe(10);
        });

        it("leaves a malformed JSON body to the framework", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const [{ id: questionId }] = (await (await answers(instance, id)).json()).questions;

          const res = await instance.handle(
            new Request(`http://localhost/api/me/answers/${questionId}`, {
              method: "PUT",
              headers: {
                "x-test-session": "talent",
                "x-test-talent-id": id,
                origin: webOrigin,
                "content-type": "application/json",
              },
              body: "{",
            }),
          );

          expect(res.status).toBe(400);
        });

        it("answers 404 for an unknown or malformed question", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          for (const questionId of ["00000000-0000-4000-8000-000000000001", "nope"]) {
            const res = await put(instance, id, questionId, { answer: "x" });

            expect(res.status).toBe(404);
            expect(await res.json()).toEqual({ error: "Question not found" });
          }
        });

        it("isolates answers between people", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const other = await profile("outra.pessoal@example.com", 1);
          const [{ id: questionId }] = (await (await answers(instance, id)).json()).questions;

          await put(instance, id, questionId, { answer: "Minha" });

          const body = await (await answers(instance, other)).json();

          expect(body.unanswered).toBe(10);
          expect(body.questions[0].answer).toBeNull();
        });

        it("includes answers in the export", async () => {
          const { instance } = resumesApp();
          const id = await profile();
          const [{ id: questionId, text }] = (await (await answers(instance, id)).json()).questions;

          await put(instance, id, questionId, { answer: "Resposta" });

          const exported = await (await request(instance, id, "/me/export")).json();

          expect(exported.answers).toEqual([
            { question: text, answer: "Resposta", updatedAt: expect.any(String) },
          ]);
        });
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
            cpf: emptyField,
            birthDate: emptyField,
            address: emptyField,
            gender: emptyField,
            race: emptyField,
            orientation: emptyField,
            disability: emptyField,
            pronoun: emptyField,
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

        it("validates CPF, birth date and address", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          const address = {
            cep: "01310-100",
            street: " Avenida Paulista ",
            number: "1000",
            complement: "",
            neighborhood: "Bela Vista",
            city: "São Paulo",
            state: "SP",
          };

          const birth = (years: number, shift = 0) => {
            const date = new Date(Date.now() - 3 * 3_600_000);

            return new Date(
              Date.UTC(
                date.getUTCFullYear() - years,
                date.getUTCMonth(),
                date.getUTCDate() + shift,
              ),
            )
              .toISOString()
              .slice(0, 10);
          };

          const saved = await save(instance, id, {
            profileFields: {
              cpf: { value: "529.982.247-25", share: true },
              birthDate: { value: birth(14), share: true },
              address: { value: address, share: true },
            },
          });

          expect(saved.status).toBe(200);
          expect((await saved.json()).profileFields).toMatchObject({
            cpf: { value: "52998224725", share: true },
            birthDate: { value: birth(14), share: true },
            address: {
              value: {
                ...address,
                cep: "01310100",
                street: "Avenida Paulista",
                complement: null,
              },
              share: true,
            },
          });

          const rejected: PreferencesJson[] = [
            { cpf: { value: "529.982.247-24", share: true } },
            { cpf: { value: "111.111.111-11", share: true } },
            { birthDate: { value: birth(13), share: true } },
            { birthDate: { value: birth(14, 1), share: true } },
            { birthDate: { value: "2026-02-30", share: true } },
            { address: { value: { ...address, state: "XX" }, share: true } },
          ];

          for (const profileFields of rejected) {
            const res = await save(instance, id, { profileFields });

            expect(res.status).toBe(422);
            expect(await res.json()).toEqual({ error: "Invalid preferences" });
          }
        });

        it("keeps the other fields when saving the form fields", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          await save(instance, id, {
            profileFields: {
              phone: { value: "11 90000-0000", share: true },
              cpf: { value: "52998224725", share: true },
            },
          });

          const res = await save(instance, id, {
            profileFields: { birthDate: { value: "1990-05-17", share: false } },
          });

          expect((await res.json()).profileFields).toMatchObject({
            phone: { value: "11 90000-0000", share: true },
            cpf: { value: "52998224725", share: true },
            birthDate: { value: "1990-05-17", share: false },
            address: { value: null, share: false },
          });
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
            { jobPreferences: { salaryFloorCents: 2_147_483_648 } },
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
        expect(store.prefixes).toEqual([`resumes/${id}/`, `ai-applications/${id}/`]);
        expect((await request(instance, id, "/me")).status).toBe(403);
      });

      describe("with a Carreira Pro subscription", () => {
        async function subscribe(
          profileId: string,
          status: "active" | "past_due" | "pending" | "canceled",
          providerSubscriptionId: string | null = "subs_pro",
        ) {
          await db.insert(talentSubscriptions).values({
            profileId,
            status,
            providerSubscriptionId,
            currentPeriodEnd: "2099-01-01",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }

        it("cancels the subscription at AbacatePay before deleting", async () => {
          for (const status of ["active", "past_due", "pending"] as const) {
            const cancelled: string[] = [];
            const { instance } = resumesApp({ billing: billingStub(cancelled) });
            const id = await profile(`${status}@example.com`);

            await subscribe(id, status);

            expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
            expect(cancelled).toEqual(["subs_pro"]);
            expect(await repos.talent.findById(id)).toBeUndefined();
            expect(
              await db
                .select()
                .from(talentSubscriptions)
                .where(eq(talentSubscriptions.profileId, id)),
            ).toEqual([]);
          }
        });

        it("keeps the account and the subscription when AbacatePay fails", async () => {
          const logged = vi.spyOn(console, "error");
          const cancelled: string[] = [];
          const { instance, store } = resumesApp({ billing: billingStub(cancelled, true) });
          const id = await profile();

          await subscribe(id, "active");
          await upload(instance, id);

          try {
            const res = await request(instance, id, "/me", { method: "DELETE" });

            expect(res.status).toBe(502);
            expect(await res.json()).toEqual({ error: "Could not cancel Carreira Pro; try again" });
            expect(store.prefixes).toEqual([]);
            expect((await request(instance, id, "/me")).status).toBe(200);
            expect(
              (
                await db
                  .select({ status: talentSubscriptions.status })
                  .from(talentSubscriptions)
                  .where(eq(talentSubscriptions.profileId, id))
              )[0],
            ).toEqual({ status: "active" });
          } finally {
            logged.mockRestore();
          }
        });

        it("refuses to delete when billing is not configured", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          await subscribe(id, "active");

          const res = await request(instance, id, "/me", { method: "DELETE" });

          expect(res.status).toBe(503);
          expect(await res.json()).toEqual({ error: "Billing not configured" });
          expect((await request(instance, id, "/me")).status).toBe(200);
        });

        it("deletes without calling AbacatePay when there is nothing to cancel", async () => {
          const cancelled: string[] = [];
          const { instance } = resumesApp({ billing: billingStub(cancelled, true) });
          const noProvider = await profile("a@example.com");
          const alreadyCanceled = await profile("b@example.com", 1);
          const none = await profile("c@example.com", 2);

          await subscribe(noProvider, "pending", null);
          await subscribe(alreadyCanceled, "canceled");

          for (const id of [noProvider, alreadyCanceled, none]) {
            expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
          }

          expect(cancelled).toEqual([]);
        });

        it("does not call AbacatePay again once it was canceled and a later step failed", async () => {
          const cancelled: string[] = [];
          const { instance, store } = resumesApp({ billing: billingStub(cancelled) });
          const id = await profile();

          await subscribe(id, "active");
          await upload(instance, id);

          store.failRemove = true;

          expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(502);

          store.failRemove = false;

          expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
          expect(cancelled).toEqual(["subs_pro"]);
        });

        it("cancels only the subscription of the signed-in profile", async () => {
          const cancelled: string[] = [];
          const { instance } = resumesApp({ billing: billingStub(cancelled) });
          const mine = await profile();
          const other = await profile("outra@example.com", 1);

          await subscribe(mine, "active", "subs_mine");
          await subscribe(other, "active", "subs_other");

          expect((await request(instance, mine, "/me", { method: "DELETE" })).status).toBe(204);
          expect(cancelled).toEqual(["subs_mine"]);
          expect((await request(instance, other, "/me")).status).toBe(200);
        });
      });

      describe("with a benefit upgrade", () => {
        async function upgrade(
          profileId: string,
          copaySubscriptionId: string | null = "subs_copay",
        ) {
          const rows = await db.select().from(plans).orderBy(plans.monthlyPriceCents);

          await db.insert(benefitAssignments).values({
            orgId: defaultOrgId,
            profileId,
            assignedPlanId: rows[0].id,
            effectivePlanId: rows[rows.length - 1].id,
            source: "manual",
            validUntil: "2099-12-31",
            copaySubscriptionId,
          });
        }

        it("cancels the upgrade at AbacatePay before deleting", async () => {
          const cancelled: string[] = [];
          const { instance } = resumesApp({ billing: billingStub(cancelled) });
          const id = await profile();

          await upgrade(id);

          expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
          expect(cancelled).toEqual(["subs_copay"]);
          expect(await repos.talent.findById(id)).toBeUndefined();
        });

        it("cancels both the upgrade and Carreira Pro", async () => {
          const cancelled: string[] = [];
          const { instance } = resumesApp({ billing: billingStub(cancelled) });
          const id = await profile();

          await upgrade(id);
          await db.insert(talentSubscriptions).values({
            profileId: id,
            status: "active",
            providerSubscriptionId: "subs_pro",
            currentPeriodEnd: "2099-01-01",
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
          expect(cancelled).toEqual(["subs_pro", "subs_copay"]);
        });

        it("keeps the account when AbacatePay fails", async () => {
          const logged = vi.spyOn(console, "error");
          const cancelled: string[] = [];
          const { instance } = resumesApp({ billing: billingStub(cancelled, true) });
          const id = await profile();

          await upgrade(id);

          try {
            const res = await request(instance, id, "/me", { method: "DELETE" });

            expect(res.status).toBe(502);
            expect(await res.json()).toEqual({
              error: "Could not cancel the benefit upgrade; try again",
            });
            expect((await request(instance, id, "/me")).status).toBe(200);
            expect(
              await db
                .select()
                .from(benefitAssignments)
                .where(eq(benefitAssignments.profileId, id)),
            ).toHaveLength(1);
          } finally {
            logged.mockRestore();
          }
        });

        it("refuses to delete when billing is not configured", async () => {
          const { instance } = resumesApp();
          const id = await profile();

          await upgrade(id);

          const res = await request(instance, id, "/me", { method: "DELETE" });

          expect(res.status).toBe(503);
          expect(await res.json()).toEqual({ error: "Billing not configured" });
          expect((await request(instance, id, "/me")).status).toBe(200);
        });

        it("deletes without calling AbacatePay when there is no upgrade to cancel", async () => {
          const cancelled: string[] = [];
          const { instance } = resumesApp({ billing: billingStub(cancelled, true) });
          const without = await profile("a@example.com");
          const noUpgrade = await profile("b@example.com", 1);

          await upgrade(noUpgrade, null);

          for (const id of [without, noUpgrade]) {
            expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
          }

          expect(cancelled).toEqual([]);
        });
      });

      it("keeps the employee journey of the same person when the talent account is deleted", async () => {
        const { instance } = resumesApp();
        const id = await profile();
        const caseId = (await repos.talent.findById(id))?.caseId;

        if (!caseId) throw new Error("missing case");

        const userId = `talent-employee-${id}`;

        await db.insert(authUser).values({ id: userId, name: "Ana", email: personalEmail });

        const [grant] = await db
          .insert(employeeAccess)
          .values({ caseId, email: personalEmail.toUpperCase(), plan: {} })
          .returning({ grantId: employeeAccess.grantId });

        await db
          .insert(employeeStates)
          .values({ caseId, userId, key: "departure-v1", revision: 1, value: {} });
        await db.insert(authSession).values([
          {
            id: `${userId}-employee`,
            token: `${userId}-employee-token`,
            userId,
            employeeCaseId: caseId,
            employeeGrantId: grant.grantId,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
          {
            id: `${userId}-talent`,
            token: `${userId}-talent-token`,
            userId,
            talentProfileId: id,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        ]);

        expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);

        expect(await db.select().from(authUser).where(eq(authUser.id, userId))).toHaveLength(1);
        expect(
          await db.select().from(employeeStates).where(eq(employeeStates.userId, userId)),
        ).toHaveLength(1);
        expect(
          (
            await db
              .select({ id: authSession.id })
              .from(authSession)
              .where(eq(authSession.userId, userId))
          ).map((row) => row.id),
        ).toEqual([`${userId}-employee`]);
        expect(await repos.talent.findById(id)).toBeUndefined();
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
          await storage.put(`ai-applications/${id}/orphan.png`, pdf, "image/png");
          await storage.put(`ai-applications/${other}/kept.png`, pdf, "image/png");

          expect((await request(instance, id, "/me", { method: "DELETE" })).status).toBe(204);
          expect(await readdir(path.join(root, "resumes"))).toEqual([other]);
          expect(await readdir(path.join(root, "ai-applications"))).toEqual([other]);
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

      it("refuses to delete when only an AI application screenshot is stored and storage is missing", async () => {
        const { instance } = resumesApp({ storage: false });
        const id = await profile();

        const [job] = await db
          .insert(jobs)
          .values({
            origin: "external",
            source: "greenhouse",
            sourceKey: "acme:1",
            title: "Backend",
            company: "Acme",
            url: "https://example.com/1",
          })
          .returning({ id: jobs.id });

        await db.insert(aiApplications).values({
          profileId: id,
          jobId: job.id,
          state: "assisted",
          form: { questions: [] },
          draft: [],
          preparedAt: new Date(),
          screenshotKey: `ai-applications/${id}/shot.png`,
        });

        const res = await request(instance, id, "/me", { method: "DELETE" });

        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "File storage not configured" });
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
      embed?: Embed,
    ) {
      const fetched: string[] = [];

      const instance = createApp(
        webOrigin,
        { ...repos, ...overrides },
        {
          ...appOptions,
          catalog,
          embed,
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
        orgId: defaultOrgId,
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

      const drained = Math.min(catalogSources.length, 5);

      expect(await app.drainNow()).toEqual({ processed: drained, failed: 0 });
      expect(app.fetched).toHaveLength(drained);

      const urls = catalogSources.map((source) =>
        source.kind === "greenhouse"
          ? `https://boards-api.greenhouse.io/v1/boards/${source.target}/jobs?content=true`
          : `https://api.lever.co/v0/postings/${source.target}?mode=json`,
      );

      for (const url of app.fetched) expect(urls).toContain(url);

      expect((await registry()).map((source) => [source.target, source.enabled]).sort()).toEqual(
        catalogSources.map((source) => [source.target, true]).sort(),
      );
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

    it("runs scheduled automation rules on drain", async () => {
      const app = sourcesApp([]);
      const cronRules = vi.spyOn(repos.automationRules, "getAllCronRules");

      expect(await app.drainNow()).toEqual({ processed: 0, failed: 0 });
      expect(cronRules).toHaveBeenCalledTimes(1);
      cronRules.mockRestore();
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

    async function insertOpenJobs(count: number) {
      await db.insert(jobs).values(
        Array.from(
          { length: count },
          (_, index) =>
            ({
              origin: "external",
              source: "seed",
              sourceKey: `bulk-${index}`,
              title: `Vaga ${index}`,
              company: "Acme",
              description: "<p>Vaga de engenharia</p>",
              url: `https://jobs.example.com/bulk-${index}`,
              postedAt: new Date(Date.UTC(2026, 0, 1) - index * 1000),
            }) satisfies typeof jobs.$inferInsert,
        ),
      );
    }

    const embeddedCount = async () =>
      (
        await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(sql`${jobs.embedding} is not null`)
      ).length;

    it("embeds synced jobs and then fans out matching", async () => {
      const profileId = await matchingProfile();
      const embedder = fakeEmbed();
      const app = sourcesApp([acme], {}, embedder.embed);

      await app.drainNow();

      expect(await queued("embed_jobs")).toEqual([{ subject: "jobs", status: "done" }]);
      expect(embedder.calls).toHaveLength(1);
      expect(embedder.calls[0]).toHaveLength(2);
      expect(embedder.calls[0][0]).toContain("Engenheira");
      expect(embedder.calls[0][0]).toContain("Acme Pagamentos");
      expect(await embeddedCount()).toBe(2);
      expect((await queued("compute_matches")).map((row) => row.subject)).toEqual([profileId]);
    });

    it("embeds a hundred jobs in batches of twenty and enqueues itself again", async () => {
      await matchingProfile();
      await insertOpenJobs(121);

      const enqueued: [string, string][] = [];
      const embedder = fakeEmbed();

      const app = sourcesApp(
        [],
        {
          background: {
            ...repos.background,
            enqueue: async (kind, subject) => {
              enqueued.push([kind, subject]);
            },
          },
        },
        embedder.embed,
      );

      await repos.background.enqueue("embed_jobs", "jobs");
      await app.drainNow();

      expect(embedder.calls.map((texts) => texts.length)).toEqual([20, 20, 20, 20, 20]);
      expect(await embeddedCount()).toBe(100);
      expect(enqueued).toEqual([["embed_jobs", "jobs"]]);
      expect(await queued("compute_matches")).toEqual([]);
    });

    it("fans out matching once every open job is embedded", async () => {
      const profileId = await matchingProfile();

      await insertOpenJobs(121);

      const embedder = fakeEmbed();
      const app = sourcesApp([], {}, embedder.embed);

      await repos.background.enqueue("embed_jobs", "jobs");
      await app.drainNow();

      expect(embedder.calls.map((texts) => texts.length)).toEqual([20, 20, 20, 20, 20, 20, 1]);
      expect(await embeddedCount()).toBe(121);
      expect((await queued("compute_matches")).map((row) => row.subject)).toEqual([profileId]);
    });

    it("skips closed jobs and does nothing when every job is embedded", async () => {
      await matchingProfile();
      await insertOpenJobs(3);
      await db.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.title, "Vaga 0"));

      const embedder = fakeEmbed();
      const app = sourcesApp([], {}, embedder.embed);

      await repos.background.enqueue("embed_jobs", "jobs");
      await app.drainNow();

      expect(embedder.calls[0]).toHaveLength(2);
      expect(await queued("compute_matches")).toHaveLength(1);

      await db.delete(backgroundJobs);
      await repos.background.enqueue("embed_jobs", "jobs");
      await app.drainNow();

      expect(embedder.calls).toHaveLength(1);
      expect(await queued("compute_matches")).toEqual([]);
    });

    it("retries a failed embedding through the queue without enqueueing again", async () => {
      await matchingProfile();
      await insertOpenJobs(3);

      const embedder = fakeEmbed();

      embedder.state.fail = true;

      const app = sourcesApp([], {}, embedder.embed);

      await repos.background.enqueue("embed_jobs", "jobs");

      expect(await app.drainNow()).toEqual({ processed: 0, failed: 1 });
      expect(await embeddedCount()).toBe(0);

      const rows = await db
        .select({ status: backgroundJobs.status, lastError: backgroundJobs.lastError })
        .from(backgroundJobs)
        .where(eq(backgroundJobs.kind, "embed_jobs"));

      expect(rows).toEqual([{ status: "pending", lastError: "Error: embeddings down" }]);
      expect(await queued("compute_matches")).toEqual([]);
    });

    it("ignores a queued embedding job when embeddings are not configured", async () => {
      await insertOpenJobs(2);
      await repos.background.enqueue("embed_jobs", "jobs");

      expect(await sourcesApp([]).drainNow()).toEqual({ processed: 1, failed: 0 });
      expect(await embeddedCount()).toBe(0);
    });

    it("keeps imported jobs when enqueueing the embedding job fails", async () => {
      const logged = vi.spyOn(console, "error");

      const app = sourcesApp(
        [acme],
        {
          background: {
            ...repos.background,
            enqueue: () => Promise.reject(new Error("queue down")),
          },
        },
        fakeEmbed().embed,
      );

      expect(await app.drainNow()).toEqual({ processed: 1, failed: 0 });
      expect(await importedJobs()).toHaveLength(2);
      expect(logged.mock.calls).toEqual([
        ["embed jobs enqueue failed", { name: "Error", message: "queue down" }],
      ]);
      logged.mockRestore();
    });

    it("does not enqueue embedding when the sync fails", async () => {
      const app = sourcesApp(
        [{ kind: "greenhouse", target: "broken", label: null }],
        {},
        fakeEmbed().embed,
      );

      await app.drainNow();

      expect(await queued("embed_jobs")).toEqual([]);
    });

    it("fans out nothing when the company subscription is not active", async () => {
      await matchingProfile();

      const subscription = await repos.billing.getSubscription(defaultOrgId);

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(defaultOrgId, subscription.id, { status: "canceled" });

      const app = sourcesApp([acme]);

      expect(await app.drainNow()).toEqual({ processed: 1, failed: 0 });
      expect(await importedJobs()).toHaveLength(2);
      expect(await queued("compute_matches")).toEqual([]);
    });

    it("fans out matching to collaborators without sponsorship or subscription", async () => {
      const profileId = await matchingProfile();

      const [profile] = await db
        .update(talentProfiles)
        .set({ sponsoredUntil: "2000-01-01" })
        .where(eq(talentProfiles.id, profileId))
        .returning({ caseId: talentProfiles.caseId });

      const subscription = await repos.billing.getSubscription(defaultOrgId);

      if (!subscription?.id || !profile.caseId) throw new Error("missing fixtures");

      await repos.billing.updateSubscription(defaultOrgId, subscription.id, { status: "canceled" });
      await db.insert(employeeAccess).values({
        caseId: profile.caseId,
        orgId: defaultOrgId,
        email: `colaboradora-${randomUUID()}@example.com`,
        plan: emptyEmployeePlan,
      });

      await sourcesApp([acme]).drainNow();

      expect((await queued("compute_matches")).map((row) => row.subject)).toEqual([profileId]);
    });

    it("fans out matching to a person with an active Carreira Pro and no sponsorship", async () => {
      const profileId = await matchingProfile();

      await db
        .update(talentProfiles)
        .set({ sponsoredUntil: "2000-01-01" })
        .where(eq(talentProfiles.id, profileId));

      const subscription = await repos.billing.getSubscription(defaultOrgId);

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(defaultOrgId, subscription.id, { status: "canceled" });
      await db.insert(talentSubscriptions).values({
        profileId,
        status: "active",
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await sourcesApp([acme]).drainNow();

      expect((await queued("compute_matches")).map((row) => row.subject)).toEqual([profileId]);
    });

    it("fans out matching only to people whose sponsor is active", async () => {
      const inactiveSponsor = await matchingProfile();

      await db
        .insert(organizations)
        .values({ id: otherOrgId, name: "Org B", slug: "org-b" })
        .onConflictDoNothing();

      const [otherCase] = await db
        .insert(offboardingCases)
        .values({
          orgId: otherOrgId,
          name: "Pessoa da Org B",
          role: "Dev",
          department: "Eng",
          deadline: "2026-12-01",
        })
        .returning({ id: offboardingCases.id });

      const created = await repos.talent.enable({
        orgId: otherOrgId,
        caseId: otherCase.id,
        personalEmail: "fontes.org-b@example.com",
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

      const [plan] = await db.select({ id: plans.id }).from(plans).limit(1);

      await db.insert(subscriptions).values({
        orgId: otherOrgId,
        planId: plan.id,
        currentPeriodStart: "2026-11-01",
        currentPeriodEnd: "2099-12-01",
      });

      const subscription = await repos.billing.getSubscription(defaultOrgId);

      if (!subscription) throw new Error("missing subscription");

      await repos.billing.updateSubscription(defaultOrgId, subscription.id, { status: "canceled" });

      await sourcesApp([acme]).drainNow();

      const subjects = (await queued("compute_matches")).map((row) => row.subject);

      expect(subjects).toEqual([created.id]);
      expect(subjects).not.toContain(inactiveSponsor);
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
      trackingServer.close(() => resolve());
    });

    await new Promise<void>((resolve) => {
      hookServer.close(() => resolve());
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
          email: `perm-${role}-${randomUUID()}@example.com`,
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
    const body = {
      name: "Ana Souza",
      role: "Dev",
      department: "Eng",
      deadline: "2026-12-01",
      email: "ana.souza@example.com",
    };

    const res = await call("/offboardings", "POST", body);
    const created = await res.json();
    const { email: _, ...expected } = body;

    expect(res.status).toBe(201);
    expect(created).toEqual({ id: expect.any(String), ...expected, completed: 0, total: 17 });
    expect((await call(`/offboardings/${created.id}`)).status).toBe(200);
  });

  it("rejects duplicate employee email on create", async () => {
    const body = {
      name: "Duplicate Test",
      role: "Dev",
      department: "Eng",
      deadline: "2026-12-01",
      email: "dup-create@example.com",
    };

    await call("/offboardings", "POST", body);
    const res = await call("/offboardings", "POST", { ...body, name: "Another" });

    expect(res.status).toBe(409);
  });

  describe("employee invite", () => {
    const person = {
      name: "Ana Souza",
      role: "Dev",
      department: "Eng",
      deadline: "2026-12-01",
      email: "ana.convite@example.com",
    };

    const withEmployees = createApp(webOrigin, repos, {
      ...appOptions,
      auth: { ...auth, resolveEmployee: async () => null },
    });

    function access(path: string, method = "GET", body?: Payload) {
      return call(`/employee-access/${path}`, method, body, withEmployees);
    }

    async function importedCase() {
      const rows = [{ name: "Bia Lima", department: "Ops" }];

      const [created] = z
        .array(z.object({ id: z.uuid() }))
        .parse(await (await call("/offboardings/import", "POST", { rows })).json());

      return created.id;
    }

    async function inviteTask(caseId: string) {
      const found = z
        .object({ tasks: z.array(z.object({ title: z.string(), status: z.string() })) })
        .parse(await (await call(`/offboardings/${caseId}`)).json());

      return found.tasks.find((task) => task.title === "Enviar convite do app Offboard")?.status;
    }

    it("invites the employee when HR asks for it on create", async () => {
      const res = await call("/offboardings", "POST", { ...person, invite: true });

      expect(res.status).toBe(201);
      expect(await inviteTask((await res.json()).id)).toBe("done");
      expect(invitedEmails).toEqual([person.email]);
      expect(sentTexts[0]).toContain("Olá, Ana.");
      expect(sentTexts[0]).toContain("Default liberou para você");
      expect(sentTexts[0]).toContain(`${webOrigin}/colaborador/entrar`);
    });

    it("does not invite unless HR asks for it", async () => {
      const created = await call("/offboardings", "POST", person);

      expect(created.status).toBe(201);
      expect(await inviteTask((await created.json()).id)).toBe("todo");
      expect(
        (await call("/offboardings", "POST", { ...person, email: "b@example.com", invite: false }))
          .status,
      ).toBe(201);
      expect(invitedEmails).toEqual([]);
    });

    it("keeps the case when the invite cannot be sent", async () => {
      inviteFailures.remaining = 1;

      const res = await call("/offboardings", "POST", { ...person, invite: true });

      expect(res.status).toBe(201);
      expect(await inviteTask((await res.json()).id)).toBe("todo");
      expect(invitedEmails).toEqual([]);
    });

    it("invites whenever HR sets or changes the email", async () => {
      const target = await importedCase();
      const plan = emptyEmployeePlan;

      expect(
        (await access(target, "PUT", { email: "a@example.com", plan, revision: 0 })).status,
      ).toBe(200);
      expect(
        (await access(target, "PUT", { email: "a@example.com", plan, revision: 1 })).status,
      ).toBe(200);
      expect(
        (await access(target, "PUT", { email: "b@example.com", plan, revision: 2 })).status,
      ).toBe(200);
      expect((await access(target, "PUT", { email: null, plan, revision: 3 })).status).toBe(200);
      expect((await access(target, "PUT", { email: null, plan, revision: 0 })).status).toBe(409);
      expect(invitedEmails).toEqual(["a@example.com", "b@example.com"]);

      inviteFailures.remaining = 1;

      expect(
        (await access(target, "PUT", { email: "c@example.com", plan, revision: 4 })).status,
      ).toBe(200);
      expect(await (await access(target)).json()).toMatchObject({ email: "c@example.com" });
    });

    describe("benefit when HR grants access", () => {
      async function policyPlans() {
        const rows = await db.select().from(plans).orderBy(asc(plans.monthlyPriceCents));

        const low = rows[0].id;
        const high = rows[rows.length - 1].id;

        await repos.benefits.savePolicy(defaultOrgId, {
          defaultPlanId: low,
          benefitDurationMonths: 3,
          rules: [
            { id: "ops", field: "department", operator: "equals", value: "Ops", planId: high },
          ],
        });

        return { low, high };
      }

      async function assignmentsOf(caseId: string) {
        return db
          .select({
            source: benefitAssignments.source,
            planId: benefitAssignments.effectivePlanId,
            validUntil: benefitAssignments.validUntil,
          })
          .from(benefitAssignments)
          .innerJoin(talentProfiles, eq(talentProfiles.id, benefitAssignments.profileId))
          .where(eq(talentProfiles.caseId, caseId));
      }

      async function enabledProfile(caseId: string) {
        await repos.talent.enable({
          orgId: defaultOrgId,
          caseId,
          personalEmail: `hr-${randomUUID()}@example.com`,
          sponsoredUntil: "2099-01-01",
        });
      }

      afterEach(async () => {
        await db.delete(benefitAssignments);
        await db.delete(benefitPolicies);
      });

      it("assigns the benefit of the matching rule to an existing profile", async () => {
        const { high } = await policyPlans();
        const caseId = await importedCase();

        await enabledProfile(caseId);

        expect(await assignmentsOf(caseId)).toEqual([]);

        const plan = emptyEmployeePlan;

        expect(
          (await access(caseId, "PUT", { email: "ops@example.com", plan, revision: 0 })).status,
        ).toBe(200);

        const [assigned] = await assignmentsOf(caseId);

        expect(assigned).toMatchObject({
          source: "rule",
          planId: high,
          validUntil: addMonths(saoPauloDate(new Date()), 3),
        });
      });

      it("leaves a live assignment from the old policy alone when the policy and email change", async () => {
        const { low, high } = await policyPlans();
        const caseId = await importedCase();
        const plan = emptyEmployeePlan;

        await enabledProfile(caseId);
        await access(caseId, "PUT", { email: "one@example.com", plan, revision: 0 });

        const [first] = await assignmentsOf(caseId);

        expect(first).toMatchObject({ source: "rule", planId: high });

        await repos.benefits.savePolicy(defaultOrgId, {
          defaultPlanId: low,
          benefitDurationMonths: 12,
          rules: [],
        });

        expect(
          (await access(caseId, "PUT", { email: "two@example.com", plan, revision: 1 })).status,
        ).toBe(200);
        expect(await assignmentsOf(caseId)).toEqual([first]);
      });

      it("keeps a manual assignment and leaves cases without a profile alone", async () => {
        const { low } = await policyPlans();
        const caseId = await importedCase();

        await enabledProfile(caseId);

        const [profile] = await db
          .select({ id: talentProfiles.id })
          .from(talentProfiles)
          .where(eq(talentProfiles.caseId, caseId));

        await repos.benefits.upsertAssignment({
          orgId: defaultOrgId,
          profileId: profile.id,
          assignedPlanId: low,
          effectivePlanId: low,
          source: "manual",
          validUntil: "2030-01-01",
        });

        const plan = emptyEmployeePlan;

        await access(caseId, "PUT", { email: "manual@example.com", plan, revision: 0 });

        expect(await assignmentsOf(caseId)).toEqual([
          { source: "manual", planId: low, validUntil: "2030-01-01" },
        ]);

        const bare = await importedCase();

        expect(
          (await access(bare, "PUT", { email: "bare@example.com", plan, revision: 0 })).status,
        ).toBe(200);
        expect(await assignmentsOf(bare)).toEqual([]);
      });

      it("does not apply another organization's policy", async () => {
        await policyPlans();
        const caseId = await importedCase();

        await enabledProfile(caseId);
        await db
          .insert(organizations)
          .values({ id: otherOrgId, name: "Org B", slug: "org-b" })
          .onConflictDoNothing();
        await db.update(benefitPolicies).set({ orgId: otherOrgId });

        const plan = emptyEmployeePlan;

        expect(
          (await access(caseId, "PUT", { email: "iso@example.com", plan, revision: 0 })).status,
        ).toBe(200);
        expect(await assignmentsOf(caseId)).toEqual([]);
      });

      it("still saves the access when the benefit cannot be assigned", async () => {
        await policyPlans();
        const caseId = await importedCase();

        await enabledProfile(caseId);

        const failing = createApp(
          webOrigin,
          {
            ...repos,
            benefits: {
              ...repos.benefits,
              applyBenefitPolicy: () => Promise.reject(new Error("db down")),
            },
          },
          { ...appOptions, auth: { ...auth, resolveEmployee: async () => null } },
        );

        const response = await call(
          `/employee-access/${caseId}`,
          "PUT",
          { email: "down@example.com", plan: emptyEmployeePlan, revision: 0 },
          failing,
        );

        expect(response.status).toBe(200);
        expect(await assignmentsOf(caseId)).toEqual([]);
      });
    });

    it("sends the invite again on request", async () => {
      const created = await (await call("/offboardings", "POST", person)).json();
      const target = `${created.id}/invite`;

      const sent = await access(target, "POST");

      expect(sent.status).toBe(200);
      expect(await sent.json()).toEqual({ sent: true });
      expect(invitedEmails).toEqual([person.email]);
      expect(await inviteTask(created.id)).toBe("done");

      inviteFailures.remaining = 1;

      expect((await access(target, "POST")).status).toBe(502);
      expect((await access(`${await importedCase()}/invite`, "POST")).status).toBe(409);
      expect((await access(`${missingCaseId}/invite`, "POST")).status).toBe(404);
    });

    it("sends at most three invites per case a day", async () => {
      const response = await call("/offboardings", "POST", { ...person, invite: true });
      const created = await response.json();
      const target = `${created.id}/invite`;

      expect(
        (
          await access(created.id, "PUT", {
            email: "outro@example.com",
            plan: emptyEmployeePlan,
            revision: 1,
          })
        ).status,
      ).toBe(200);
      expect((await access(target, "POST")).status).toBe(200);

      const limited = await access(target, "POST");

      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: "Too many invites" });
      expect(invitedEmails).toEqual([person.email, "outro@example.com", "outro@example.com"]);

      await db
        .update(authRateLimit)
        .set({ lastRequest: Date.now() - 24 * 60 * 60 * 1000 })
        .where(eq(authRateLimit.key, `offboard:employee-invite:${created.id}`));

      expect((await access(target, "POST")).status).toBe(200);
      expect(invitedEmails).toHaveLength(4);
    });

    it("still reports the invite as sent when the checklist task cannot be updated", async () => {
      const created = await (await call("/offboardings", "POST", person)).json();

      const failing = createApp(
        webOrigin,
        {
          ...repos,
          employee: {
            ...repos.employee,
            markInviteSent: () => Promise.reject(new Error("db down")),
          },
        },
        { ...appOptions, auth: { ...auth, resolveEmployee: async () => null } },
      );

      const sent = await call(`/employee-access/${created.id}/invite`, "POST", undefined, failing);

      expect(sent.status).toBe(200);
      expect(invitedEmails).toEqual([person.email]);
      expect(await inviteTask(created.id)).toBe("todo");
    });
  });

  it.each([
    { name: "", role: "Dev", department: "Eng", deadline: "2026-12-01", email: "a@b.com" },
    { name: "Ana", role: "Dev", department: "Eng", deadline: "tomorrow", email: "a@b.com" },
    { name: "Ana" },
    { name: "Ana", role: "Dev", department: "Eng", deadline: "2026-12-01" },
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

  it("publishes a shared checklist and applies ordered matching tasks to new and existing empty cases", async () => {
    const employeeStep = {
      id: "onboarding-return",
      team: "Pessoa desligada",
      phase: "second-week",
      title: "Entregar itens",
      deadlineOffset: 2,
      deadlineTime: "08:00",
      rules: [{ id: "area", field: "department", operator: "equals", value: "Operacoes" }],
    } as const;

    const internalStep = {
      id: "internal",
      team: "TI",
      phase: "pre",
      title: "Verificar acessos",
      deadlineTime: "10:00",
      rules: [{ id: "cargo", field: "role", operator: "notEquals", value: "estagiario" }],
    } as const;

    const known = await repos.automationRules.createRule(defaultOrgId, {
      name: "email:obsolete",
      trigger: "task.status_changed",
      conditions: {},
      actions: [],
      sourceRef: "email:obsolete",
    });

    const unrelated = await repos.automationRules.createRule(defaultOrgId, {
      name: "email:independent",
      trigger: "task.status_changed",
      conditions: {},
      actions: [],
      sourceRef: "email:independent",
    });

    const unknownKind = await repos.automationRules.createRule(defaultOrgId, {
      name: "other:obsolete",
      trigger: "task.status_changed",
      conditions: {},
      actions: [],
      sourceRef: "other:obsolete",
    });

    const custom = await repos.automationRules.createRule(defaultOrgId, {
      name: "Custom",
      trigger: "task.status_changed",
      conditions: {},
      actions: [],
    });

    const internalRules = async () =>
      (await repos.automationRules.listRules(defaultOrgId))
        .filter(({ sourceRef }) => sourceRef?.endsWith(":internal"))
        .sort((a, b) => String(a.sourceRef).localeCompare(String(b.sourceRef)));

    const body = {
      revision: 0,
      steps: [
        {
          ...employeeStep,
          rules: [...employeeStep.rules],
          email: { subject: "Assunto", body: "Mensagem" },
        },
        { ...internalStep, rules: [...internalStep.rules] },
      ],
      knownRowIds: [known.id, unknownKind.id],
    };

    try {
      const published = await call("/checklist-model", "PUT", body);
      expect(published.status).toBe(200);
      const change = await published.json();

      const action = change.actionRows.find(
        (config: { actionId: string }) => config.actionId === "email:onboarding-return",
      );

      expect(change).toMatchObject({ revision: 1, steps: [employeeStep, internalStep] });
      expect(action).toMatchObject({ enabled: true, phase: "second-week" });
      const rowIds = change.actionRows.map((config: { id: string }) => config.id);

      expect(rowIds).toEqual(expect.arrayContaining([unrelated.id, unknownKind.id]));
      expect(rowIds).not.toContain(custom.id);
      expect(await repos.automationRules.getRule(defaultOrgId, known.id)).toBeNull();
      expect(
        await repos.automationRules.getEnabledRulesByTrigger(defaultOrgId, "task.status_changed"),
      ).toContainEqual(
        expect.objectContaining({
          conditions: { "task.stepId": "onboarding-return" },
          actions: [{ type: "email", subject: "Assunto", body: "Mensagem" }],
        }),
      );
      expect((await call("/checklist-model", "PUT", body)).status).toBe(409);
      expect(await (await call("/checklist-model")).json()).toMatchObject({
        revision: 1,
        steps: [employeeStep, internalStep],
      });

      const created = await (
        await call("/offboardings", "POST", {
          name: "Criado com checklist",
          department: "Operações",
          role: "Engenheiro",
          deadline: "2027-01-31",
          email: "published-checklist@example.com",
        })
      ).json();

      expect(created).toMatchObject({ total: 2, completed: 0 });
      expect(
        (await repos.offboardings.getOffboarding(defaultOrgId, created.id))?.tasks,
      ).toMatchObject([
        { title: "Verificar acessos", dueDate: null },
        { title: "Entregar itens", dueDate: "2027-02-02" },
      ]);
      expect(
        await db
          .select({ title: tasks.title, dueTime: tasks.dueTime })
          .from(tasks)
          .where(eq(tasks.caseId, created.id))
          .orderBy(asc(tasks.position)),
      ).toEqual([
        { title: "Verificar acessos", dueTime: null },
        { title: "Entregar itens", dueTime: "08:00:00" },
      ]);

      const imported = await (
        await call("/offboardings/import", "POST", {
          rows: [{ name: "CSV", department: "Produto" }],
        })
      ).json();

      expect(imported[0]).toMatchObject({ total: 1 });

      const empty = await repos.offboardings.createOffboarding(defaultOrgId, {
        name: "Caso anterior",
        department: "Operações",
        role: "Estagiário",
        deadline: "2027-02-03",
        email: "existing-checklist@example.com",
      });

      const applyPath = `/offboardings/${empty.id}/checklist`;
      const applied = await Promise.all([call(applyPath, "POST"), call(applyPath, "POST")]);
      expect(applied.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(
        (await repos.offboardings.getOffboarding(defaultOrgId, empty.id))?.tasks,
      ).toMatchObject([{ title: employeeStep.title }]);
      expect((await call(`/offboardings/${missingCaseId}/checklist`, "POST")).status).toBe(404);

      const revised = {
        revision: 1,
        steps: [
          { ...body.steps[0], email: null, title: "Entrega revisada" },
          {
            ...body.steps[1],
            slack: { channel: "#equipe", message: "Mensagem" },
            webhook: { url: "https://offboard.example/tarefa", method: "POST" as const },
          },
        ],
        knownRowIds: [action.id, unknownKind.id],
      };

      expect((await call("/checklist-model", "PUT", revised)).status).toBe(200);
      expect((await call("/checklist-model", "PUT", revised)).status).toBe(409);
      expect(await repos.automationRules.getRule(defaultOrgId, action.id)).toBeNull();
      expect(await internalRules()).toMatchObject([
        { sourceRef: "slack:internal" },
        { sourceRef: "webhook:internal" },
      ]);
      expect(
        (await repos.offboardings.getOffboarding(defaultOrgId, created.id))?.tasks[1]?.title,
      ).toBe(employeeStep.title);

      const revisedAgain = {
        ...revised,
        revision: 2,
        steps: body.steps,
        knownRowIds: (await internalRules()).map(({ id }) => id),
      };

      expect((await call("/checklist-model", "PUT", revisedAgain)).status).toBe(200);
      expect(
        (
          await call("/checklist-model", "PUT", {
            ...revisedAgain,
            revision: 3,
            steps: [body.steps[0], body.steps[0]],
          })
        ).status,
      ).toBe(422);
    } finally {
      await db.delete(checklistModels).where(eq(checklistModels.orgId, defaultOrgId));

      await repos.automationRules.deleteRule(defaultOrgId, custom.id);

      for (const { id, sourceRef } of await repos.automationRules.listRules(defaultOrgId)) {
        if (sourceRef) await repos.automationRules.deleteRule(defaultOrgId, id);
      }
    }
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

  it("treats only a connected E-mail row as switched on", async () => {
    expect(await repos.integrations.isConnected(defaultOrgId, "E-mail")).toBe(true);

    await call("/integrations/E-mail", "PUT", { status: "disconnected" });

    expect(await repos.integrations.isConnected(defaultOrgId, "E-mail")).toBe(false);
    expect(await repos.integrations.isConnected(defaultOrgId, "Never Saved")).toBe(false);
  });

  describe("Slack settings", () => {
    const slackPosts: URLSearchParams[] = [];

    const slackServer = createServer((req, res) => {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });

        if (req.headers.authorization === "Bearer xoxb-noteam-5678") {
          res.end(JSON.stringify({ ok: true }));

          return;
        }

        if (req.url === "/auth.test") {
          const good = req.headers.authorization === "Bearer xoxb-good-1234";

          res.end(
            JSON.stringify(
              good ? { ok: true, team: "Acme" } : { ok: false, error: "invalid_auth" },
            ),
          );

          return;
        }

        slackPosts.push(new URLSearchParams(body));
        res.end(JSON.stringify({ ok: true }));
      });
    });

    let slackApp = app;

    beforeAll(async () => {
      await new Promise<void>((resolve) => slackServer.listen(0, resolve));

      const address = slackServer.address();
      const port = address instanceof Object ? address.port : 0;

      slackApp = createApp(webOrigin, repos, {
        ...appOptions,
        slackApiUrl: `http://127.0.0.1:${port}/`,
      });
    });

    afterAll(() => {
      slackServer.close();
    });

    function slackCall(path: string, method = "GET", body?: Payload) {
      return call(path, method, body, slackApp);
    }

    beforeEach(async () => {
      slackPosts.length = 0;
      await db.delete(integrations).where(eq(integrations.name, "Slack"));
    });

    it("starts unconfigured", async () => {
      const res = await slackCall("/integrations/slack");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ configured: false, team: null, tokenHint: null });
    });

    it("saves a verified bot token without ever returning it", async () => {
      const saved = await slackCall("/integrations/slack", "PUT", { botToken: "xoxb-good-1234" });

      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ configured: true, team: "Acme", tokenHint: "1234" });

      const [row] = await db
        .select({ status: integrations.status, config: integrations.config })
        .from(integrations)
        .where(and(eq(integrations.orgId, defaultOrgId), eq(integrations.name, "Slack")));

      expect(row?.status).toBe("connected");
      expect(JSON.stringify(row?.config)).not.toContain("xoxb-good-1234");

      const listed = await (await slackCall("/integrations")).json();

      expect(listed).toContainEqual({ name: "Slack", status: "connected" });
      expect(JSON.stringify(listed)).not.toContain("xoxb");
      expect(await (await slackCall("/integrations/slack")).json()).toEqual({
        configured: true,
        team: "Acme",
        tokenHint: "1234",
      });
    });

    it("saves a token whose workspace name Slack omits", async () => {
      const res = await slackCall("/integrations/slack", "PUT", { botToken: "xoxb-noteam-5678" });

      expect(await res.json()).toEqual({ configured: true, team: null, tokenHint: "5678" });
    });

    it("rejects a token Slack does not accept", async () => {
      const res = await slackCall("/integrations/slack", "PUT", { botToken: "xoxb-bad-0000" });

      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "invalid_auth" });
      expect((await (await slackCall("/integrations/slack")).json()).configured).toBe(false);
    });

    it("rejects a token that is not a bot token", async () => {
      expect(
        (await slackCall("/integrations/slack", "PUT", { botToken: "xoxp-user" })).status,
      ).toBe(422);
    });

    it("refuses to store a token without an encryption key", async () => {
      const keyless = createApp(webOrigin, repos, { ...appOptions, secretKey: undefined });
      const res = await call("/integrations/slack", "PUT", { botToken: "xoxb-good-1234" }, keyless);

      expect(res.status).toBe(503);
    });

    it("does not let the generic toggle connect Slack", async () => {
      expect((await slackCall("/integrations/Slack", "PUT", { status: "connected" })).status).toBe(
        409,
      );
    });

    it("removes the configuration", async () => {
      await slackCall("/integrations/slack", "PUT", { botToken: "xoxb-good-1234" });
      const res = await slackCall("/integrations/slack", "DELETE");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ configured: false, team: null, tokenHint: null });
      expect(await (await slackCall("/integrations")).json()).toContainEqual({
        name: "Slack",
        status: "disconnected",
      });
    });

    it("posts a task's Slack step with the organization's token", async () => {
      await slackCall("/integrations/slack", "PUT", { botToken: "xoxb-good-1234" });

      const [task] = await db
        .update(tasks)
        .set({ phase: "d0", checklistStepId: "slack-org-token" })
        .where(
          eq(
            tasks.id,
            sql`(select id from ${tasks} where ${tasks.orgId} = ${defaultOrgId} order by ${tasks.id} limit 1)`,
          ),
        )
        .returning({ id: tasks.id, title: tasks.title });

      const rule = await repos.automationRules.createRule(defaultOrgId, {
        name: "Slack on done",
        trigger: "task.status_changed",
        conditions: { "task.stepId": "slack-org-token", "task.status": "done" },
        actions: [{ type: "slack", channel: "#rh", message: "{{task}}: {{status}}" }],
      });

      try {
        expect(
          (await slackCall(`/tasks/${task?.id}/status`, "PATCH", { status: "done" })).status,
        ).toBe(200);

        await vi.waitFor(() =>
          expect(slackPosts.map((post) => Object.fromEntries(post))).toContainEqual({
            channel: "#rh",
            text: `${task?.title}: done`,
          }),
        );
      } finally {
        await repos.automationRules.deleteRule(defaultOrgId, rule.id);
      }
    });

    it("reads no token for an organization without Slack", async () => {
      const read = slackTokenReader(
        repos.integrations,
        secretBox("integration-secret-key-for-tests-0001"),
      );

      expect(await read(otherOrgId)).toBeUndefined();
    });

    it("reads no token without an encryption key", async () => {
      await slackCall("/integrations/slack", "PUT", { botToken: "xoxb-good-1234" });

      expect(await slackTokenReader(repos.integrations, undefined)(defaultOrgId)).toBeUndefined();
    });
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
      holderEmail: null,
    });
  });

  it("updates an equipment status", async () => {
    const [{ person: _person, ...first }] = await (await call("/equipment")).json();
    const res = await call(`/equipment/${first.id}`, "PUT", { status: "received" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...first, status: "received" });
  });

  describe("equipment status rules", () => {
    beforeEach(() => {
      hooks.length = 0;
    });

    async function withRule(status: string, run: () => Promise<void>) {
      const rule = await repos.automationRules.createRule(defaultOrgId, {
        name: "Equipment hook",
        trigger: "equipment.status_changed",
        conditions: { "equipment.status": status },
        actions: [{ type: "webhook", url: hookUrl }],
      });

      try {
        await run();
      } finally {
        await repos.automationRules.deleteRule(defaultOrgId, rule.id);
      }
    }

    it("fires equipment.status_changed rules with the case and previous status", async () => {
      const [{ person: _person, ...first }] = await (await call("/equipment")).json();
      const next = first.status === "transit" ? "scheduled" : "transit";

      await withRule(next, async () => {
        expect((await call(`/equipment/${first.id}`, "PUT", { status: next })).status).toBe(200);
      });

      expect(hooks).toHaveLength(1);
      expect(hooks[0]).toMatchObject({
        equipment: { id: first.id, tag: first.tag, status: next, previousStatus: first.status },
        case: { name: expect.any(String) },
      });
    });

    it("fires equipment.status_changed rules for equipment without a case", async () => {
      const created = await (
        await call("/equipment", "POST", {
          item: "Mouse",
          tag: `RULE-${randomUUID()}`,
          returnMethod: "pickup",
        })
      ).json();

      try {
        await withRule("received", async () => {
          const res = await call(`/equipment/${created.id}`, "PUT", { status: "received" });

          expect(res.status).toBe(200);
        });

        expect(hooks).toHaveLength(1);
        expect(hooks[0]).not.toHaveProperty("case");
      } finally {
        await call(`/equipment/${created.id}`, "DELETE");
      }
    });

    it("updates equipment even when loading rules fails", async () => {
      const [{ person: _person, ...first }] = await (await call("/equipment")).json();
      const next = first.status === "transit" ? "scheduled" : "transit";

      const failing = createApp(
        webOrigin,
        {
          ...repos,
          automationRules: {
            ...repos.automationRules,
            getEnabledRulesByTrigger: () => Promise.reject(new Error("rules down")),
          },
        },
        appOptions,
      );

      const res = await call(`/equipment/${first.id}`, "PUT", { status: next }, failing);

      expect(res.status).toBe(200);
      expect(hooks).toEqual([]);
    });

    it("does not fire rules when the equipment does not exist", async () => {
      await withRule("received", async () => {
        const res = await call(`/equipment/${missingTaskId}`, "PUT", { status: "received" });

        expect(res.status).toBe(404);
      });

      expect(hooks).toEqual([]);
    });
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

  describe("manual equipment", () => {
    async function anyCase() {
      const [row] = await db
        .select({ id: offboardingCases.id, name: offboardingCases.name })
        .from(offboardingCases)
        .where(eq(offboardingCases.orgId, defaultOrgId))
        .orderBy(asc(offboardingCases.name))
        .limit(1);

      return row!;
    }

    function addItem(caseId: string, tag: string) {
      return call("/equipment", "POST", { caseId, item: "Notebook", tag, returnMethod: "pickup" });
    }

    it("adds an item to a case and lists it as editable", async () => {
      const target = await anyCase();
      const res = await addItem(target.id, "MAN-001");

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        id: expect.any(String),
        item: "Notebook",
        tag: "MAN-001",
        returnMethod: "pickup",
        scheduledDate: null,
        status: "with_person",
        holderEmail: null,
      });

      const listed = await repos.employee.listEquipmentReturns(defaultOrgId, target.id);

      expect(listed).toContainEqual(
        expect.objectContaining({ code: "MAN-001", person: target.name, fromEmployeePlan: false }),
      );
    });

    it("refuses an asset tag already in use", async () => {
      const target = await anyCase();

      await addItem(target.id, "MAN-002");

      const res = await addItem(target.id, "MAN-002");

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Asset tag already in use" });
    });

    it("refuses a case from another organization", async () => {
      const res = await addItem(missingCaseId, "MAN-003");

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Case not found" });
    });

    it("rejects a blank item or a tag with spaces", async () => {
      const target = await anyCase();

      expect(
        (
          await call("/equipment", "POST", {
            caseId: target.id,
            item: "  ",
            tag: "MAN-004",
            returnMethod: "pickup",
          })
        ).status,
      ).toBe(422);
      expect((await addItem(target.id, "MAN 004")).status).toBe(422);
    });

    it("edits a manual item", async () => {
      const target = await anyCase();
      const created = await (await addItem(target.id, "MAN-005")).json();

      const res = await call(`/equipment/${created.id}`, "PATCH", {
        item: "Monitor",
        tag: "MAN-005B",
        returnMethod: "in_person",
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ...created,
        item: "Monitor",
        tag: "MAN-005B",
        returnMethod: "in_person",
      });
    });

    it("refuses an edit to a tag already in use", async () => {
      const target = await anyCase();

      await addItem(target.id, "MAN-006");

      const created = await (await addItem(target.id, "MAN-007")).json();

      const res = await call(`/equipment/${created.id}`, "PATCH", {
        item: "Notebook",
        tag: "MAN-006",
        returnMethod: "pickup",
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "Asset tag already in use" });
    });

    it("removes a manual item", async () => {
      const target = await anyCase();
      const created = await (await addItem(target.id, "MAN-008")).json();

      expect((await call(`/equipment/${created.id}`, "DELETE")).status).toBe(204);
      expect((await call(`/equipment/${created.id}`, "DELETE")).status).toBe(404);
    });

    it("leaves items from the employee plan to the plan", async () => {
      const target = await anyCase();

      const [planned] = await db
        .insert(equipment)
        .values({
          orgId: defaultOrgId,
          caseId: target.id,
          item: "Celular",
          tag: "PLAN-001",
          returnMethod: "pickup",
          status: "with_person",
          fromEmployeePlan: true,
        })
        .returning({ id: equipment.id });

      const edit = await call(`/equipment/${planned!.id}`, "PATCH", {
        item: "Outro",
        tag: "PLAN-001",
        returnMethod: "pickup",
      });

      expect(edit.status).toBe(409);
      expect(await edit.json()).toEqual({ error: "Equipment comes from the employee plan" });
      expect((await call(`/equipment/${planned!.id}`, "DELETE")).status).toBe(409);
    });

    it("rethrows database errors other than a tag clash", async () => {
      const target = await anyCase();
      const created = await (await addItem(target.id, "MAN-011")).json();

      await expect(
        repos.equipment.updateEquipment(defaultOrgId, created.id, {
          item: "x".repeat(300),
          tag: "MAN-011",
          returnMethod: "pickup",
        }),
      ).rejects.toThrow();
    });

    it("answers 404 for an unknown item", async () => {
      const edit = await call(`/equipment/${missingTaskId}`, "PATCH", {
        item: "Notebook",
        tag: "MAN-009",
        returnMethod: "pickup",
      });

      expect(edit.status).toBe(404);
      expect(await edit.json()).toEqual({ error: "Equipment not found" });
    });

    it("lets visualizador neither add nor remove items", async () => {
      const headers = {
        "x-test-session": "visualizador",
        origin: webOrigin,
        "content-type": "application/json",
      };

      const target = await anyCase();

      const add = await app.handle(
        new Request("http://localhost/api/equipment", {
          method: "POST",
          headers,
          body: JSON.stringify({
            caseId: target.id,
            item: "X",
            tag: "MAN-010",
            returnMethod: "pickup",
          }),
        }),
      );

      const remove = await app.handle(
        new Request(`http://localhost/api/equipment/${missingTaskId}`, {
          method: "DELETE",
          headers,
        }),
      );

      expect(add.status).toBe(403);
      expect(remove.status).toBe(403);
    });
  });

  describe("unassigned equipment", () => {
    const notebook = { item: "Notebook", returnMethod: "pickup" };

    async function caseWithEmails(name: string, email: string | null, personalEmail?: string) {
      const [created] = await db
        .insert(offboardingCases)
        .values({
          orgId: defaultOrgId,
          name,
          role: "Analista",
          department: "Produto",
          deadline: "2027-03-01",
        })
        .returning({ id: offboardingCases.id });

      await db.insert(employeeAccess).values({
        caseId: created!.id,
        orgId: defaultOrgId,
        email,
        personalEmail,
        plan: emptyEmployeePlan,
      });

      return created!.id;
    }

    async function stored(tag: string) {
      const [row] = await db
        .select({ id: equipment.id, caseId: equipment.caseId, holderEmail: equipment.holderEmail })
        .from(equipment)
        .where(eq(equipment.tag, tag));

      return row!;
    }

    function register(tag: string, extra: Record<string, string> = {}) {
      return call("/equipment", "POST", { ...notebook, tag, ...extra });
    }

    it("registers stock with no case and no e-mail", async () => {
      const res = await register("STK-001");

      expect(res.status).toBe(201);
      expect(await stored("STK-001")).toEqual({
        id: expect.any(String),
        caseId: null,
        holderEmail: null,
      });

      const listed = await (await call("/equipment")).json();

      expect(listed).toContainEqual(expect.objectContaining({ tag: "STK-001", person: null }));
      expect(await repos.employee.listEquipmentReturns(defaultOrgId)).toContainEqual(
        expect.objectContaining({ code: "STK-001", caseId: null, person: null, model: "" }),
      );
    });

    it("attaches new equipment to the case using that corporate or personal e-mail", async () => {
      const corporate = await caseWithEmails("Stock Corp", "stock.corp@example.com");
      const personal = await caseWithEmails("Stock Pessoal", null, "stock.pessoal@gmail.com");

      expect((await register("STK-002", { email: "Stock.Corp@Example.com" })).status).toBe(201);
      expect((await register("STK-003", { email: "stock.pessoal@gmail.com" })).status).toBe(201);
      expect((await stored("STK-002")).caseId).toBe(corporate);
      expect((await stored("STK-003")).caseId).toBe(personal);
    });

    it("keeps equipment registered for an e-mail with no case yet", async () => {
      const res = await register("STK-004", { email: "Futuro.Colab@Example.com" });

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(
        expect.objectContaining({ holderEmail: "futuro.colab@example.com" }),
      );
      expect(await stored("STK-004")).toEqual(
        expect.objectContaining({ caseId: null, holderEmail: "futuro.colab@example.com" }),
      );
    });

    it("refuses an e-mail shared by more than one case", async () => {
      await caseWithEmails("Compartilha Um", "um.compartilha@example.com", "compartilha@gmail.com");
      await caseWithEmails(
        "Compartilha Dois",
        "dois.compartilha@example.com",
        "compartilha@gmail.com",
      );

      const res = await register("STK-005", { email: "compartilha@gmail.com" });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "More than one case uses this e-mail" });
    });

    it("prefers the chosen case over the e-mail", async () => {
      const chosen = await caseWithEmails("Escolhida", "escolhida@example.com");

      await register("STK-006", { caseId: chosen, email: "outra.pessoa@example.com" });

      expect(await stored("STK-006")).toEqual(
        expect.objectContaining({ caseId: chosen, holderEmail: null }),
      );
    });

    it("assigns stock to the open case by corporate or personal e-mail", async () => {
      const corporate = await caseWithEmails("Atribui Corp", "atribui.corp@example.com");
      const personal = await caseWithEmails("Atribui Pessoal", null, "atribui.pessoal@gmail.com");
      const first = await (await register("STK-010")).json();

      const second = await (
        await register("STK-011", { email: "ainda.sem.caso@example.com" })
      ).json();

      const byCorporate = await call(`/equipment/${first.id}/assign`, "POST", {
        email: "ATRIBUI.CORP@example.com",
      });

      expect(byCorporate.status).toBe(200);
      expect(await byCorporate.json()).toEqual({ ...first, holderEmail: null });
      expect((await stored("STK-010")).caseId).toBe(corporate);

      const byPersonal = await call(`/equipment/${second.id}/assign`, "POST", {
        email: "atribui.pessoal@gmail.com",
      });

      expect(byPersonal.status).toBe(200);
      expect(await stored("STK-011")).toEqual(
        expect.objectContaining({ caseId: personal, holderEmail: null }),
      );
    });

    it("explains why an assignment fails", async () => {
      const target = await caseWithEmails("Falha Atribui", "falha.atribui@example.com");

      await caseWithEmails("Dup Um", "dup.um@example.com", "dup.atribui@gmail.com");
      await caseWithEmails("Dup Dois", "dup.dois@example.com", "dup.atribui@gmail.com");

      const stock = await (await register("STK-020")).json();

      const unknown = await call(`/equipment/${stock.id}/assign`, "POST", {
        email: "ninguem@example.com",
      });

      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: "No offboarding case uses this e-mail" });

      const ambiguous = await call(`/equipment/${stock.id}/assign`, "POST", {
        email: "dup.atribui@gmail.com",
      });

      expect(ambiguous.status).toBe(409);

      await call(`/equipment/${stock.id}/assign`, "POST", { email: "falha.atribui@example.com" });

      const again = await call(`/equipment/${stock.id}/assign`, "POST", {
        email: "falha.atribui@example.com",
      });

      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: "Equipment already assigned" });
      expect((await stored("STK-020")).caseId).toBe(target);

      const missing = await call(`/equipment/${missingTaskId}/assign`, "POST", {
        email: "falha.atribui@example.com",
      });

      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: "Equipment not found" });
      expect(
        (await call(`/equipment/${stock.id}/assign`, "POST", { email: "not-an-email" })).status,
      ).toBe(422);
    });

    it("lets visualizador not assign", async () => {
      const res = await app.handle(
        new Request(`http://localhost/api/equipment/${missingTaskId}/assign`, {
          method: "POST",
          headers: {
            "x-test-session": "visualizador",
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email: "x@example.com" }),
        }),
      );

      expect(res.status).toBe(403);
    });

    it("attaches waiting equipment when a case is created", async () => {
      await register("STK-030", { email: "nova.pessoa@example.com" });
      await register("STK-031", { email: "nova.pessoa@gmail.com" });
      await register("STK-032", { email: "outra.nova@example.com" });

      const res = await call("/offboardings", "POST", {
        name: "Nova Pessoa",
        role: "Dev",
        department: "Eng",
        deadline: "2027-02-01",
        email: "Nova.Pessoa@example.com",
        personalEmail: "nova.pessoa@gmail.com",
      });

      const created = await res.json();

      expect(res.status).toBe(201);
      expect((await stored("STK-030")).caseId).toBe(created.id);
      expect(await stored("STK-031")).toEqual(
        expect.objectContaining({ caseId: created.id, holderEmail: null }),
      );
      expect((await stored("STK-032")).caseId).toBeNull();

      const [access] = await db
        .select({ email: employeeAccess.email, personalEmail: employeeAccess.personalEmail })
        .from(employeeAccess)
        .where(eq(employeeAccess.caseId, created.id));

      expect(access).toEqual({
        email: "nova.pessoa@example.com",
        personalEmail: "nova.pessoa@gmail.com",
      });
    });

    it("stores the personal e-mail and attaches equipment on first and later saves", async () => {
      const withEmployees = createApp(webOrigin, repos, {
        ...appOptions,
        auth: { ...auth, resolveEmployee: async () => null },
      });

      const [created] = await db
        .insert(offboardingCases)
        .values({
          orgId: defaultOrgId,
          name: "Acesso Equip",
          role: "Analista",
          department: "Produto",
          deadline: "2027-03-01",
        })
        .returning({ id: offboardingCases.id });

      const caseId = created!.id;

      await register("STK-040", { email: "acesso.equip@example.com" });
      await register("STK-041", { email: "acesso.equip@gmail.com" });

      const first = await call(
        `/employee-access/${caseId}`,
        "PUT",
        { email: "acesso.equip@example.com", plan: emptyEmployeePlan, revision: 0 },
        withEmployees,
      );

      expect(first.status).toBe(200);
      expect((await stored("STK-040")).caseId).toBe(caseId);
      expect((await stored("STK-041")).caseId).toBeNull();

      const second = await call(
        `/employee-access/${caseId}`,
        "PUT",
        {
          email: "acesso.equip@example.com",
          personalEmail: "Acesso.Equip@Gmail.com",
          plan: emptyEmployeePlan,
          revision: 1,
        },
        withEmployees,
      );

      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(
        expect.objectContaining({ personalEmail: "acesso.equip@gmail.com" }),
      );
      expect((await stored("STK-041")).caseId).toBe(caseId);
    });

    it("imports equipment by the personal e-mail", async () => {
      const target = await caseWithEmails("Importa Pessoal", null, "importa.pessoal@gmail.com");

      const res = await call("/equipment/import", "POST", {
        rows: [{ ...notebook, person: "IMPORTA.pessoal@gmail.com", tag: "STK-050" }],
      });

      expect(res.status).toBe(201);
      expect((await stored("STK-050")).caseId).toBe(target);
    });
  });

  describe("equipment import", () => {
    async function freshCase(name: string, email?: string) {
      const [created] = await db
        .insert(offboardingCases)
        .values({
          orgId: defaultOrgId,
          name,
          role: "Analista",
          department: "Produto",
          deadline: "2027-03-01",
        })
        .returning({ id: offboardingCases.id });

      if (email) {
        await db
          .insert(employeeAccess)
          .values({ caseId: created!.id, orgId: defaultOrgId, email, plan: emptyEmployeePlan });
      }

      return created!.id;
    }

    function importRows(
      rows: { person: string; item: string; tag: string; returnMethod: string }[],
    ) {
      return call("/equipment/import", "POST", { rows });
    }

    const notebook = { item: "Notebook", returnMethod: "pickup" };

    it("adds every row, matching people by name or e-mail", async () => {
      const byName = await freshCase("Importada Por Nome");
      const byEmail = await freshCase("Importada Por Email", "importada@example.com");

      const res = await importRows([
        { ...notebook, person: "importada por nome", tag: "IMP-001" },
        { ...notebook, person: "IMPORTADA@example.com", tag: "IMP-002", returnMethod: "in_person" },
      ]);

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ created: 2 });

      const rows = await db
        .select({
          caseId: equipment.caseId,
          tag: equipment.tag,
          fromEmployeePlan: equipment.fromEmployeePlan,
        })
        .from(equipment)
        .where(inArray(equipment.tag, ["IMP-001", "IMP-002"]))
        .orderBy(asc(equipment.tag));

      expect(rows).toEqual([
        { caseId: byName, tag: "IMP-001", fromEmployeePlan: false },
        { caseId: byEmail, tag: "IMP-002", fromEmployeePlan: false },
      ]);
    });

    it("saves nothing when any row has a problem", async () => {
      await freshCase("Importada Sem Problema");

      const res = await importRows([
        { ...notebook, person: "Importada Sem Problema", tag: "IMP-010" },
        { ...notebook, person: "Pessoa Inexistente", tag: "IMP-011" },
      ]);

      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ problems: [{ record: 2, problem: "unknown-person" }] });
      expect(
        await db.select({ id: equipment.id }).from(equipment).where(eq(equipment.tag, "IMP-010")),
      ).toEqual([]);
    });

    it("rejects an empty file", async () => {
      expect((await importRows([])).status).toBe(422);
    });

    it("lets visualizador not import", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/equipment/import", {
          method: "POST",
          headers: {
            "x-test-session": "visualizador",
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: JSON.stringify({ rows: [{ ...notebook, person: "X", tag: "IMP-020" }] }),
        }),
      );

      expect(res.status).toBe(403);
    });
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
      ratings: [
        { key: "assessment", label: "Processo de desligamento", average: 3.4, responses: 5 },
        { key: "managerSupport", label: "Apoio do gestor", average: 3.8, responses: 5 },
        { key: "teamRespect", label: "Respeito da equipe", average: 4, responses: 5 },
        { key: "communication", label: "Clareza da comunicação", average: 3.8, responses: 5 },
        { key: "equipmentReturn", label: "Devolução de equipamentos", average: 3.2, responses: 5 },
        { key: "documents", label: "Documentos e rescisão", average: 3.6, responses: 5 },
      ],
      responsesByMonth: [
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

  it("lists exit survey comments newest first and hides anonymous authors", async () => {
    const cases = await (await call("/offboardings")).json();
    await db.$client.query("DELETE FROM exit_surveys");

    await db.insert(exitSurveys).values([
      {
        orgId: defaultOrgId,
        caseId: cases[0].id,
        npsScore: 8,
        responses: { comment: "Nomeado", anonymous: false },
        topics: [],
        submittedAt: new Date("2026-05-10T12:00:00Z"),
      },
      {
        orgId: defaultOrgId,
        caseId: cases[1].id,
        npsScore: 8,
        responses: { comment: "Anônimo", anonymous: true },
        topics: [],
        submittedAt: new Date("2026-07-10T12:00:00Z"),
      },
      {
        orgId: defaultOrgId,
        caseId: cases[2].id,
        npsScore: 8,
        responses: { comment: "Sem flag" },
        topics: [],
        submittedAt: new Date("2026-06-10T12:00:00Z"),
      },
      {
        orgId: defaultOrgId,
        caseId: cases[3].id,
        npsScore: 8,
        responses: { comment: "", anonymous: false },
        topics: [],
      },
      { orgId: defaultOrgId, caseId: cases[4].id, npsScore: 8, responses: {}, topics: [] },
    ]);

    const res = await call("/exit-surveys/comments");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { comment: "Anônimo", month: "2026-07", author: null },
      { comment: "Sem flag", month: "2026-06", author: null },
      {
        comment: "Nomeado",
        month: "2026-05",
        author: { name: cases[0].name, department: cases[0].department },
      },
    ]);

    const list = await (await call("/exit-surveys")).json();

    for (const { responses } of list) {
      expect(responses).not.toHaveProperty("comment");
      expect(responses).not.toHaveProperty("anonymous");
    }
  });

  it("returns zeroed aggregates without surveys", async () => {
    await db.$client.query("DELETE FROM exit_surveys");
    const res = await call("/exit-surveys/aggregates");

    expect(await res.json()).toEqual({
      totalResponses: 0,
      averageNps: 0,
      nps: 0,
      completionRate: 0,
      ratings: [
        { key: "assessment", label: "Processo de desligamento", average: 0, responses: 0 },
        { key: "managerSupport", label: "Apoio do gestor", average: 0, responses: 0 },
        { key: "teamRespect", label: "Respeito da equipe", average: 0, responses: 0 },
        { key: "communication", label: "Clareza da comunicação", average: 0, responses: 0 },
        { key: "equipmentReturn", label: "Devolução de equipamentos", average: 0, responses: 0 },
        { key: "documents", label: "Documentos e rescisão", average: 0, responses: 0 },
      ],
      responsesByMonth: [],
      topTopics: [],
    });
  });

  it("fills quiet months, keeps the last six and ignores invalid ratings", async () => {
    const cases = await (await call("/offboardings")).json();
    await db.$client.query("DELETE FROM exit_surveys");

    const dated = [
      ["2026-01-10", { assessment: 1 }],
      ["2026-03-10", { assessment: 4, managerSupport: 6 }],
      ["2026-06-10", { assessment: 0, managerSupport: 3.5, teamRespect: 7, communication: null }],
      ["2026-08-20", { assessment: 5, managerSupport: 2 }],
    ] as const;

    await db.insert(exitSurveys).values(
      dated.map(([date, responses], index) => ({
        orgId: defaultOrgId,
        caseId: cases[index].id,
        npsScore: 8,
        responses,
        topics: [],
        submittedAt: new Date(`${date}T12:00:00Z`),
      })),
    );

    const body = await (await call("/exit-surveys/aggregates")).json();

    expect(body.responsesByMonth).toEqual([
      { label: "Mar", value: 1 },
      { label: "Abr", value: 0 },
      { label: "Mai", value: 0 },
      { label: "Jun", value: 1 },
      { label: "Jul", value: 0 },
      { label: "Ago", value: 1 },
    ]);

    expect(body.ratings.slice(0, 3)).toMatchObject([
      { key: "assessment", average: 3.3, responses: 3 },
      { key: "managerSupport", average: 2, responses: 1 },
      { key: "teamRespect", average: 0, responses: 0 },
    ]);
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
    expect((await send("rh", "/exit-surveys/comments")).status).toBe(200);
    expect((await send("visualizador", "/exit-surveys/comments")).status).toBe(403);

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

  const ruleBody = {
    name: "Close on receive",
    trigger: "equipment.status_changed",
    conditions: { "equipment.status": "received" },
    actions: [{ type: "update_task", set: { status: "done" } }],
  };

  it("creates, reads, updates and deletes an automation rule", async () => {
    const created = await call("/automation-rules", "POST", ruleBody);
    const rule = await created.json();

    expect(created.status).toBe(201);
    expect(rule).toEqual({
      id: expect.any(String),
      ...ruleBody,
      enabled: true,
      cronSchedule: null,
      sourceRef: null,
    });

    expect(await (await call("/automation-rules")).json()).toContainEqual(rule);
    expect(await (await call(`/automation-rules/${rule.id}`)).json()).toEqual(rule);

    const updated = await call(`/automation-rules/${rule.id}`, "PUT", {
      enabled: false,
      cronSchedule: "0 9 * * *",
    });

    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: rule.id,
      enabled: false,
      cronSchedule: "0 9 * * *",
    });

    expect((await call(`/automation-rules/${rule.id}`, "DELETE")).status).toBe(204);
    expect((await call(`/automation-rules/${rule.id}`)).status).toBe(404);
  });

  it("returns 404 for unknown automation rules", async () => {
    expect((await call(`/automation-rules/${missingCaseId}`)).status).toBe(404);
    expect(
      (
        await call(`/automation-rules/${missingCaseId}`, "PUT", {
          enabled: false,
        })
      ).status,
    ).toBe(404);
    expect((await call(`/automation-rules/${missingCaseId}`, "DELETE")).status).toBe(404);
  });

  it("rejects invalid automation rules", async () => {
    const noName = await call("/automation-rules", "POST", {
      ...ruleBody,
      name: "",
    });

    const badTrigger = await call("/automation-rules", "POST", {
      ...ruleBody,
      trigger: "nope",
    });

    const badAction = await call("/automation-rules", "POST", {
      ...ruleBody,
      actions: [{ type: "nope" }],
    });

    expect(noName.status).toBe(422);
    expect(badTrigger.status).toBe(422);
    expect(badAction.status).toBe(422);
  });

  it("keeps automation rules of other organizations out of reach", async () => {
    const other = await repos.automationRules.createRule(otherOrgId, {
      name: "Other org",
      trigger: "task.status_changed",
      conditions: {},
      actions: [],
    });

    expect((await call(`/automation-rules/${other.id}`)).status).toBe(404);
    expect((await call(`/automation-rules/${other.id}`, "PUT", { enabled: false })).status).toBe(
      404,
    );
    expect((await call(`/automation-rules/${other.id}`, "DELETE")).status).toBe(404);
    expect(await (await call("/automation-rules")).json()).not.toContainEqual(
      expect.objectContaining({ id: other.id }),
    );

    await repos.automationRules.deleteRule(otherOrgId, other.id);
  });

  it("restricts automation rule access by role", async () => {
    const send = (role: string, method: string, body?: typeof ruleBody) =>
      app.handle(
        new Request("http://localhost/api/automation-rules", {
          method,
          headers: {
            "x-test-session": role,
            origin: webOrigin,
            "content-type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );

    expect((await send("visualizador", "GET")).status).toBe(403);
    expect((await send("visualizador", "POST", ruleBody)).status).toBe(403);
  });

  it("runs scheduled automation rules only with the cron secret", async () => {
    const rule = await repos.automationRules.createRule(defaultOrgId, {
      name: "Nightly",
      trigger: "schedule.cron",
      conditions: {},
      actions: [{ type: "correios_check" }, { type: "email", to: "rh@example.com" }],
      cronSchedule: "0 9 * * *",
    });

    const run = (authorization?: string) =>
      app.handle(
        new Request("http://localhost/api/automation-rules/run-scheduled", {
          method: "POST",
          headers: authorization ? { authorization } : {},
        }),
      );

    try {
      expect((await run()).status).toBe(401);
      expect((await run("Bearer wrong")).status).toBe(401);

      await call("/integrations/E-mail", "PUT", { status: "disconnected" });

      const ok = await run(`Bearer ${cronSecret}`);

      expect(ok.status).toBe(200);
      expect(await ok.json()).toContainEqual({
        ruleId: rule.id,
        matched: true,
        errors: ["correios_check: correios_check is not available", "email: E-mail disabled"],
      });
    } finally {
      await call("/integrations/E-mail", "PUT", { status: "connected" });
      await repos.automationRules.deleteRule(defaultOrgId, rule.id);
    }
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

  it("updates a team member's role", async () => {
    const [, camila] = await (await call("/team")).json();

    const res = await call(`/team/${camila.id}`, "PATCH", { role: "gestor" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...camila, role: "gestor" });
  });

  it("rejects demoting the last admin", async () => {
    const [admin] = await (await call("/team")).json();

    const res = await call(`/team/${admin.id}`, "PATCH", { role: "rh" });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Cannot demote the last admin" });
  });

  it("rejects changing one's own role", async () => {
    const [, camila] = await (await call("/team")).json();

    const res = await app.handle(
      new Request(`http://localhost/api/team/${camila.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: webOrigin,
          "x-test-member-id": camila.id,
        },
        body: JSON.stringify({ role: "gestor" }),
      }),
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Cannot change own role" });
  });

  it("returns 404 when updating unknown team member", async () => {
    const res = await call(`/team/${missingCaseId}`, "PATCH", { role: "rh" });

    expect(res.status).toBe(404);
  });

  it("rethrows non-unique-violation errors from createOffboarding", async () => {
    const failing = createApp(
      webOrigin,
      {
        ...repos,
        offboardings: {
          ...repos.offboardings,
          createOffboarding: () => Promise.reject(new Error("unexpected")),
        },
      },
      appOptions,
    );

    const res = await failing.handle(
      new Request("http://localhost/api/offboardings", {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({
          name: "Rethrow",
          role: "Dev",
          department: "Eng",
          deadline: "2026-12-01",
          email: "rethrow@example.com",
        }),
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

  it("returns 404 when the task disappears between owner lookup and update", async () => {
    const stubbed = createApp(
      webOrigin,
      {
        ...repos,
        offboardings: {
          ...repos.offboardings,
          getTaskOrgId: () => Promise.resolve(defaultOrgId),
          updateTaskStatus: () => Promise.resolve(null),
        },
      },
      appOptions,
    );

    const res = await stubbed.handle(
      new Request(`http://localhost/api/webhooks/inbound/${missingTaskId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${webhookSecret}`,
        },
        body: JSON.stringify({ event: "delivered" }),
      }),
    );

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
    const trackingApp = createApp(webOrigin, repos, { ...appOptions, tracking: trackingConfig });

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: false,
        eventos: [
          {
            descricao: "Objeto em trânsito - por favor aguarde",
            dtHrCriado: { date: "2026-11-18 16:00:00.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "AB123456789BR" }).where(eq(tasks.id, task.id));

    const res = await trackingApp.handle(
      new Request(`http://localhost/api/tasks/${task.id}/tracking`),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trackingCode).toBe("AB123456789BR");
    expect(body.tracking).toEqual({
      delivered: false,
      lastEvent: "Objeto em trânsito - por favor aguarde",
      lastUpdate: "2026-11-18 16:00",
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

  it("returns null tracking when tracking is not configured", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "XX000000000BR" }).where(eq(tasks.id, task.id));

    const res = await app.handle(new Request(`http://localhost/api/tasks/${task.id}/tracking`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trackingCode: "XX000000000BR", tracking: null });
  });

  it("hides tracking and skips the delivery check when Correios is switched off", async () => {
    const trackingApp = createApp(webOrigin, repos, { ...appOptions, tracking: trackingConfig });

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: true,
        eventos: [{ descricao: "Objeto entregue ao destinatário" }],
      },
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "OF000000000BR" }).where(eq(tasks.id, task.id));
    await call("/integrations/Transportadora%3A%3ACorreios", "PUT", { status: "disconnected" });

    const res = await trackingApp.handle(
      new Request(`http://localhost/api/tasks/${task.id}/tracking`),
    );

    expect(await res.json()).toEqual({ trackingCode: "OF000000000BR", tracking: null });

    const checked = await trackingApp.handle(
      new Request("http://localhost/api/correios/check", {
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );

    expect((await checked.json()).delivered).not.toContain(task.id);
  });

  it("returns 404 for tracking on unknown task", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/tasks/${missingTaskId}/tracking`),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Task not found" });
  });

  it("checks tracked shipments via GET and marks delivered tasks done", async () => {
    const trackingApp = createApp(webOrigin, repos, { ...appOptions, tracking: trackingConfig });

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: true,
        eventos: [
          {
            descricao: "Objeto entregue ao destinatário",
            dtHrCriado: { date: "2026-11-20 10:30:00.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "CD987654321BR" }).where(eq(tasks.id, todo.id));

    const res = await trackingApp.handle(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBeGreaterThanOrEqual(1);
    expect(body.delivered).toContain(todo.id);

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("done");
  });

  it("skips tracking check when tracking is not configured", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "ZZ000000000BR" }).where(eq(tasks.id, todo.id));

    const res = await app.handle(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.delivered).toEqual([]);
  });

  it("checks tracked shipments via POST", async () => {
    const trackingApp = createApp(webOrigin, repos, { ...appOptions, tracking: trackingConfig });

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_NOT_FOUND",
      carrier: "CARRIER_CORREIOS",
    });

    const res = await trackingApp.handle(cronRequest("POST"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checked).toBeGreaterThanOrEqual(0);
    expect(body.delivered).toEqual([]);
  });

  it("does not mark non-delivered tracked tasks as done", async () => {
    const trackingApp = createApp(webOrigin, repos, { ...appOptions, tracking: trackingConfig });

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: false,
        eventos: [
          {
            descricao: "Objeto em trânsito - por favor aguarde",
            dtHrCriado: { date: "2026-11-18 16:00:00.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db.update(tasks).set({ trackingCode: "EF111222333BR" }).where(eq(tasks.id, todo.id));

    const res = await trackingApp.handle(cronRequest());

    const body = await res.json();
    expect(body.delivered).toEqual([]);

    const after = await (await call(`/offboardings/${list[0].id}`)).json();
    expect(after.tasks.find((t: { id: string }) => t.id === todo.id).status).toBe("todo");
  });

  it("fires actions for delivered tasks with a phase", async () => {
    const trackingApp = createApp(webOrigin, repos, { ...appOptions, tracking: trackingConfig });

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: true,
        eventos: [
          {
            descricao: "Objeto entregue ao destinatário",
            dtHrCriado: { date: "2026-11-21 09:00:00.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
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

    const res = await trackingApp.handle(cronRequest());

    const body = await res.json();
    expect(body.delivered).toContain(taskWithPhase.id);
  });

  it("fires correios.delivered rules with the task and case", async () => {
    const trackingApp = createApp(webOrigin, repos, { ...appOptions, tracking: trackingConfig });
    hooks.length = 0;

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: true,
        eventos: [
          {
            descricao: "Objeto entregue ao destinatário",
            dtHrCriado: { date: "2026-11-22 09:00:00.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const todo = detail.tasks.find((t: { status: string }) => t.status === "todo");

    await db
      .update(tasks)
      .set({ trackingCode: "GH777888999BR", phase: null })
      .where(eq(tasks.id, todo.id));

    const rule = await repos.automationRules.createRule(defaultOrgId, {
      name: "Delivered hook",
      trigger: "correios.delivered",
      conditions: { "task.id": todo.id },
      actions: [{ type: "webhook", url: hookUrl }],
    });

    try {
      const body = await (await trackingApp.handle(cronRequest())).json();

      expect(body.delivered).toContain(todo.id);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]).toMatchObject({
        task: { id: todo.id, status: "done" },
        case: { id: list[0].id, name: list[0].name },
      });
    } finally {
      await repos.automationRules.deleteRule(defaultOrgId, rule.id);
    }
  });

  it("includes trackingCode in task details", async () => {
    const list = await (await call("/offboardings")).json();
    const detail = await (await call(`/offboardings/${list[0].id}`)).json();
    const task = detail.tasks[0];

    expect(task).toHaveProperty("trackingCode");
  });

  it("handles task deletion during tracking check gracefully", async () => {
    const stubbedApp = createApp(
      webOrigin,
      {
        ...repos,
        offboardings: {
          ...repos.offboardings,
          getTrackedTasks: () =>
            Promise.resolve([
              {
                id: missingTaskId,
                orgId: defaultOrgId,
                title: "Gone",
                phase: "d0",
                stepId: null,
                trackingCode: "ZZ999999999BR",
                caseId: randomUUID(),
                caseName: "Gone",
              },
            ]),
        },
      },
      { ...appOptions, tracking: trackingConfig },
    );

    trackingStatus = 200;
    trackingBody = JSON.stringify({
      status: "TRACKING_STATUS_FOUND",
      carrier: "CARRIER_CORREIOS",
      payload: {
        temEventoEntrega: true,
        eventos: [
          {
            descricao: "Objeto entregue ao destinatário",
            dtHrCriado: { date: "2026-11-21 10:00:00.000000", timezone: "America/Sao_Paulo" },
          },
        ],
      },
    });

    const res = await stubbedApp.handle(cronRequest());

    const body = await res.json();
    expect(body.checked).toBe(1);
    expect(body.delivered).toEqual([]);
  });
});

describe.skipIf(!url)("employee journey with PostgreSQL and Better Auth", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const codes = new Map<string, string>();
  const links = new Map<string, string>();
  const grants = new Map<string, string>();
  let requests = 0;

  const employeeAuth = createAuth({
    db,
    origin: webOrigin,
    staffEmails: new Set(),
    secret: randomUUID() + randomUUID(),
    ipAddressHeaders: ["x-test-employee-ip"],
    talent: repos.talent,
    sendLink: async ({ email, url }) => {
      links.set(email, url);
    },
    sendCode: async ({ email, code }) => {
      codes.set(email, code);
    },
  });

  const app = createApp(webOrigin, repos, { auth: employeeAuth, sendEmail });

  let carrierBody = "";

  const carrierServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(carrierBody);
  });

  type EmployeeSettings = Parameters<typeof repos.employee.saveSettings>[2];

  function request(
    path: string,
    method = "GET",
    cookie?: string,
    body?:
      | { email: string; type: "sign-in" }
      | { email: string; otp: string }
      | { email: string }
      | EmployeeState
      | EmployeeSettings
      | { done: boolean }
      | { code: string; received: boolean }
      | { shareOutcomeWithHr: boolean }
      | { email: string; callbackURL: string }
      | { code: string },
    origin = webOrigin,
    nativeOrigin?: string,
    grantId = cookie ? grants.get(cookie) : undefined,
  ) {
    requests += 1;
    const headers = new Headers({ "x-test-employee-ip": `192.0.2.${requests}` });

    if (nativeOrigin) headers.set("expo-origin", nativeOrigin);
    else headers.set("origin", origin);

    if (cookie) headers.set("cookie", cookie);

    if (grantId) headers.set(employeeGrantHeader, grantId);

    if (body) headers.set("content-type", "application/json");

    return app.handle(
      new Request(webOrigin + "/api" + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  }

  async function sendCode(email: string) {
    return request("/auth/email-otp/send-verification-otp", "POST", undefined, {
      email,
      type: "sign-in",
    });
  }

  async function signIn(email: string, code: string, nativeOrigin?: string) {
    return request(
      "/auth/sign-in/email-otp",
      "POST",
      undefined,
      { email, otp: code },
      webOrigin,
      nativeOrigin,
    );
  }

  async function rememberGrant(cookie: string) {
    const session = await request("/employee/session", "GET", cookie);
    expect(session.status).toBe(200);
    const grantId = z.object({ grantId: z.uuid() }).parse(await session.json()).grantId;
    grants.set(cookie, grantId);

    return grantId;
  }

  async function authenticate(email: string) {
    expect((await sendCode(email)).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No code delivered");

    const response = await signIn(email, code);
    expect(response.status).toBe(200);

    const session = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="));

    expect(session).toContain("HttpOnly");

    const cookie = session?.split(";")[0] ?? "";
    await rememberGrant(cookie);

    return cookie;
  }

  beforeAll(async () => {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
    });

    await new Promise<void>((resolve) => {
      carrierServer.listen(0, "127.0.0.1", resolve);
    });
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      carrierServer.close(() => resolve());
    });

    await db.$client.end();
  });

  it("does not expose employee access settings through fallback portal authentication", async () => {
    const fallbackApp = createApp(webOrigin, repos, { auth, sendEmail });
    const target = webOrigin + "/api/employee-access/" + missingCaseId;
    expect((await fallbackApp.handle(new Request(target))).status).toBe(503);
    expect(
      (
        await fallbackApp.handle(
          new Request(target, {
            method: "PUT",
            headers: { origin: webOrigin, "content-type": "application/json" },
            body: JSON.stringify({ email: null, plan: emptyEmployeePlan, revision: 0 }),
          }),
        )
      ).status,
    ).toBe(503);
  });

  it("shares the employee checklist, booking and per-item receipts with the HR case", async () => {
    const email = `workflow-${randomUUID()}@offboard.example`;
    const layout = (await repos.actionConfigs.readChecklist(defaultOrgId)).steps;

    const person = {
      name: "Pessoa do fluxo",
      role: "Analista",
      department: "TI",
      deadline: "2027-03-03",
      email,
    };

    const record = await repos.offboardings.createOffboarding(defaultOrgId, person, [
      ...layout,
      {
        id: "form",
        title: "Conferir dados",
        team: "Pessoa desligada",
        phase: "d0",
        deadlineOffset: 1,
        deadlineTime: "09:30",
      },
    ]);

    const foreign = await repos.offboardings.createOffboarding(
      defaultOrgId,
      { ...person, email: `foreign-${randomUUID()}@offboard.example` },
      layout,
    );

    const detail = await repos.offboardings.getOffboarding(defaultOrgId, record.id);
    const manual = detail?.tasks.find((task) => task.title === "Conferir dados");

    const confirm = detail?.tasks.find(
      (task) => task.title === "Confirmar os itens para devolução",
    );

    const internal = detail?.tasks.find((task) => task.title === "Bloquear acessos");

    const foreignTask = (await repos.offboardings.getOffboarding(defaultOrgId, foreign.id))
      ?.tasks[0];

    if (!manual || !confirm || !internal || !foreignTask)
      throw new Error("Checklist not generated");

    const plan = {
      ...emptyEmployeePlan,
      bookingDays: ["2027-03-01", "2027-03-02"],
      officeAddress: "Escritório da equipe",
      equipment: [
        { title: "Notebook", code: "QA-1", model: "" },
        { title: "Monitor", code: "QA-2", model: "" },
      ],
    };

    expect(
      await repos.employee.saveSettings(defaultOrgId, record.id, { email, plan, revision: 1 }),
    ).toBe("saved");

    const hr = createApp(webOrigin, repos, {
      ...appOptions,
      auth: { ...auth, resolveEmployee: employeeAuth.resolveEmployee },
    });

    function portal(
      path: string,
      method = "GET",
      body?: { code: string; received: boolean } | EmployeeSettings,
      role = "rh",
    ) {
      return hr.handle(
        new Request(webOrigin + "/api" + path, {
          method,
          headers: {
            "content-type": "application/json",
            origin: webOrigin,
            "x-test-session": role,
          },
          body: body && JSON.stringify(body),
        }),
      );
    }

    const inventory = "/equipment-returns/" + record.id;
    expect((await portal("/equipment-returns")).status).toBe(200);
    expect(await (await portal(inventory + "/address")).json()).toEqual({ address: null });
    expect((await portal("/equipment-returns/" + missingCaseId + "/address")).status).toBe(404);
    expect(await (await portal(inventory)).json()).toMatchObject([
      { code: "QA-1", received: false, schedule: null },
      { code: "QA-2", received: false, schedule: null },
    ]);

    await db.insert(equipment).values({
      orgId: defaultOrgId,
      caseId: foreign.id,
      tag: "INVENTARIO-ANTIGO",
      item: "Bens do inventário",
      returnMethod: "pickup",
      status: "with_person",
    });
    const independent = "/equipment-returns/" + foreign.id;
    expect(await (await portal(independent)).json()).toMatchObject([
      { code: "INVENTARIO-ANTIGO", model: "" },
    ]);
    expect(
      (
        await portal(independent + "/receipt", "PATCH", {
          code: "INVENTARIO-ANTIGO",
          received: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await portal(independent + "/receipt", "PATCH", {
          code: "INVENTARIO-ANTIGO",
          received: false,
        })
      ).status,
    ).toBe(200);
    expect(await (await portal(independent)).json()).toMatchObject([{ status: "with_person" }]);

    const orgId = randomUUID();
    await db.insert(organizations).values({ id: orgId, slug: orgId, name: "Outra organização" });

    try {
      const other = await repos.actionConfigs.saveChecklist(orgId, {
        revision: 0,
        steps: [],
        knownRowIds: [],
      });

      expect(other?.steps).toEqual([]);
      expect((await repos.actionConfigs.readChecklist(defaultOrgId)).steps).toEqual(layout);
      expect(await repos.employee.listEquipmentReturns(orgId, record.id)).toEqual([]);
      expect(await repos.employee.readCollectionBooking(orgId, record.id)).toBeNull();
      expect(await repos.employee.updateReceipt(orgId, record.id, "QA-1", true)).toBeNull();
      expect(await repos.offboardings.applyChecklist(orgId, record.id, layout)).toBeNull();
      expect(
        (await portal("/employee-access/" + foreign.id, "PUT", { email: null, plan, revision: 1 }))
          .status,
      ).toBe(409);
    } finally {
      await db.delete(checklistModels).where(eq(checklistModels.orgId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }

    const cookie = await authenticate(email);
    codes.delete(email);
    const taskPath = "/employee/checklist/";
    expect((await request(taskPath + manual.id, "PATCH", cookie, { done: true })).status).toBe(403);
    expect(
      (await request("/employee/tracking-code", "PATCH", cookie, { code: "AA000000000BR" })).status,
    ).toBe(403);
    expect(
      (
        await request("/employee/state", "PUT", cookie, {
          key: "consent",
          revision: 0,
          value: { accepted: true },
        })
      ).status,
    ).toBe(200);
    const staleConsent: EmployeeState = { key: "consent", revision: 0, value: { accepted: false } };
    expect((await request("/employee/state", "PUT", cookie, staleConsent)).status).toBe(409);

    const journey = await (await request("/employee/journey", "GET", cookie)).json();
    expect(journey.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: manual.id,
          action: "check",
          status: "todo",
          dueDate: "2027-03-04",
          dueTime: "09:30",
        }),
        expect.objectContaining({ id: confirm.id, action: "equipment", dueTime: null }),
        expect.objectContaining({ action: "feedback" }),
      ]),
    );
    expect(journey.checklist.map((task: { id: string }) => task.id)).not.toContain(internal.id);

    for (const task of [internal, foreignTask, confirm]) {
      expect((await request(taskPath + task.id, "PATCH", cookie, { done: true })).status).toBe(404);
    }

    for (const done of [true, true, false, true]) {
      expect(await (await request(taskPath + manual.id, "PATCH", cookie, { done })).json()).toEqual(
        {
          id: manual.id,
          status: done ? "done" : "todo",
        },
      );
    }

    expect(journey.trackingCode).toBeNull();

    const trackingRequest = (instance: typeof app) =>
      instance.handle(
        new Request(webOrigin + "/api/employee/tracking", {
          headers: {
            origin: webOrigin,
            cookie,
            [employeeGrantHeader]: grants.get(cookie) ?? "",
            "x-test-employee-ip": "192.0.2.250",
          },
        }),
      );

    expect(await (await trackingRequest(app)).json()).toEqual({
      trackingCode: null,
      tracking: null,
    });

    const revoked = createApp(
      webOrigin,
      { ...repos, employee: { ...repos.employee, withAccess: async () => null } },
      { auth: employeeAuth, sendEmail },
    );

    expect((await trackingRequest(revoked)).status).toBe(401);

    expect(
      (await request("/employee/tracking-code", "PATCH", cookie, { code: "INVALID!" })).status,
    ).toBe(422);

    const trackingResult = await (
      await request("/employee/tracking-code", "PATCH", cookie, { code: "AB123456789BR" })
    ).json();

    expect(trackingResult.trackingCode).toBe("AB123456789BR");

    const journeyAfterTracking = await (await request("/employee/journey", "GET", cookie)).json();

    expect(journeyAfterTracking.trackingCode).toBe("AB123456789BR");

    expect(
      (
        await db
          .select({ status: equipment.status })
          .from(equipment)
          .where(eq(equipment.caseId, record.id))
      ).map(({ status }) => status),
    ).toEqual(["transit", "transit"]);

    expect(await (await trackingRequest(app)).json()).toEqual({
      trackingCode: "AB123456789BR",
      tracking: null,
    });

    const shipmentApp = createApp(webOrigin, repos, {
      ...appOptions,
      auth: { ...auth, resolveEmployee: employeeAuth.resolveEmployee },
      tracking: {
        baseUrl: `http://127.0.0.1:${z.object({ port: z.number() }).parse(carrierServer.address()).port}`,
        apiKey: "key",
      },
    });

    const respond = (delivered: boolean, descricao: string) => {
      carrierBody = JSON.stringify({
        status: "TRACKING_STATUS_FOUND",
        payload: {
          temEventoEntrega: delivered,
          eventos: [{ descricao, dtHrCriado: { date: "2026-11-18 16:00:00.000000" } }],
        },
      });
    };

    const switchCorreios = (status: "connected" | "disconnected") =>
      db
        .insert(integrations)
        .values({ orgId: defaultOrgId, name: "Transportadora::Correios", status })
        .onConflictDoUpdate({
          target: [integrations.orgId, integrations.name],
          set: { status },
        });

    await switchCorreios("connected");
    respond(false, "Objeto postado");

    expect(await (await trackingRequest(shipmentApp)).json()).toEqual({
      trackingCode: "AB123456789BR",
      tracking: { delivered: false, lastEvent: "Objeto postado", lastUpdate: "2026-11-18 16:00" },
    });

    await switchCorreios("disconnected");
    expect((await (await trackingRequest(shipmentApp)).json()).tracking).toBeNull();
    await switchCorreios("connected");

    respond(true, "Objeto entregue");

    const check = await shipmentApp.handle(
      new Request("http://localhost/api/correios/check", {
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );

    expect((await check.json()).delivered.length).toBeGreaterThan(0);
    expect(
      (
        await db
          .select({ status: equipment.status })
          .from(equipment)
          .where(eq(equipment.caseId, record.id))
      ).map(({ status }) => status),
    ).toEqual(["received", "received"]);
    await db
      .update(equipment)
      .set({ status: "with_person" })
      .where(eq(equipment.caseId, record.id));
    await db
      .update(tasks)
      .set({ status: "todo" })
      .where(and(eq(tasks.caseId, record.id), eq(tasks.checklistStepId, "collect")));

    await db
      .update(tasks)
      .set({ checklistStepId: null })
      .where(and(eq(tasks.caseId, record.id), eq(tasks.checklistStepId, "collect")));
    expect(
      (await request("/employee/tracking-code", "PATCH", cookie, { code: "XX000000000BR" })).status,
    ).toBe(404);
    await db
      .update(tasks)
      .set({ checklistStepId: "collect" })
      .where(and(eq(tasks.caseId, record.id), isNull(tasks.checklistStepId)));

    const booking = {
      method: "pickup",
      address: "Rua do Teste, 45, São Paulo",
      day: "2027-03-01",
      slot: "morning",
    } as const;

    const departure = {
      key: "departure-v1",
      revision: 0,
      value: {
        booking,
        feedback: {
          anonymous: true,
          assessment: 5,
          clarity: null,
          respect: null,
          comment: "",
          recommendation: null,
          managerSupport: null,
          teamRespect: null,
          communication: null,
          equipmentReturn: null,
          documents: null,
          topics: [],
        },
        examAttended: false,
        handoffCompleted: [],
      },
    } satisfies EmployeeState;

    expect((await request("/employee/state", "PUT", cookie, departure)).status).toBe(200);
    expect((await request("/employee/state", "PUT", cookie, departure)).status).toBe(200);
    const scheduled = await (await portal(inventory)).json();
    expect(scheduled[0]).toMatchObject({
      code: "QA-1",
      schedule: { method: "pickup", day: booking.day, slot: booking.slot },
    });
    expect(scheduled[0].schedule).not.toHaveProperty("address");
    expect(await (await portal(inventory + "/address")).json()).toEqual({
      address: booking.address,
    });
    expect((await portal(inventory + "/address", "GET", undefined, "visualizador")).status).toBe(
      403,
    );
    expect(
      (await request(inventory + "/receipt", "PATCH", cookie, { code: "QA-1", received: true }))
        .status,
    ).toBe(401);

    const receipt = (code: string, received: boolean) =>
      portal(inventory + "/receipt", "PATCH", { code, received });

    expect((await receipt("outro", true)).status).toBe(404);
    expect(
      (
        await portal("/equipment-returns/" + missingCaseId + "/receipt", "PATCH", {
          code: "QA-1",
          received: true,
        })
      ).status,
    ).toBe(404);

    for (const [code, received] of [
      ["QA-1", true],
      ["QA-1", true],
      ["QA-2", true],
    ] as const) {
      expect(await (await receipt(code, received)).json()).toEqual({ received });
    }

    const closed = await (await request("/employee/journey", "GET", cookie)).json();
    expect(closed.equipment).toMatchObject([{ received: true }, { received: true }]);
    expect(closed.checklist.every((task: { status: string }) => task.status === "done")).toBe(true);
    const returned = await repos.offboardings.getOffboarding(defaultOrgId, record.id);
    expect(
      returned?.tasks.find((task) => task.title === "Conferir os bens devolvidos")?.status,
    ).toBe("done");
    expect(
      returned?.tasks.find((task) => task.title === "Agendar a coleta de equipamentos")?.status,
    ).toBe("done");

    const changeBooking = {
      ...departure,
      revision: 1,
      value: { ...departure.value, booking: { ...booking, day: "2027-03-02" } },
    };

    expect((await request("/employee/state", "PUT", cookie, changeBooking)).status).toBe(422);
    expect(await (await receipt("QA-2", false)).json()).toEqual({ received: false });
    expect((await request("/employee/state", "PUT", cookie, changeBooking)).status).toBe(200);
    expect(
      (await repos.offboardings.getOffboarding(defaultOrgId, record.id))?.tasks.find(
        (task) => task.title === "Conferir os bens devolvidos",
      )?.status,
    ).toBe("todo");
    expect(
      await repos.employee.saveSettings(defaultOrgId, record.id, {
        email,
        plan: { ...plan, equipment: plan.equipment.slice(0, 1) },
        revision: 2,
      }),
    ).toBe("saved");
    expect(
      (await repos.offboardings.getOffboarding(defaultOrgId, record.id))?.tasks.find(
        (task) => task.title === "Conferir os bens devolvidos",
      )?.status,
    ).toBe("done");
    expect(
      await repos.employee.saveSettings(defaultOrgId, record.id, { email, plan, revision: 3 }),
    ).toBe("saved");
    expect(
      (await repos.offboardings.getOffboarding(defaultOrgId, record.id))?.tasks.find(
        (task) => task.title === "Conferir os bens devolvidos",
      )?.status,
    ).toBe("todo");

    const office = {
      ...departure,
      revision: 2,
      value: {
        ...departure.value,
        feedback: null,
        booking: { method: "office", day: "2027-03-02", slot: "afternoon" } as const,
      },
    };

    expect((await request("/employee/state", "PUT", cookie, office)).status).toBe(200);
    expect(await (await portal(inventory + "/address")).json()).toEqual({
      address: plan.officeAddress,
    });

    const racingApp = createApp(webOrigin, repos, {
      sendEmail,
      auth: {
        ...employeeAuth,
        async resolveEmployee(headers) {
          const principal = await employeeAuth.resolveEmployee(headers);

          if (principal)
            await repos.employee.saveSettings(defaultOrgId, record.id, {
              email: null,
              plan,
              revision: 4,
            });

          return principal;
        },
      },
    });

    const raced = await racingApp.handle(
      new Request(webOrigin + "/api" + taskPath + manual.id, {
        method: "PATCH",
        headers: {
          origin: webOrigin,
          cookie,
          [employeeGrantHeader]: grants.get(cookie) ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify({ done: false }),
      }),
    );

    expect(raced.status).toBe(401);
    expect(
      (await repos.offboardings.getOffboarding(defaultOrgId, record.id))?.tasks.find(
        (task) => task.id === confirm.id,
      )?.status,
    ).toBe("todo");
    expect(await (await portal(inventory + "/address")).json()).toEqual({ address: null });
  });

  it("separates employee sessions from HR and shares confirmed, revisioned progress only with the owner", async () => {
    const email = `employee-${randomUUID()}@offboard.example`;
    const secondEmail = `employee-${randomUUID()}@offboard.example`;

    const first = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Primeira Pessoa",
      role: "Analista",
      department: "RH",
      deadline: "2027-02-01",
      email,
    });

    const second = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Segunda Pessoa",
      role: "Analista",
      department: "TI",
      deadline: "2027-02-02",
      email: secondEmail,
    });

    const plan = {
      ...emptyEmployeePlan,
      bookingDays: ["2027-01-25"],
      equipment: [{ title: "Notebook", code: "123", model: "" }],
    };

    await repos.team.createTeamMember(defaultOrgId, {
      email,
      name: "RH com o mesmo e-mail",
      role: "admin",
    });
    await repos.employee.saveSettings(defaultOrgId, first.id, { email, plan, revision: 1 });
    await repos.employee.saveSettings(defaultOrgId, second.id, {
      email: secondEmail,
      plan: emptyEmployeePlan,
      revision: 1,
    });

    const anonymous = await sendCode(`unknown-${randomUUID()}@offboard.example`);
    expect(anonymous.status).toBe(200);
    expect(codes.size).toBe(0);
    expect((await request("/employee/session")).status).toBe(401);
    expect(
      (
        await request(
          "/auth/email-otp/send-verification-otp",
          "POST",
          undefined,
          { email, type: "sign-in" },
          "https://foreign.example",
        )
      ).status,
    ).toBe(403);

    const cookie = await authenticate(email);
    const secondCookie = await authenticate(secondEmail);
    expect((await signIn(email, codes.get(email) ?? "")).status).toBe(400);
    expect((await request("/session", "GET", cookie)).status).toBe(401);
    expect((await request(`/employee-access/${second.id}`, "GET", cookie)).status).toBe(401);
    const journeyBeforeConsent = await request("/employee/journey", "GET", cookie);
    expect(journeyBeforeConsent.status).toBe(200);
    expect(journeyBeforeConsent.headers.get("cache-control")).toBe("private, no-store");
    expect(await journeyBeforeConsent.json()).toMatchObject({ deadline: first.deadline, plan });

    const initialConsent = await request("/employee/state/consent", "GET", cookie);
    expect(await initialConsent.json()).toEqual({
      key: "consent",
      revision: 0,
      value: { accepted: false },
    });
    const careerBeforeConsent = await request("/employee/state/career", "GET", cookie);
    expect(careerBeforeConsent.status).toBe(200);
    expect(await careerBeforeConsent.json()).toMatchObject({
      key: "career",
      revision: 0,
      value: { base: { name: first.name }, versions: [], applications: [] },
    });

    const blockedDeparture: EmployeeState = {
      key: "departure-v1",
      revision: 0,
      value: {
        booking: null,
        handoffCompleted: [],
        examAttended: false,
        feedback: null,
      },
    };

    expect((await request("/employee/state", "PUT", cookie, blockedDeparture)).status).toBe(403);

    const consent = { key: "consent", revision: 0, value: { accepted: true } } as const;
    expect(
      (await request("/employee/state", "PUT", cookie, consent, "https://foreign.example")).status,
    ).toBe(403);
    expect((await request("/employee/state", "PUT", cookie, consent)).status).toBe(200);
    expect((await request("/employee/state", "PUT", secondCookie, consent)).status).toBe(200);
    const firstGrant = grants.get(cookie);
    expect(
      (
        await request(
          "/employee/journey",
          "GET",
          secondCookie,
          undefined,
          webOrigin,
          undefined,
          firstGrant,
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await request(
          "/employee/state",
          "PUT",
          secondCookie,
          blockedDeparture,
          webOrigin,
          undefined,
          firstGrant,
        )
      ).status,
    ).toBe(412);

    const firstJourney = await request("/employee/journey", "GET", cookie);
    expect(firstJourney.headers.get("cache-control")).toBe("private, no-store");
    expect(await firstJourney.json()).toMatchObject({ deadline: first.deadline, plan });
    expect(await (await request("/employee/journey", "GET", secondCookie)).json()).toMatchObject({
      plan: emptyEmployeePlan,
    });

    expect(await (await request("/employee/state/career", "GET", cookie)).json()).toMatchObject({
      key: "career",
      revision: 0,
      value: { base: { name: first.name }, versions: [], applications: [] },
    });

    const current = employeeStateSchema.parse(
      await (await request("/employee/state/departure-v1", "GET", cookie)).json(),
    );

    if (current.key !== "departure-v1") throw new Error("Unexpected journey state kind");

    const booking = {
      method: "pickup",
      day: "2027-01-25",
      slot: "morning",
      address: "Rua Brasileira, 123, São Paulo",
    } as const;

    expect(
      (
        await request("/employee/state", "PUT", cookie, {
          ...current,
          value: {
            ...current.value,
            booking: { method: "office", day: booking.day, slot: booking.slot },
          },
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await request("/employee/state", "PUT", cookie, {
          ...current,
          value: { ...current.value, examAttended: true },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request("/employee/state", "PUT", cookie, {
          ...current,
          value: { ...current.value, handoffCompleted: ["unknown"] },
        })
      ).status,
    ).toBe(422);

    const draft = { ...current, value: { ...current.value, booking } };
    const saved = await request("/employee/state", "PUT", cookie, draft);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ revision: 1, value: { booking } });
    expect((await request("/employee/state", "PUT", cookie, draft)).status).toBe(200);

    const different = {
      ...draft,
      value: { ...draft.value, booking: { ...booking, slot: "afternoon" as const } },
    };

    expect((await request("/employee/state", "PUT", cookie, different)).status).toBe(409);
    expect(
      await (await request("/employee/state/departure-v1", "GET", secondCookie)).json(),
    ).toMatchObject({ revision: 0, value: { booking: null } });

    const next = { ...draft, revision: 1, value: { ...draft.value, booking: null } };
    expect(await (await request("/employee/state", "PUT", cookie, next)).json()).toMatchObject({
      revision: 2,
      value: { booking: null },
    });
    expect((await request("/employee/state", "PUT", cookie, different)).status).toBe(409);

    await repos.employee.saveSettings(defaultOrgId, first.id, { email: null, plan, revision: 2 });
    expect((await request("/employee/session", "GET", cookie)).status).toBe(401);
    await repos.employee.saveSettings(defaultOrgId, first.id, { email, plan, revision: 3 });
    expect((await request("/employee/session", "GET", cookie)).status).toBe(401);
    expect((await request("/employee/session", "GET", secondCookie)).status).toBe(200);
  });

  it("lets HR provision a case and accepts only the supported native origins", async () => {
    const email = `native-${randomUUID()}@offboard.example`;
    const admin = `admin-${randomUUID()}@offboard.example`;

    const first = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Pessoa no app",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
      email,
    });

    const second = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Outro caso",
      role: "Analista",
      department: "TI",
      deadline: "2027-02-02",
      email: `other-${randomUUID()}@offboard.example`,
    });

    await repos.team.createTeamMember(defaultOrgId, { email: admin, name: "RH", role: "admin" });

    expect((await sendMemberCode(admin)).status).toBe(200);

    const hrCookie = sessionCookie(await signInMember(admin, deliveredCode(admin)));

    expect(hrCookie).toBeTruthy();
    expect((await request("/employee/session", "GET", hrCookie)).status).toBe(401);

    const target = `/employee-access/${first.id}`;

    const plan = {
      ...emptyEmployeePlan,
      exam: { day: "2027-01-26", time: "10:00", clinic: "Clínica", address: "Rua da Clínica" },
    };

    expect(await (await request(target, "GET", hrCookie)).json()).toEqual({
      email,
      personalEmail: null,
      plan: emptyEmployeePlan,
      revision: 1,
      careerSponsoredUntil: "2027-05-01",
      careerSponsoredIsDefault: true,
    });
    expect((await request(`/employee-access/${missingCaseId}`, "GET", hrCookie)).status).toBe(404);
    expect(
      (
        await request(`/employee-access/${missingCaseId}`, "PUT", hrCookie, {
          email,
          plan,
          revision: 0,
        })
      ).status,
    ).toBe(404);
    expect((await request(target, "PUT", hrCookie, { email, plan, revision: 1 })).status).toBe(200);
    expect(await (await request(target, "GET", hrCookie)).json()).toEqual({
      email,
      personalEmail: null,
      plan,
      revision: 2,
      careerSponsoredUntil: "2027-05-01",
      careerSponsoredIsDefault: true,
    });
    expect((await request(target, "PUT", hrCookie, { email, plan, revision: 1 })).status).toBe(409);
    const firstVersion = { email, plan, revision: 2 };
    expect((await request(target, "PUT", hrCookie, { ...firstVersion, email: null })).status).toBe(
      200,
    );
    const conflict = await request(target, "PUT", hrCookie, firstVersion);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "settings-changed" });
    expect(await (await request(target, "GET", hrCookie)).json()).toMatchObject({
      email: null,
      revision: 3,
    });
    expect((await request(target, "PUT", hrCookie, { ...firstVersion, revision: 3 })).status).toBe(
      200,
    );
    expect(
      (
        await request(`/employee-access/${second.id}`, "PUT", hrCookie, {
          email,
          plan,
          revision: 0,
        })
      ).status,
    ).toBe(409);

    const emailInUse = await request(`/employee-access/${second.id}`, "PUT", hrCookie, {
      email,
      plan,
      revision: 1,
    });

    expect(emailInUse.status).toBe(409);
    expect(await emailInUse.json()).toMatchObject({ code: "email-in-use" });

    await expect(
      repos.employee.saveSettings(defaultOrgId, "invalid-case-id", { email, plan, revision: 0 }),
    ).rejects.toThrow();

    const otpRequest = { email, type: "sign-in" } as const;

    const requestedFrom = (origin: string) =>
      request(
        "/auth/email-otp/send-verification-otp",
        "POST",
        undefined,
        otpRequest,
        webOrigin,
        origin,
      );

    expect((await requestedFrom("https://foreign.example")).status).toBe(403);
    expect(
      (
        await employeeAuth.handler(
          new Request(webOrigin + "/api/auth/email-otp/send-verification-otp", {
            method: "POST",
            body: JSON.stringify(otpRequest),
            headers: { "content-type": "application/json" },
          }),
        )
      ).status,
    ).toBe(403);
    expect((await requestedFrom("exp://127.0.0.1:8103/--/")).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No native code delivered");

    const response = await signIn(email, code, "offboard://");
    expect(response.status).toBe(200);

    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="))
      ?.split(";")[0];

    expect(cookie).toBeTruthy();
    await rememberGrant(cookie ?? "");
    expect(
      (
        await request(
          "/employee/state",
          "PUT",
          cookie,
          { key: "consent", revision: 0, value: { accepted: true } },
          webOrigin,
          "offboard:///",
        )
      ).status,
    ).toBe(200);

    const initial: EmployeeState = {
      key: "departure-v1",
      revision: 0,
      value: { handoffCompleted: [], examAttended: true, feedback: null, booking: null },
    };

    expect((await request("/employee/state", "PUT", cookie, initial)).status).toBe(200);
    expect(
      (await request("/employee/state", "PUT", cookie, { ...initial, revision: 1 })).status,
    ).toBe(200);

    expect((await request(target, "PUT", hrCookie, { email, plan, revision: 4 })).status).toBe(200);
    expect((await request("/employee/session", "GET", cookie)).status).toBe(200);

    await db.delete(employeeAccess).where(eq(employeeAccess.caseId, first.id));
    expect((await request("/employee/session", "GET", cookie)).status).toBe(401);
    expect(
      await repos.employee.saveSettings(defaultOrgId, first.id, { email, plan, revision: 1 }),
    ).toBe("changed");
    expect(
      await repos.employee.saveSettings(defaultOrgId, missingCaseId, { email, plan, revision: 1 }),
    ).toBe("missing-case");
  });

  it("returns email-in-use when updating employee access to a taken email", async () => {
    const emailA = `taken-a-${randomUUID()}@offboard.example`;
    const emailB = `taken-b-${randomUUID()}@offboard.example`;

    await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Taken A",
      role: "Dev",
      department: "Eng",
      deadline: "2027-01-01",
      email: emailA,
    });

    const caseB = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Taken B",
      role: "Dev",
      department: "Eng",
      deadline: "2027-01-01",
      email: emailB,
    });

    expect(
      await repos.employee.saveSettings(defaultOrgId, caseB.id, {
        email: emailA,
        plan: emptyEmployeePlan,
        revision: 1,
      }),
    ).toBe("email-in-use");
  });

  it("rejects a previously delivered code if the case is revoked before verification", async () => {
    const email = `revoked-new-${randomUUID()}@offboard.example`;

    const first = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Pessoa removida",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
      email,
    });

    await repos.employee.saveSettings(defaultOrgId, first.id, {
      email,
      plan: emptyEmployeePlan,
      revision: 0,
    });
    expect((await sendCode(email)).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No code delivered");

    await repos.employee.saveSettings(defaultOrgId, first.id, {
      email: null,
      plan: emptyEmployeePlan,
      revision: 1,
    });
    expect((await signIn(email, code)).headers.getSetCookie()).toHaveLength(0);

    await repos.employee.saveSettings(defaultOrgId, first.id, {
      email,
      plan: emptyEmployeePlan,
      revision: 2,
    });
    await authenticate(email);
    expect((await sendCode(email)).status).toBe(200);
    const subsequentCode = codes.get(email);

    if (!subsequentCode) throw new Error("No code delivered");

    await repos.employee.saveSettings(defaultOrgId, first.id, {
      email: null,
      plan: emptyEmployeePlan,
      revision: 3,
    });
    expect((await signIn(email, subsequentCode)).headers.getSetCookie()).toHaveLength(0);
  });

  it("binds a pending code to the grant that issued it", async () => {
    const email = "reassigned-" + randomUUID() + "@offboard.example";

    const person = {
      name: "Pessoa realocada",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
      email,
    };

    const first = await repos.offboardings.createOffboarding(defaultOrgId, person);

    const second = await repos.offboardings.createOffboarding(defaultOrgId, {
      ...person,
      email: `reassigned2-${randomUUID()}@offboard.example`,
    });

    const plan = emptyEmployeePlan;

    expect(
      await repos.employee.saveSettings(defaultOrgId, first.id, { email, plan, revision: 0 }),
    ).toBe("changed");
    expect((await sendCode(email)).status).toBe(200);
    const priorCode = codes.get(email);

    if (!priorCode) throw new Error("No code delivered");

    expect(
      await repos.employee.saveSettings(defaultOrgId, first.id, { email: null, plan, revision: 1 }),
    ).toBe("saved");
    expect(
      await repos.employee.saveSettings(defaultOrgId, second.id, { email, plan, revision: 1 }),
    ).toBe("email-set");
    expect((await signIn(email, priorCode)).status).toBe(400);

    await db
      .update(employeeAccess)
      .set({ email: email.toUpperCase() })
      .where(eq(employeeAccess.caseId, second.id));

    const cookie = await authenticate(email);
    expect(await (await request("/employee/session", "GET", cookie)).json()).toMatchObject({
      caseId: second.id,
    });
  });

  it("clears a session if the grant is revoked while Better Auth is creating it", async () => {
    const email = "revoked-at-issue-" + randomUUID() + "@offboard.example";

    const record = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Pessoa com acesso removido no login",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
      email,
    });

    expect((await sendCode(email)).status).toBe(200);
    const code = codes.get(email);

    if (!code) throw new Error("No code delivered");

    await db.execute(sql`
      CREATE FUNCTION offboard_test_revoke_grant() RETURNS trigger AS $$
      BEGIN
        UPDATE employee_access SET email = NULL, grant_id = gen_random_uuid(), revision = revision + 1
        WHERE case_id = NEW.employee_case_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    try {
      await db.execute(sql`
        CREATE TRIGGER offboard_test_revoke_grant AFTER INSERT ON auth_session
        FOR EACH ROW WHEN (NEW.employee_case_id IS NOT NULL)
        EXECUTE FUNCTION offboard_test_revoke_grant()
      `);
      const result = await signIn(email, code);
      expect(result.status).toBe(400);
      expect(result.headers.getSetCookie()).toEqual([]);
      expect(
        await db.select().from(authSession).where(eq(authSession.employeeCaseId, record.id)),
      ).toEqual([]);
    } finally {
      await db.execute(sql`DROP FUNCTION offboard_test_revoke_grant() CASCADE`);
    }
  });

  it("rechecks the grant inside the transaction for reads and writes already authorized by the guard", async () => {
    const email = "revocation-" + randomUUID() + "@offboard.example";

    const record = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Pessoa com acesso removido",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
      email,
    });

    const plan = emptyEmployeePlan;

    const cookie = await authenticate(email);
    const consent: EmployeeState = { key: "consent", revision: 0, value: { accepted: true } };
    expect((await request("/employee/state", "PUT", cookie, consent)).status).toBe(200);

    const atGuard: (() => void)[] = [];
    const resumeGuard = new Set<() => void>();

    const started = Array.from(
      { length: 3 },
      () => new Promise<void>((resolve) => atGuard.push(resolve)),
    );

    const delayedApp = createApp(webOrigin, repos, {
      sendEmail,
      auth: {
        ...employeeAuth,
        async resolveEmployee(headers) {
          const principal = await employeeAuth.resolveEmployee(headers);

          await new Promise<void>((resume) => {
            resumeGuard.add(resume);
            atGuard.shift()?.();
          });

          return principal;
        },
      },
    });

    const boundHeaders = {
      cookie,
      origin: webOrigin,
      "content-type": "application/json",
      [employeeGrantHeader]: grants.get(cookie) ?? "",
    };

    const pending = [
      delayedApp.handle(
        new Request(webOrigin + "/api/employee/journey", { headers: boundHeaders }),
      ),
      delayedApp.handle(
        new Request(webOrigin + "/api/employee/state/consent", { headers: boundHeaders }),
      ),
      delayedApp.handle(
        new Request(webOrigin + "/api/employee/state", {
          method: "PUT",
          headers: boundHeaders,
          body: JSON.stringify({ ...consent, revision: 1, value: { accepted: false } }),
        }),
      ),
    ];

    try {
      await Promise.all(started);
      expect(
        await repos.employee.saveSettings(defaultOrgId, record.id, {
          email: null,
          plan,
          revision: 1,
        }),
      ).toBe("saved");
    } finally {
      resumeGuard.forEach((resume) => resume());
    }

    expect((await Promise.all(pending)).map((response) => response.status)).toEqual([
      401, 401, 401,
    ]);
    await repos.employee.saveSettings(defaultOrgId, record.id, { email, plan, revision: 2 });
    const freshCookie = await authenticate(email);
    expect(await (await request("/employee/state/consent", "GET", freshCookie)).json()).toEqual({
      key: "consent",
      revision: 1,
      value: { accepted: true },
    });
  });

  function memberRequest(
    path: string,
    body: { email: string; type: "sign-in" } | { email: string; otp: string },
    { audience = "member", native = false }: { audience?: string; native?: boolean } = {},
  ) {
    requests += 1;

    const headers = new Headers({
      "x-test-employee-ip": `198.51.100.${requests % 250}`,
      "content-type": "application/json",
      [codeAudienceHeader]: audience,
    });

    if (native) headers.set("expo-origin", "offboard://");
    else headers.set("origin", webOrigin);

    return app.handle(
      new Request(`${webOrigin}/api/auth${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  }

  function sendMemberCode(email: string, options?: { audience?: string; native?: boolean }) {
    return memberRequest("/email-otp/send-verification-otp", { email, type: "sign-in" }, options);
  }

  function signInMember(
    email: string,
    otp: string,
    options?: { audience?: string; native?: boolean },
  ) {
    return memberRequest("/sign-in/email-otp", { email, otp }, options);
  }

  function sessionCookie(response: Response) {
    return (
      response.headers
        .getSetCookie()
        .find((value) => value.includes("session_token="))
        ?.split(";")[0] ?? ""
    );
  }

  function deliveredCode(email: string) {
    const code = codes.get(email);

    if (!code) throw new Error("No code delivered");

    codes.delete(email);

    return code;
  }

  describe("HR sign-in with a code", () => {
    it("signs a team member into the portal and never into the employee journey", async () => {
      const email = `member-${randomUUID()}@offboard.example`;

      const member = await repos.team.createTeamMember(defaultOrgId, {
        email: email.toUpperCase(),
        name: "Pessoa do RH",
        role: "rh",
      });

      expect((await sendMemberCode(email)).status).toBe(200);

      const response = await signInMember(email, deliveredCode(email));
      expect(response.status).toBe(200);

      const cookie = sessionCookie(response);
      expect(cookie).not.toBe("");

      const session = await request("/session", "GET", cookie);
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ id: member.id, email, orgName: "Default" });
      expect((await request("/employee/session", "GET", cookie)).status).toBe(401);

      await repos.team.deleteTeamMember(defaultOrgId, member.id);
      expect((await request("/session", "GET", cookie)).status).toBe(403);
    });

    it("keeps HR and collaborator signed in side by side in one browser", async () => {
      const hrEmail = `side-hr-${randomUUID()}@offboard.example`;
      const employeeEmail = `side-employee-${randomUUID()}@offboard.example`;

      await repos.team.createTeamMember(defaultOrgId, {
        email: hrEmail,
        name: "RH lado a lado",
        role: "rh",
      });

      await repos.offboardings.createOffboarding(defaultOrgId, {
        name: "Colaborador lado a lado",
        role: "Analista",
        department: "RH",
        deadline: "2027-02-01",
        email: employeeEmail,
      });

      expect((await sendMemberCode(hrEmail)).status).toBe(200);

      const hr = sessionCookie(await signInMember(hrEmail, deliveredCode(hrEmail)));
      const employee = await authenticate(employeeEmail);
      const grantId = grants.get(employee);
      const browser = `${hr}; ${employee}`;

      expect(hr.split("=")[0]).not.toBe(employee.split("=")[0]);

      const signedIn = (cookie: string) =>
        Promise.all([
          request("/session", "GET", cookie).then((response) => response.status),
          request(
            "/employee/session",
            "GET",
            cookie,
            undefined,
            webOrigin,
            undefined,
            grantId,
          ).then((response) => response.status),
        ]);

      const signOut = (cookie: string, audience?: string) => {
        const headers = new Headers({ origin: webOrigin, cookie });

        if (audience) headers.set(codeAudienceHeader, audience);

        return app.handle(
          new Request(`${webOrigin}/api/auth/sign-out`, { method: "POST", headers }),
        );
      };

      expect(await signedIn(browser)).toEqual([200, 200]);
      expect((await signOut(browser)).status).toBe(200);
      expect(await signedIn(browser)).toEqual([200, 401]);
      expect((await signOut(hr, "employee")).status).toBe(200);
      expect(await signedIn(hr)).toEqual([200, 401]);

      const again = await authenticate(employeeEmail);
      const second = `${hr}; ${again}`;

      expect((await signOut(second, "member")).status).toBe(200);
      expect((await request("/session", "GET", second)).status).toBe(401);
      expect(
        (
          await request(
            "/employee/session",
            "GET",
            second,
            undefined,
            webOrigin,
            undefined,
            grants.get(again),
          )
        ).status,
      ).toBe(200);
    });

    it("sends nothing to unknown emails and rejects any code for them", async () => {
      const email = `nobody-${randomUUID()}@offboard.example`;

      expect((await sendMemberCode(email)).status).toBe(200);
      expect(codes.has(email)).toBe(false);
      expect((await signInMember(email, "123456")).status).toBe(400);
    });

    it("keeps employee and member codes apart for an email that has both accesses", async () => {
      const email = `both-${randomUUID()}@offboard.example`;

      const record = await repos.offboardings.createOffboarding(defaultOrgId, {
        name: "Pessoa com dois acessos",
        role: "Analista",
        department: "RH",
        deadline: "2027-02-01",
        email,
      });

      await repos.team.createTeamMember(defaultOrgId, { email, name: "RH", role: "admin" });
      await repos.employee.saveSettings(defaultOrgId, record.id, {
        email,
        plan: emptyEmployeePlan,
        revision: 0,
      });

      expect((await sendMemberCode(email, { audience: "employee" })).status).toBe(200);
      const employeeCode = deliveredCode(email);
      const asMember = await signInMember(email, employeeCode);
      expect(asMember.status).toBe(400);
      expect(sessionCookie(asMember)).toBe("");

      expect((await sendMemberCode(email)).status).toBe(200);
      const memberCode = deliveredCode(email);
      const asEmployee = await signInMember(email, memberCode, { audience: "employee" });
      expect(asEmployee.status).toBe(400);
      expect(sessionCookie(asEmployee)).toBe("");

      expect((await sendMemberCode(email)).status).toBe(200);
      const response = await signInMember(email, deliveredCode(email));
      expect(response.status).toBe(200);
      expect((await request("/session", "GET", sessionCookie(response))).status).toBe(200);
    });

    it("rejects a delivered code once the member is removed", async () => {
      const email = `removed-${randomUUID()}@offboard.example`;

      const member = await repos.team.createTeamMember(defaultOrgId, {
        email,
        name: "Pessoa removida",
        role: "rh",
      });

      expect((await sendMemberCode(email)).status).toBe(200);
      const code = deliveredCode(email);

      await repos.team.deleteTeamMember(defaultOrgId, member.id);

      expect((await signInMember(email, code)).status).toBe(400);
    });

    it("caps code requests per email across audiences until the window passes", async () => {
      const email = `capped-${randomUUID()}@offboard.example`;
      const other = `uncapped-${randomUUID()}@offboard.example`;

      await repos.team.createTeamMember(defaultOrgId, { email, name: "RH", role: "rh" });
      await repos.team.createTeamMember(defaultOrgId, { email: other, name: "RH", role: "rh" });

      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect((await sendMemberCode(email.toUpperCase())).status).toBe(200);
      }

      expect((await sendMemberCode(email, { audience: "employee" })).status).toBe(200);
      codes.delete(email);

      const capped = await sendMemberCode(email);
      expect(capped.status).toBe(429);
      expect(capped.headers.get("cache-control")).toBe("no-store");
      expect(codes.has(email)).toBe(false);

      expect((await sendMemberCode(other)).status).toBe(200);
      expect(codes.has(other)).toBe(true);

      await db
        .update(authRateLimit)
        .set({ lastRequest: Date.now() - 15 * 60 * 1000 })
        .where(sql`${authRateLimit.key} like 'offboard:code-email:%'`);

      expect((await sendMemberCode(email)).status).toBe(200);
      expect(codes.has(email)).toBe(true);
    });

    it("leaves malformed code requests to Better Auth validation", async () => {
      requests += 1;

      const response = await app.handle(
        new Request(`${webOrigin}/api/auth/email-otp/send-verification-otp`, {
          method: "POST",
          headers: {
            origin: webOrigin,
            "content-type": "application/json",
            "x-test-employee-ip": `203.0.113.${requests % 250}`,
          },
          body: "not json",
        }),
      );

      expect(response.status).toBe(400);
    });

    it("refuses member codes from the native app", async () => {
      const email = `native-${randomUUID()}@offboard.example`;

      await repos.team.createTeamMember(defaultOrgId, { email, name: "RH", role: "rh" });

      expect((await sendMemberCode(email, { native: true })).status).toBe(403);
      expect(codes.has(email)).toBe(false);
      expect((await signInMember(email, "123456", { native: true })).status).toBe(403);
    });
  });

  it("sends code mail through the configured provider and never trusts Expo Go origins in production", async () => {
    const email = `runtime-${randomUUID()}@offboard.example`;

    const record = await repos.offboardings.createOffboarding(defaultOrgId, {
      name: "Pessoa na produção",
      role: "Analista",
      department: "Produto",
      deadline: "2027-02-01",
      email,
    });

    await repos.employee.saveSettings(defaultOrgId, record.id, {
      email,
      plan: emptyEmployeePlan,
      revision: 0,
    });
    const delivered: string[] = [];

    const { auth: production } = createRuntimeAuth(db, repos.talent, undefined, {
      env: {
        BETTER_AUTH_URL: "https://offboard.example",
        BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
        EMAIL_PROVIDER: "cloudflare",
        AUTH_EMAIL_FROM: "login@offboard.example",
      },
      cloudflareEmail: {
        async send(message) {
          expect(message.to).toBe(email);
          expect(message.subject).toBe("Seu código de acesso ao Offboard");
          delivered.push(message.text);

          return { messageId: "test-email" };
        },
      },
    });

    function send(origin: Record<string, string>) {
      return production.handler(
        new Request("https://offboard.example/api/auth/email-otp/send-verification-otp", {
          method: "POST",
          headers: { ...origin, "content-type": "application/json" },
          body: JSON.stringify({ email, type: "sign-in" }),
        }),
      );
    }

    expect((await send({ "expo-origin": "exp://localhost:8103/--/" })).status).toBe(403);
    expect((await send({ "expo-origin": "offboard:///" })).status).toBe(200);
    expect(delivered[0]).toMatch(/\b\d{6}\b/);
  });

  describe("collaborator career routes", () => {
    const orgIds: string[] = [];

    afterAll(async () => {
      for (const orgId of orgIds) {
        await db.delete(subscriptions).where(eq(subscriptions.orgId, orgId));
        await db.delete(talentProfiles).where(eq(talentProfiles.orgId, orgId));
        await db.delete(offboardingCases).where(eq(offboardingCases.orgId, orgId));
        await db.delete(organizations).where(eq(organizations.id, orgId));
      }
    });

    async function organization() {
      const orgId = randomUUID();
      await db.insert(organizations).values({ id: orgId, slug: orgId, name: "Org " + orgId });
      orgIds.push(orgId);

      return orgId;
    }

    async function collaboratorCase(
      orgId: string,
      email = `career-${randomUUID()}@offboard.example`,
    ) {
      const record = await repos.offboardings.createOffboarding(orgId, {
        name: "Pessoa da carreira",
        role: "Analista",
        department: "Produto",
        deadline: "2027-02-01",
        email,
      });

      return { caseId: record.id, email };
    }

    function profilesOf(caseId: string) {
      return db.select().from(talentProfiles).where(eq(talentProfiles.caseId, caseId));
    }

    it("lets a collaborator use the career routes with their session", async () => {
      const orgId = await organization();
      const { caseId, email } = await collaboratorCase(orgId);
      const cookie = await authenticate(email);

      const foreign = await request(
        "/me/consent",
        "PUT",
        cookie,
        { shareOutcomeWithHr: true },
        "https://foreign.example",
      );

      expect(foreign.status).toBe(403);
      expect(await profilesOf(caseId)).toEqual([]);

      const before = new Date();
      const me = await request("/me", "GET", cookie);
      const after = new Date();
      expect(me.status).toBe(200);
      expect(me.headers.get("cache-control")).toBe("no-store");
      expect(await me.json()).toMatchObject({
        name: "Pessoa da carreira",
        email,
        termsAccepted: true,
        entitlement: { kind: "sponsored", until: null },
      });

      const [row] = await profilesOf(caseId);
      expect(row).toMatchObject({
        orgId,
        caseId,
        personalEmail: email,
        name: "Pessoa da carreira",
        sponsoredUntil: saoPauloDate(before),
      });

      for (const at of [row.termsAcceptedAt, row.firstSignedInAt]) {
        expect(at?.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(at?.getTime()).toBeLessThanOrEqual(after.getTime());
      }

      const jobs = await request("/me/jobs", "GET", cookie);
      expect(jobs.status).toBe(200);
      expect(await jobs.json()).toMatchObject({ page: 1 });

      const listed = await request("/me/applications", "GET", cookie);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual([]);

      const consent = await request("/me/consent", "PUT", cookie, { shareOutcomeWithHr: true });
      expect(consent.status).toBe(200);
      expect(await consent.json()).toMatchObject({ id: row.id, shareOutcomeWithHr: true });
      expect(await profilesOf(caseId)).toHaveLength(1);

      expect((await request("/offboardings", "GET", cookie)).status).toBe(401);
    });

    describe("benefit on the first bridge", () => {
      async function policyFor(orgId: string, department: string) {
        const rows = await db.select().from(plans).orderBy(asc(plans.monthlyPriceCents));

        const low = rows[0].id;
        const high = rows[rows.length - 1].id;

        await repos.benefits.savePolicy(orgId, {
          defaultPlanId: low,
          benefitDurationMonths: 3,
          rules: [
            { id: "r", field: "department", operator: "equals", value: department, planId: high },
          ],
        });

        return { low, high };
      }

      function benefitOf(caseId: string) {
        return db
          .select({
            orgId: benefitAssignments.orgId,
            source: benefitAssignments.source,
            planId: benefitAssignments.effectivePlanId,
            validUntil: benefitAssignments.validUntil,
          })
          .from(benefitAssignments)
          .innerJoin(talentProfiles, eq(talentProfiles.id, benefitAssignments.profileId))
          .where(eq(talentProfiles.caseId, caseId));
      }

      afterEach(async () => {
        await db.delete(benefitAssignments);
        await db.delete(benefitPolicies);
      });

      it("gives the rule plan before the first career request is answered", async () => {
        const orgId = await organization();
        const { high } = await policyFor(orgId, "Produto");
        const { caseId, email } = await collaboratorCase(orgId);
        const cookie = await authenticate(email);

        expect(await benefitOf(caseId)).toEqual([]);

        const me = await request("/me", "GET", cookie);

        expect(me.status).toBe(200);
        expect(await benefitOf(caseId)).toEqual([
          {
            orgId,
            source: "rule",
            planId: high,
            validUntil: addMonths(saoPauloDate(new Date()), 3),
          },
        ]);
      });

      it("gives the default plan and keeps valid_until on later requests", async () => {
        const orgId = await organization();
        const { low } = await policyFor(orgId, "Vendas");
        const { caseId, email } = await collaboratorCase(orgId);
        const cookie = await authenticate(email);

        await request("/me", "GET", cookie);

        expect(await benefitOf(caseId)).toMatchObject([{ source: "default", planId: low }]);

        await db
          .update(benefitAssignments)
          .set({ validUntil: "2099-01-01" })
          .where(eq(benefitAssignments.orgId, orgId));
        await request("/me", "GET", cookie);

        expect(await benefitOf(caseId)).toMatchObject([{ validUntil: "2099-01-01" }]);
      });

      it("does not renew an expired automatic assignment on later requests", async () => {
        const orgId = await organization();
        const { high } = await policyFor(orgId, "Produto");
        const { caseId, email } = await collaboratorCase(orgId);
        const cookie = await authenticate(email);

        await request("/me", "GET", cookie);
        await db
          .update(benefitAssignments)
          .set({ validUntil: "2026-01-01" })
          .where(eq(benefitAssignments.orgId, orgId));
        await repos.benefits.savePolicy(orgId, {
          defaultPlanId: null,
          benefitDurationMonths: 12,
          rules: [],
        });
        await request("/me", "GET", cookie);

        expect(await benefitOf(caseId)).toMatchObject([
          { source: "rule", planId: high, validUntil: "2026-01-01" },
        ]);
      });

      it("assigns nothing without a policy or with only another organization's", async () => {
        const orgId = await organization();
        const otherOrg = await organization();

        await policyFor(otherOrg, "Produto");

        const { caseId, email } = await collaboratorCase(orgId);
        const cookie = await authenticate(email);

        expect((await request("/me", "GET", cookie)).status).toBe(200);
        expect(await benefitOf(caseId)).toEqual([]);
      });

      it("serves the collaborator even when the benefit cannot be assigned", async () => {
        const orgId = await organization();

        await policyFor(orgId, "Produto");

        const { caseId, email } = await collaboratorCase(orgId);
        const cookie = await authenticate(email);

        const failing = createApp(
          webOrigin,
          {
            ...repos,
            benefits: {
              ...repos.benefits,
              pendingPerson: () => Promise.reject(new Error("db down")),
            },
          },
          { auth: employeeAuth, sendEmail },
        );

        const response = await failing.handle(
          new Request(`${webOrigin}/api/me`, {
            headers: { cookie, origin: webOrigin, [employeeGrantHeader]: grants.get(cookie) ?? "" },
          }),
        );

        expect(response.status).toBe(200);
        expect(await benefitOf(caseId)).toEqual([]);
      });
    });

    it("creates the profile once", async () => {
      const orgId = await organization();
      const { caseId, email } = await collaboratorCase(orgId);
      const cookie = await authenticate(email);

      const responses = await Promise.all(
        Array.from({ length: 6 }, () => request("/me", "GET", cookie)),
      );

      expect(responses.map((response) => response.status)).toEqual(Array(6).fill(200));

      const ids = new Set(
        await Promise.all(
          responses.map(
            async (response) => z.object({ id: z.uuid() }).parse(await response.json()).id,
          ),
        ),
      );

      expect(ids.size).toBe(1);
      expect(await profilesOf(caseId)).toHaveLength(1);
    });

    it("isolates collaborators by case", async () => {
      const firstOrg = await organization();
      const secondOrg = await organization();
      const first = await collaboratorCase(firstOrg);
      const second = await collaboratorCase(secondOrg);
      const firstCookie = await authenticate(first.email);
      const secondCookie = await authenticate(second.email);

      const shared = await request("/me/consent", "PUT", firstCookie, { shareOutcomeWithHr: true });
      expect(shared.status).toBe(200);

      const other = await request("/me", "GET", secondCookie);
      expect(other.status).toBe(200);
      const otherMe = await other.json();
      expect(otherMe).toMatchObject({ email: second.email, shareOutcomeWithHr: false });
      expect(otherMe.id).not.toBe((await shared.json()).id);

      const [firstRow] = await profilesOf(first.caseId);
      const [secondRow] = await profilesOf(second.caseId);
      expect(firstRow).toMatchObject({ orgId: firstOrg, shareOutcomeWithHr: true });
      expect(secondRow).toMatchObject({ orgId: secondOrg, id: otherMe.id });
    });

    it("keeps a collaborator active and accepted on a lapsed profile HR enabled", async () => {
      const orgId = await organization();
      const { caseId, email } = await collaboratorCase(orgId);

      const enabled = z.object({ id: z.uuid() }).parse(
        await repos.talent.enable({
          orgId,
          caseId,
          personalEmail: `hr-${randomUUID()}@offboard.example`,
          sponsoredUntil: "2020-01-01",
        }),
      );

      const cookie = await authenticate(email);
      expect((await request("/me/jobs", "GET", cookie)).status).toBe(200);
      expect((await request("/me/applications", "GET", cookie)).status).toBe(200);
      expect(await (await request("/me", "GET", cookie)).json()).toMatchObject({
        id: enabled.id,
        email,
        termsAccepted: true,
        entitlement: { kind: "sponsored", until: null },
      });

      const rows = await profilesOf(caseId);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ personalEmail: email, sponsoredUntil: "2020-01-01" });
      expect(rows[0].firstSignedInAt).not.toBeNull();
    });

    it("forbids a collaborator whose email another case's profile holds", async () => {
      const orgId = await organization();
      const holder = await collaboratorCase(orgId);
      const { caseId, email } = await collaboratorCase(orgId);

      expect(
        await repos.talent.enable({
          orgId,
          caseId: holder.caseId,
          personalEmail: email.toUpperCase(),
          sponsoredUntil: "2099-01-01",
        }),
      ).toMatchObject({ caseId: holder.caseId });

      const cookie = await authenticate(email);
      const response = await request("/me", "GET", cookie);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Email already in use" });
      expect(await profilesOf(caseId)).toEqual([]);
    });

    async function rotate(orgId: string, caseId: string) {
      const email = `rotated-${randomUUID()}@offboard.example`;

      expect(
        await repos.employee.saveSettings(orgId, caseId, {
          email,
          plan: emptyEmployeePlan,
          revision: 1,
        }),
      ).toBe("email-set");

      return email;
    }

    it("ties the profile to the current grant when HR rotates it", async () => {
      const orgId = await organization();
      const { caseId, email: previous } = await collaboratorCase(orgId);
      const previousCookie = await authenticate(previous);
      const before = await request("/me", "GET", previousCookie);

      expect(before.status).toBe(200);

      const { id } = z.object({ id: z.uuid() }).parse(await before.json());
      const current = await rotate(orgId, caseId);

      expect((await request("/me", "GET", previousCookie)).status).toBe(401);
      expect(await profilesOf(caseId)).toMatchObject([{ id, personalEmail: previous }]);

      const link = await request("/auth/sign-in/magic-link", "POST", undefined, {
        email: previous,
        callbackURL: "/app",
      });

      expect(link.status).toBe(200);
      expect(links.has(previous)).toBe(false);

      const cookie = await authenticate(current);
      const me = await request("/me", "GET", cookie);

      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({ id, email: current });
      expect(await profilesOf(caseId)).toMatchObject([{ id, personalEmail: current }]);
    });

    it("rejects a session whose grant moved on without creating a profile", async () => {
      const orgId = await organization();
      const { caseId, email } = await collaboratorCase(orgId);
      const cookie = await authenticate(email);

      await db
        .update(employeeAccess)
        .set({ email: `moved-${randomUUID()}@offboard.example` })
        .where(eq(employeeAccess.caseId, caseId));

      const response = await request("/me", "GET", cookie);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
      expect(await profilesOf(caseId)).toEqual([]);
    });

    it("refuses a talent session once the case gets a collaborator grant", async () => {
      const orgId = await organization();
      const email = `talent-${randomUUID()}@offboard.example`;

      const [record] = await db
        .insert(offboardingCases)
        .values({
          orgId,
          name: "Pessoa da carreira",
          role: "Analista",
          department: "Produto",
          deadline: "2027-02-01",
        })
        .returning({ id: offboardingCases.id });

      expect(
        await repos.talent.enable({
          orgId,
          caseId: record.id,
          personalEmail: email,
          sponsoredUntil: "2099-01-01",
        }),
      ).toMatchObject({ caseId: record.id });

      const sent = await request("/auth/sign-in/magic-link", "POST", undefined, {
        email,
        callbackURL: "/app",
      });

      expect(sent.status).toBe(200);
      const link = links.get(email);

      if (!link) throw new Error("No talent link delivered");

      const cookie = (await app.handle(new Request(link))).headers
        .getSetCookie()
        .find((value) => value.includes("session_token="))
        ?.split(";")[0];

      expect((await request("/me", "GET", cookie)).status).toBe(200);

      await db.insert(employeeAccess).values({
        caseId: record.id,
        orgId,
        email: `grant-${randomUUID()}@offboard.example`,
        plan: emptyEmployeePlan,
      });

      const refused = await request("/me", "GET", cookie);

      expect(refused.status).toBe(401);
      expect(await refused.json()).toEqual({ error: "Unauthorized" });

      await db
        .update(employeeAccess)
        .set({ email: null })
        .where(eq(employeeAccess.caseId, record.id));

      expect((await request("/me", "GET", cookie)).status).toBe(200);
    });

    it("offers AI Apply to a collaborator whose company is on the top plan", async () => {
      const orgId = await organization();
      const { email } = await collaboratorCase(orgId);
      const cookie = await authenticate(email);
      const grantId = grants.get(cookie) ?? "";

      const [top] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.slug, "platinum-premium"));

      const [gold] = await db.select({ id: plans.id }).from(plans).where(eq(plans.slug, "gold"));

      const [subscription] = await db
        .insert(subscriptions)
        .values({
          orgId,
          planId: top.id,
          currentPeriodStart: "2026-11-01",
          currentPeriodEnd: "2026-12-01",
        })
        .returning({ id: subscriptions.id });

      const composed = createApp(webOrigin, repos, {
        auth: employeeAuth,
        sendEmail,
        browserbase: { apiKey: "bb-key", projectId: "bb-project" },
        generateStructured: async ({ schema }) => schema.parse({ answers: [] }),
      });

      const send = (path: string, method: string, body?: { accept: boolean }) =>
        composed.handle(
          new Request(webOrigin + "/api" + path, {
            method,
            headers: {
              cookie,
              origin: webOrigin,
              [employeeGrantHeader]: grantId,
              "content-type": "application/json",
            },
            body: body && JSON.stringify(body),
          }),
        );

      expect((await send("/me/ai-apply/consent", "PUT", { accept: true })).status).toBe(200);

      const prepare = () => send(`/me/jobs/${randomUUID()}/ai-apply`, "POST");

      const allowed = await prepare();

      expect(allowed.status).toBe(404);
      expect(await allowed.json()).toEqual({ error: "Job not found" });

      await db
        .update(subscriptions)
        .set({ planId: gold.id })
        .where(eq(subscriptions.id, subscription.id));

      const refused = await prepare();

      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "AI Apply not available" });
    });

    it("serves the collaborator's career even with an HR session in the same browser", async () => {
      const orgId = await organization();
      const { caseId, email } = await collaboratorCase(orgId);
      const cookie = await authenticate(email);

      const composed = createApp(webOrigin, repos, {
        ...appOptions,
        auth: { ...auth, resolveEmployee: employeeAuth.resolveEmployee },
      });

      const me = (session: string | undefined) =>
        composed.handle(
          new Request(webOrigin + "/api/me", {
            headers: {
              ...(session && { cookie: session }),
              "x-test-session": "admin",
              "x-test-org-id": orgId,
            },
          }),
        );

      expect((await me(undefined)).status).toBe(403);
      expect(await profilesOf(caseId)).toEqual([]);
      expect((await me(cookie)).status).toBe(200);
      expect(await profilesOf(caseId)).toHaveLength(1);
    });
  });

  describe("signup", () => {
    type Signup = { orgName?: string; slug?: string; adminName?: string; adminEmail?: string };

    function signup(body: Signup) {
      return app.handle(
        new Request("http://localhost/api/signup", {
          method: "POST",
          headers: { "content-type": "application/json", origin: webOrigin },
          body: JSON.stringify(body),
        }),
      );
    }

    it("creates an organization without authentication", async () => {
      const slug = `acme-${randomUUID()}`;

      const response = await signup({
        orgName: "Acme",
        slug,
        adminName: "Ada",
        adminEmail: `${randomUUID()}@example.com`,
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ orgId: expect.any(String), slug });
    });

    it("rejects a duplicate slug and an existing email", async () => {
      const slug = `acme-${randomUUID()}`;
      const adminEmail = `${randomUUID()}@example.com`;
      await signup({ orgName: "Acme", slug, adminName: "Ada", adminEmail });

      const slugTaken = await signup({
        orgName: "Acme",
        slug,
        adminName: "Bob",
        adminEmail: `${randomUUID()}@example.com`,
      });

      const emailTaken = await signup({
        orgName: "Acme",
        slug: `acme-${randomUUID()}`,
        adminName: "Bob",
        adminEmail,
      });

      expect(slugTaken.status).toBe(409);
      expect(await slugTaken.json()).toEqual({ error: "Slug already in use", code: "slug-taken" });
      expect(emailTaken.status).toBe(409);
      expect(await emailTaken.json()).toEqual({
        error: "Email already in use",
        code: "email-in-use",
      });
    });

    it("rejects a reserved slug", async () => {
      const response = await signup({
        orgName: "Acme",
        slug: "admin",
        adminName: "Ada",
        adminEmail: `${randomUUID()}@example.com`,
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Slug already in use", code: "slug-taken" });
    });

    it("rejects an invalid slug and missing fields", async () => {
      const invalid = await signup({
        orgName: "Acme",
        slug: "Not A Slug",
        adminName: "Ada",
        adminEmail: "ada@example.com",
      });

      const missing = await signup({ orgName: "Acme" });

      expect(invalid.status).toBe(422);
      expect(missing.status).toBe(422);
    });
  });
});
