import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@offboard/db/client";
import {
  authRateLimit,
  authUser,
  benefitAssignments,
  offboardingCases,
  organizations,
  subscriptions,
  talentProfiles,
  teamMembers,
  plans,
} from "@offboard/db/schema";
import { seedCatalog } from "@offboard/db/seed-database";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createRuntimeAuth } from "../features/auth/auth.js";
import { latestCode, readOutbox } from "../shared/dev-outbox.js";
import { createRepositories } from "../repositories.js";
import { addDays, type Context } from "./context.js";
import { createHttp } from "./http.js";
import { runScenario } from "./run.js";
import { orgs, people } from "./scenarios.js";
import { ensureOrg, sendWebhook } from "./steps.js";
import { completedEvent } from "./webhook.js";

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
      DEV_EMAIL_OUTBOX: outbox,
    },
  });

  const app = createApp(webOrigin, repos, {
    auth,
    sendEmail: (message) => sender.send(message),
    secretKey: "scenario-secret-key-for-tests-0001",
    abacatepayWebhookSecret: webhookSecret,
    abacatepay: {
      configured: true,
      createSubscriptionCheckout: async () => ({
        id: "bill_1",
        url: "https://checkout.example.com/x",
      }),
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

  it("creates three orgs on different plans and runs every scenario", async () => {
    const { ctx, lines } = context();

    await runScenario("all", ctx);

    expect(lines).toContain("created org Horizonte Logística");
    expect(lines).toContain("created org Vale Verde Agro");
    expect(lines).toContain("company plan silver skipped: ABACATEPAY_API_KEY not set");
    expect(lines).toContain("Carreira Pro skipped: ABACATEPAY_API_KEY not set");

    const { ctx: other } = context();
    await runScenario("company-payment", other);
    await runScenario("orgs", other);

    expect(
      await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.email, "lucas.pereira@horizonte.example.com")),
    ).toHaveLength(1);
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
  });

  it("activates a pending company subscription from a signed webhook", async () => {
    const { ctx } = context();
    const admin = await ensureOrg(ctx, orgs[1].org);
    const [plan] = await db.select().from(plans).where(eq(plans.slug, "silver"));

    const [subscription] = await db
      .insert(subscriptions)
      .values({
        orgId: admin.orgId,
        planId: plan.id,
        status: "past_due",
        currentPeriodStart: addDays(ctx.today(), -30),
        currentPeriodEnd: addDays(ctx.today(), -1),
      })
      .returning({ id: subscriptions.id });

    await sendWebhook(
      ctx,
      webhookSecret,
      completedEvent({
        eventId: ctx.newId(),
        externalId: subscription.id,
        amountCents: plan.monthlyPriceCents,
      }),
    );

    const reply = await ctx.http("GET", "/billing/subscription", { cookie: admin.session.cookie });

    expect(reply.body).toMatchObject({ id: subscription.id, status: "active" });
  });
});
