import { expect, it } from "vitest";
import { z } from "zod";
import {
  addDays,
  expectStatus,
  parseBody,
  recordLogin,
  renderLogins,
  type Context,
  type Json,
} from "./context.js";
import type { Http, Reply } from "./http.js";
import {
  addPerson,
  listJobs,
  readBenefit,
  rehearseAiApply,
  setBenefitPolicy,
  signIn,
  subscribeCompany,
  upgradeCareerPro,
  type Admin,
} from "./steps.js";

const reply = (status: number, body: Json = null, cookies: string[] = []) =>
  ({ status, body, cookies }) satisfies Reply;

function scripted(replies: Reply[], env: Record<string, string | undefined> = {}) {
  const calls: string[] = [];
  const lines: string[] = [];

  const http: Http = async (method, path) => {
    calls.push(`${method} ${path}`);
    const next = replies.shift();

    if (!next) throw new Error(`Unexpected ${method} ${path}`);

    return next;
  };

  const ctx = {
    http,
    env,
    webOrigin: "http://localhost:5173",
    readCode: async () => "123456",
    seedCatalog: async () => undefined,
    newId: () => "abcdef12-0000-0000-0000-000000000000",
    today: () => "2026-11-26",
    log: (line) => lines.push(line),
    sessions: new Map(),
    logins: [],
  } satisfies Context;

  return { ctx, calls, lines };
}

const admin: Admin = { orgId: "org", email: "a@example.com", session: { cookie: "c=1" } };

const person = {
  caseId: "case",
  email: "p@example.com",
  name: "Pessoa",
  department: "Marketing",
  role: "Analista",
};

it("fails when sign-in sets no session cookie and reuses a known session", async () => {
  const missing = scripted([reply(200), reply(200, null, ["other=1; Path=/"])]);

  await expect(signIn(missing.ctx, "member", "a@example.com")).rejects.toThrow(
    "did not set a session cookie",
  );

  const employee = scripted([
    reply(200),
    reply(200, null, ["offboard-colaborador.session_token=abc; Path=/"]),
    reply(200, { grantId: "grant-1" }),
  ]);

  const session = await signIn(employee.ctx, "employee", "p@example.com");

  expect(session).toEqual({ cookie: "offboard-colaborador.session_token=abc", grant: "grant-1" });
  expect(await signIn(employee.ctx, "employee", "p@example.com")).toBe(session);
  expect(employee.calls).toHaveLength(3);
});

it("skips company payment without the sandbox key or webhook secret", async () => {
  const noKey = scripted([]);
  const noSecret = scripted([], { ABACATEPAY_API_KEY: "key" });

  expect(await subscribeCompany(noKey.ctx, admin, "gold")).toBe("skipped");
  expect(noKey.lines).toEqual(["company plan gold skipped: ABACATEPAY_API_KEY not set"]);
  expect(await subscribeCompany(noSecret.ctx, admin, "gold")).toBe("skipped");
  expect(noSecret.lines[0]).toContain("ABACATEPAY_WEBHOOK_SECRET not set");
});

it("subscribes, delivers the signed payment event and reads the activated subscription", async () => {
  const subscription = (status: string) =>
    reply(200, { id: "sub-1", status, plan: { slug: "gold", monthlyPriceCents: 24900 } });

  const { ctx, calls, lines } = scripted(
    [
      reply(200, { url: "https://checkout.example.com/1" }),
      subscription("pending"),
      reply(200, { ok: true }),
      subscription("active"),
    ],
    { ABACATEPAY_API_KEY: "key", ABACATEPAY_WEBHOOK_SECRET: "secret" },
  );

  expect(await subscribeCompany(ctx, admin, "gold")).toBe("active");
  expect(calls).toEqual([
    "POST /billing/subscription",
    "GET /billing/subscription",
    "POST /billing/webhook",
    "GET /billing/subscription",
  ]);
  expect(lines).toContain("AbacatePay sandbox checkout: https://checkout.example.com/1");
});

it("skips Carreira Pro without keys and reports a missing individual plan", async () => {
  const skipped = scripted([]);

  expect(await upgradeCareerPro(skipped.ctx, { person, session: { cookie: "c" } }, "p1")).toBe(
    "skipped",
  );

  const paid = scripted(
    [
      reply(200, { url: "https://checkout.example.com/2" }),
      reply(200, { ok: true }),
      reply(200, { upgrade: { offered: true }, individual: null }),
    ],
    { ABACATEPAY_API_KEY: "key", ABACATEPAY_WEBHOOK_SECRET: "secret" },
  );

  expect(await upgradeCareerPro(paid.ctx, { person, session: { cookie: "c" } }, "p1")).toBe(
    "missing",
  );
});

it("reports why AI Apply is skipped", () => {
  const bare = scripted([]);

  const configured = scripted([], {
    ANTHROPIC_API_KEY: "k",
    BROWSERBASE_API_KEY: "k",
    BROWSERBASE_PROJECT_ID: "p",
  });

  rehearseAiApply(bare.ctx);
  rehearseAiApply(configured.ctx);

  expect(bare.lines[0]).toContain("needs an AI key and Browserbase");
  expect(configured.lines[0]).toContain("does not drive it yet");
});

it("fails on unknown plans, foreign emails and unexpected bodies", async () => {
  const plans = scripted([reply(200, [])]);

  await expect(
    setBenefitPolicy(plans.ctx, admin, { defaultPlanSlug: "gold", durationMonths: 6, rules: [] }),
  ).rejects.toThrow("Plan gold is not in the catalog");

  const clash = scripted([reply(409, { error: "Email already in use" }), reply(200, [])]);

  await expect(
    addPerson(clash.ctx, admin, {
      name: "Pessoa",
      role: "Analista",
      department: "Marketing",
      email: "p@example.com",
      deadlineInDays: 5,
    }),
  ).rejects.toThrow("exists with another email");

  expect(() => parseBody(reply(200, { id: 1 }), "Thing", z.object({ id: z.string() }))).toThrow(
    "Thing returned an unexpected body",
  );
  expect(() => expectStatus(reply(500, "boom"), "Call", 200)).toThrow(
    'Call failed with 500: "boom"',
  );
});

it("reports a missing benefit and jobs computed with matches", async () => {
  const benefit = scripted([reply(200, [])]);

  expect(await readBenefit(benefit.ctx, admin, "Pessoa")).toBeUndefined();
  expect(benefit.lines).toEqual(["Pessoa has no benefit assignment"]);

  const jobs = scripted([
    reply(200, { total: 2, matching: true }),
    reply(200, { total: 5, matching: true }),
  ]);

  expect(await listJobs(jobs.ctx, { person, session: { cookie: "c" } })).toEqual({
    compatible: 2,
    all: 5,
  });
  expect(jobs.lines).toEqual(["Pessoa sees 2 compatible of 5 jobs"]);

  const unmatched = scripted([
    reply(200, { total: 0, matching: false }),
    reply(200, { total: 5, matching: false }),
  ]);

  await listJobs(unmatched.ctx, { person, session: { cookie: "c" } });

  expect(unmatched.lines[0]).toContain("matches are computed only with an AI key");
});

it("dedupes logins, renders them and adds days", () => {
  const { ctx } = scripted([]);

  recordLogin(ctx, { who: "HR", email: "a@example.com", where: "/entrar" });
  recordLogin(ctx, { who: "HR", email: "a@example.com", where: "/entrar" });

  expect(renderLogins(ctx.logins)).toEqual(["  HR: a@example.com -> /entrar"]);
  expect(addDays("2026-11-26", -10)).toBe("2026-11-16");
});
