import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  actionConfigs,
  authRateLimit,
  authUser,
  benefitAssignments,
  integrations,
  offboardingCases,
  organizations,
  subscriptions,
  talentProfiles,
  teamMembers,
} from "@offboard/db/schema";
import { seedCatalog } from "@offboard/db/seed-database";
import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createRuntimeAuth } from "../features/auth/auth.js";
import { latestCode, readOutbox } from "../shared/dev-outbox.js";
import { createRepositories } from "../repositories.js";
import type { Context } from "./context.js";
import { createHttp } from "./http.js";
import { startReceiver } from "./receiver.js";
import { runScenario } from "./run.js";
import { orgs, people } from "./scenarios.js";
import { ensureOrg, signIn } from "./steps.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const webOrigin = "http://localhost:5173";
const webhookSecret = "scenario-test-webhook-secret-0001";

describe.skipIf(!url)("scenario runner against the in-process API", () => {
  const db = createClient(url ?? "");
  const repos = createRepositories(db);
  const outbox = join(mkdtempSync(join(tmpdir(), "offboard-scenario-")), "mail.jsonl");

  const { auth, sender } = createRuntimeAuth(db, repos.talent, undefined, {
    env: {
      BETTER_AUTH_URL: webOrigin,
      BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
      EMAIL_PROVIDER: "console",
      NODE_ENV: "test",
      DEV_EMAIL_OUTBOX: outbox,
    },
  });

  let checkouts = 0;

  const app = createApp(webOrigin, repos, {
    auth,
    sendEmail: (message) => sender.send(message),
    secretKey: "scenario-secret-key-for-tests-0001",
    abacatepayWebhookSecret: webhookSecret,
    abacatepay: {
      configured: true,
      createSubscriptionCheckout: async () => {
        checkouts += 1;

        return { id: `bill_${checkouts}`, url: "https://checkout.example.com/x" };
      },
      refundCheckout: () => Promise.resolve(),
      productExternalId: () => Promise.resolve("prod_x"),
      cancelSubscription: async () => undefined,
    },
    catalog: [],
    runInBackground: () => undefined,
  });

  function context(env: Record<string, string | undefined> = {}) {
    const lines: string[] = [];

    const ctx = {
      http: createHttp((request) => app.handle(request), webOrigin, webOrigin),
      env,
      webOrigin,
      async readCode(email) {
        const code = latestCode(readOutbox(outbox), email);

        if (!code) throw new Error("No code delivered");

        return code;
      },
      seedCatalog: () => seedCatalog(db),
      startReceiver,
      newId: randomUUID,
      today: () => new Date().toISOString().slice(0, 10),
      log: (line) => lines.push(line),
      sessions: new Map(),
      logins: [],
    } satisfies Context;

    return { ctx, lines };
  }

  beforeAll(() =>
    migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url)),
    }),
  );

  beforeEach(async () => {
    await db.delete(authRateLimit);
  });

  afterAll(async () => {
    const found = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        inArray(
          organizations.slug,
          orgs.map((entry) => entry.org.slug),
        ),
      );

    const ids = found.map((row) => row.id);

    await db.delete(authUser).where(
      inArray(
        authUser.email,
        Object.values(people).map((person) => person.email),
      ),
    );

    if (ids.length > 0) {
      await db.delete(actionConfigs).where(inArray(actionConfigs.orgId, ids));
      await db.delete(integrations).where(inArray(integrations.orgId, ids));
      await db.delete(subscriptions).where(inArray(subscriptions.orgId, ids));
      await db.delete(talentProfiles).where(inArray(talentProfiles.orgId, ids));
      await db.delete(offboardingCases).where(inArray(offboardingCases.orgId, ids));
      await db.delete(teamMembers).where(inArray(teamMembers.orgId, ids));
      await db.delete(organizations).where(inArray(organizations.id, ids));
    }

    await db.$client.end();
  });

  it("adds people twice through the API, signing in with console codes and applying the policy", async () => {
    const first = context();
    await runScenario("add-person", first.ctx);

    expect(first.lines).toContain("created org Aurora Cosméticos");
    expect(first.lines).toContain("Marina Lopes got benefit Silver (source default)");
    expect(first.lines).toContain("Rafael Mendes got benefit Gold (source rule)");

    const second = context();
    await runScenario("add-person", second.ctx);

    expect(second.lines).toContain("org Aurora Cosméticos already exists");
    expect(second.lines).toContain(
      "found Marina Lopes (Marketing), access for marina.colaboradora@aurora.example.com",
    );
    expect(await db.select().from(benefitAssignments)).toHaveLength(2);
    expect(second.lines).toContain("log in to see the result:");
  });

  it("runs every scenario twice and leaves the same state", async () => {
    const first = context();

    await runScenario("all", first.ctx);

    const { lines } = first;

    expect(lines).toContain("created org Horizonte Logística");
    expect(lines).toContain("created org Vale Verde Agro");
    expect(lines).toContain("company plan silver skipped: ABACATEPAY_API_KEY not set");
    expect(lines).toContain("Carreira Pro skipped: ABACATEPAY_API_KEY not set");
    expect(lines).toContain("skipped: AI not configured");
    expect(lines).toContain("Marina Lopes benefit overridden manually to platinum");
    expect(lines).toContain(
      "Marina Lopes still has the manual Platinum benefit after the policy ran again",
    );
    expect(lines).toContain("Helena Pires applied to Analista de Marketing Pleno");
    expect(lines).toContain("Analista de Growth moved to offer");
    expect(lines).toContain("Analista de Marketing Digital closed as rejected");
    expect(lines).toContain("Helena Pires scheduled an interview with RH da Mercado Fino");
    expect(lines).toContain(
      "Helena Pires saved 6 answers (1 sensitive) and profile fields: gender shared, disability private",
    );
    expect(lines).toContain(
      "Helena Pires rejected Analista de CRM for location, undid it, then rejected it for salary",
    );
    expect(lines).toContain(
      "Nina Castro: SCN-1001 marked returned, SCN-1002 in transit, SCN-1003 back in inventory",
    );
    expect(lines).toContain("8 integrations configured, 6 connected");
    expect(
      lines.some((line) =>
        line.startsWith('completing "Fechar ponto e banco de horas" fired the webhook'),
      ),
    ).toBe(true);

    const second = context();

    await runScenario("all", second.ctx);

    expect(second.lines).toContain("org Aurora Cosméticos already exists");
    expect(second.lines.some((line) => line.startsWith("Helena Pires applied to"))).toBe(false);
    expect(second.lines).toContain("kept Notebook Dell Latitude 5440 (SCN-1001) for Nina Castro");
    expect(second.lines).toContain("Marina Lopes benefit overridden manually to platinum");

    const reply = await second.ctx.http("GET", "/me/applications", {
      cookie: (await signIn(second.ctx, "employee", people.helena.email)).cookie,
    });

    expect(
      z
        .array(z.object({ status: z.string() }))
        .parse(reply.body)
        .map((item) => item.status)
        .sort(),
    ).toEqual(["closed", "interview", "offer", "sent"]);
  });

  it("completes the offboarding checklist and the exit survey", async () => {
    const { ctx, lines } = context();
    await runScenario("offboarding", ctx);

    expect(lines.some((line) => /Gustavo Ribeiro: \d+ of \d+ tasks moved to done/.test(line))).toBe(
      true,
    );
    expect(lines).toContain("Gustavo Ribeiro exit survey submitted (NPS 9)");
  });

  it("runs the career flow and upgrades to Carreira Pro through a signed webhook", async () => {
    const { ctx, lines } = context({
      ABACATEPAY_API_KEY: "sandbox-key",
      ABACATEPAY_WEBHOOK_SECRET: webhookSecret,
    });

    await runScenario("career", ctx);

    expect(lines).toContain("Helena Pires saved a base résumé");
    expect(lines.some((line) => line.startsWith("Helena Pires sees"))).toBe(true);
    expect(lines).toContain("Helena Pires Carreira Pro is active");

    const again = context({
      ABACATEPAY_API_KEY: "sandbox-key",
      ABACATEPAY_WEBHOOK_SECRET: webhookSecret,
    });

    await runScenario("career", again.ctx);

    expect(again.lines).toContain("Helena Pires Carreira Pro already active");
  });

  it("subscribes a company through the checkout route and activates it from a signed webhook", async () => {
    const { ctx, lines } = context({
      ABACATEPAY_API_KEY: "sandbox-key",
      ABACATEPAY_WEBHOOK_SECRET: webhookSecret,
    });

    await runScenario("company-payment", ctx);

    expect(lines).toContain("company subscription is active on silver");

    const admin = await ensureOrg(ctx, orgs[1].org);
    const reply = await ctx.http("GET", "/billing/subscription", { cookie: admin.session.cookie });

    expect(reply.body).toMatchObject({ status: "active", plan: { slug: "silver" } });

    const again = context({
      ABACATEPAY_API_KEY: "sandbox-key",
      ABACATEPAY_WEBHOOK_SECRET: webhookSecret,
    });

    await runScenario("company-payment", again.ctx);

    expect(again.lines).toContain("company subscription already active on silver");
  });
});
