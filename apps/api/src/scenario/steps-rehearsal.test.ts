import { expect, it } from "vitest";
import type { Context, Json } from "./context.js";
import type { Http, Reply } from "./http.js";
import { startReceiver } from "./receiver.js";
import {
  capableJobs,
  findCandidates,
  rehearsalAnswers,
  rehearsalGap,
  rehearsalStatus,
  rehearseAiApply,
} from "./steps-rehearsal.js";
import type { Collaborator } from "./steps.js";

const reply = (status: number, body: Json = null) =>
  ({ status, body, cookies: [] }) satisfies Reply;

function scripted(replies: Reply[], env: Record<string, string | undefined> = {}) {
  const calls: string[] = [];
  const bodies: Json[] = [];
  const lines: string[] = [];

  const http: Http = async (method, path, options) => {
    calls.push(`${method} ${path}`);
    bodies.push(options?.body === undefined ? null : JSON.parse(JSON.stringify(options.body)));

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
    startReceiver,
    newId: () => "abcdef12-0000-0000-0000-000000000000",
    today: () => "2026-11-27",
    log: (line) => lines.push(line),
    sessions: new Map(),
    logins: [],
  } satisfies Context;

  return { ctx, calls, bodies, lines };
}

const collaborator: Collaborator = {
  person: {
    caseId: "case",
    email: "p@example.com",
    name: "Pessoa",
    department: "Marketing",
    role: "Analista",
  },
  session: { cookie: "c=1" },
};

const keys = {
  ANTHROPIC_API_KEY: "ai",
  BROWSERBASE_API_KEY: "bb",
  BROWSERBASE_PROJECT_ID: "project",
  CRON_SECRET: "cron",
};

const job = (id: string, capable: boolean, applied = false) => ({
  id,
  title: `Vaga ${id}`,
  company: "Acme",
  aiApplyCapable: capable,
  applied,
});

const page = (items: Json[], total = items.length) => reply(200, { items, total, pageSize: 2 });

const question = (
  id: string,
  kind: string,
  required: boolean,
  type = "text",
  values: string[] = [],
) => ({
  id,
  kind,
  required,
  fields: [{ type, options: values.map((value) => ({ value })) }],
});

const attempt = (state: string, extra: Record<string, Json> = {}) => ({
  id: "att-1",
  job: { id: "a", title: "Vaga a", company: "Acme" },
  state,
  reason: null,
  rehearsal: true,
  hasScreenshot: false,
  liveUrl: null,
  questions: [],
  answers: [],
  ...extra,
});

it("reports what is missing for a rehearsal", () => {
  expect(rehearsalGap({})).toBe("AI not configured");
  expect(rehearsalGap({ AI_GATEWAY_API_KEY: "k" })).toBe("Browserbase not configured");
  expect(rehearsalGap({ ANTHROPIC_API_KEY: "k", BROWSERBASE_API_KEY: "b" })).toBe(
    "Browserbase not configured",
  );
  expect(rehearsalGap({ ANTHROPIC_API_KEY: "k", BROWSERBASE_PROJECT_ID: "p" })).toBe(
    "Browserbase not configured",
  );
  expect(
    rehearsalGap({
      ANTHROPIC_API_KEY: "k",
      BROWSERBASE_API_KEY: "b",
      BROWSERBASE_PROJECT_ID: "p",
    }),
  ).toBe("CRON_SECRET not set, so the job sources cannot be synced");
  expect(rehearsalGap(keys)).toBeUndefined();
});

it("keeps only open Greenhouse jobs the collaborator has not applied to", () => {
  expect(
    capableJobs([job("a", false), job("b", true, true), job("c", true), job("d", true)]).map(
      (item) => item.id,
    ),
  ).toEqual(["c", "d"]);
});

it("maps states to the rehearsal status and refuses a submission", () => {
  expect(rehearsalStatus("rehearsed")).toBe("rehearsed");
  expect(rehearsalStatus("needs_check")).toBe("needs_check");
  expect(rehearsalStatus("assisted")).toBe("blocked");
  expect(rehearsalStatus("cancelled")).toBe("cancelled");
  expect(() => rehearsalStatus("submitted")).toThrow("never submit");
  expect(() => rehearsalStatus("submitting")).toThrow("never submit");
});

it("answers the asked questions from the draft and fills required blanks", () => {
  const answers = rehearsalAnswers({
    ...attempt("draft"),
    questions: [
      question("resume", "resume", true, "file"),
      question("letter", "cover_letter", false, "file"),
      question("doc", "document", false, "file"),
      question("token", "custom", true, "hidden"),
      question("name", "first_name", true),
      question("why", "custom", true),
      question("opt", "custom", false),
      question("pick", "custom", true, "single_select", ["a", "b"]),
      question("many", "custom", true, "multi_select", ["x"]),
      question("empty-pick", "custom", true, "single_select"),
      question("empty-many", "custom", true, "multi_select"),
      { id: "bare", kind: "custom", required: true, fields: [] },
    ],
    answers: [{ questionId: "name", value: "Pessoa" }],
  });

  expect(answers).toEqual([
    { questionId: "name", value: "Pessoa" },
    { questionId: "why", value: "Não se aplica" },
    { questionId: "opt", value: null },
    { questionId: "pick", value: "a" },
    { questionId: "many", value: ["x"] },
    { questionId: "empty-pick", value: null },
    { questionId: "empty-many", value: null },
    { questionId: "bare", value: "Não se aplica" },
  ]);
});

it("collects up to three candidates across pages", async () => {
  const { ctx, calls } = scripted([
    page([job("a", false), job("b", true)], 6),
    page([job("c", true), job("d", true)], 6),
  ]);

  expect((await findCandidates(ctx, "c=1")).map((item) => item.id)).toEqual(["b", "c", "d"]);
  expect(calls).toEqual(["GET /me/jobs?view=all&page=1", "GET /me/jobs?view=all&page=2"]);

  const few = scripted([page([job("a", false), job("b", true)], 3), page([job("c", false)], 3)]);

  expect((await findCandidates(few.ctx, "c=1")).map((item) => item.id)).toEqual(["b"]);
});

it("skips and prints the reason without the keys", async () => {
  const { ctx, lines, calls } = scripted([]);

  expect(await rehearseAiApply(ctx, collaborator)).toBe("skipped");
  expect(lines).toEqual(["skipped: AI not configured"]);
  expect(calls).toEqual([]);
});

const consent = reply(200, {});
const drain = reply(200, { processed: 3, failed: 0 });
const noAttempts = reply(200, { items: [] });

it("skips when no synced job is capable", async () => {
  const { ctx, lines } = scripted([consent, drain, page([job("a", false)])], keys);

  expect(await rehearseAiApply(ctx, collaborator, 1, 0)).toBe("skipped");
  expect(lines).toContain("job sources synced: 3 jobs processed, 0 failed");
  expect(lines).toContain("skipped: no synced job has aiApplyCapable set");
});

it("tries the next candidate when a draft is refused, then reports a refusal", async () => {
  const { ctx, lines, calls } = scripted(
    [
      consent,
      drain,
      page([job("a", true), job("b", true)]),
      noAttempts,
      reply(502, { error: "Could not read the application form" }),
      reply(403),
    ],
    keys,
  );

  expect(await rehearseAiApply(ctx, collaborator, 1, 0)).toBe("refused");
  expect(calls.slice(-2)).toEqual(["POST /me/jobs/a/ai-apply", "POST /me/jobs/b/ai-apply"]);
  expect(lines).toContain(
    "Vaga a at Acme: draft refused (502: Could not read the application form)",
  );
  expect(lines).toContain("Vaga b at Acme: draft refused (403)");
  expect(lines).toContain(
    "skipped: no Greenhouse job had a readable form this collaborator could draft",
  );
});

it("confirms a rehearsal only, runs it and prints the status, live view and screenshot", async () => {
  const drafted = attempt("draft", {
    questions: [question("name", "first_name", true)],
    answers: [{ questionId: "name", value: "Pessoa" }],
  });

  const { ctx, calls, bodies, lines } = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(201, { attempt: drafted }),
      reply(200, attempt("queued")),
      reply(202, attempt("queued")),
      reply(200, attempt("running", { liveUrl: "https://live.test/x" })),
      reply(200, attempt("running", { liveUrl: "https://live.test/x" })),
      reply(200, attempt("rehearsed", { hasScreenshot: true })),
    ],
    keys,
  );

  expect(await rehearseAiApply(ctx, collaborator, 1, 5000)).toBe("rehearsed");
  expect(calls).toEqual([
    "PUT /me/ai-apply/consent",
    "POST /background/drain",
    "GET /me/jobs?view=all&page=1",
    "GET /me/ai-applications",
    "POST /me/jobs/a/ai-apply",
    "POST /me/ai-applications/att-1/confirm",
    "POST /me/ai-applications/att-1/run",
    "GET /me/ai-applications/att-1",
    "GET /me/ai-applications/att-1",
    "GET /me/ai-applications/att-1",
  ]);
  expect(bodies[5]).toEqual({
    answers: [{ questionId: "name", value: "Pessoa" }],
    rehearsal: true,
  });
  expect(lines.filter((line) => line.startsWith("live view"))).toEqual([
    "live view: https://live.test/x",
  ]);
  expect(lines).toContain("AI Apply rehearsal for Vaga a at Acme: rehearsed");
  expect(lines).toContain("screenshot: /api/me/ai-applications/att-1/screenshot");
});

it("reports a blocked rehearsal with its reason and no screenshot", async () => {
  const { ctx, lines } = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(200, { attempt: attempt("rehearsed") }),
      reply(200, attempt("assisted", { reason: "blocked" })),
    ],
    keys,
  );

  expect(await rehearseAiApply(ctx, collaborator, 1, 0)).toBe("blocked");
  expect(lines).toContain("AI Apply rehearsal for Vaga a at Acme: blocked (blocked)");
  expect(lines.some((line) => line.startsWith("screenshot"))).toBe(false);
});

it("reports a pending rehearsal when it does not settle in time", async () => {
  const { ctx, lines } = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(201, { attempt: attempt("draft") }),
      reply(200, attempt("running")),
    ],
    keys,
  );

  expect(await rehearseAiApply(ctx, collaborator, 1, 0)).toBe("pending");
  expect(lines).toContain("AI Apply rehearsal for Vaga a at Acme: pending");
});

it("reports an attempt that is already settled without confirming again", async () => {
  const { ctx, calls, lines } = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(200, { attempt: attempt("needs_check", { rehearsal: false, reason: "form_changed" }) }),
    ],
    keys,
  );

  expect(await rehearseAiApply(ctx, collaborator, 1, 0)).toBe("needs_check");
  expect(calls.some((call) => call.endsWith("/confirm"))).toBe(false);
  expect(lines).toContain("AI Apply rehearsal for Vaga a at Acme: needs_check (form_changed)");
});

it("reports a refused confirmation with or without a reason", async () => {
  const withReason = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(201, { attempt: attempt("draft") }),
      reply(429, { error: "Daily AI application limit reached" }),
    ],
    keys,
  );

  expect(await rehearseAiApply(withReason.ctx, collaborator, 1, 0)).toBe("refused");
  expect(withReason.lines).toContain(
    "skipped: the rehearsal was refused (429: Daily AI application limit reached)",
  );

  const bare = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(201, { attempt: attempt("draft") }),
      reply(503),
    ],
    keys,
  );

  await rehearseAiApply(bare.ctx, collaborator, 1, 0);

  expect(bare.lines).toContain("skipped: the rehearsal was refused (503)");
});

it("refuses to continue when the confirmed attempt is not a rehearsal", async () => {
  const { ctx } = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(201, { attempt: attempt("draft") }),
      reply(200, attempt("queued", { rehearsal: false })),
    ],
    keys,
  );

  await expect(rehearseAiApply(ctx, collaborator, 1, 0)).rejects.toThrow("not a rehearsal");
});

it("fails when the attempt ends submitted", async () => {
  const { ctx } = scripted(
    [
      consent,
      drain,
      page([job("a", true)]),
      noAttempts,
      reply(200, { attempt: attempt("submitted", { rehearsal: false }) }),
    ],
    keys,
  );

  await expect(rehearseAiApply(ctx, collaborator, 1, 0)).rejects.toThrow("never submit");
});

it("reuses an open draft for a candidate instead of drafting again", async () => {
  const { ctx, calls } = scripted(
    [
      consent,
      drain,
      page([job("z", true), job("a", true)]),
      reply(200, {
        items: [
          attempt("draft"),
          attempt("needs_check", { job: { id: "z", title: "Z", company: "Acme" } }),
        ],
      }),
      reply(200, attempt("rehearsed", { hasScreenshot: true })),
    ],
    keys,
  );

  expect(await rehearseAiApply(ctx, collaborator, 1, 0)).toBe("rehearsed");
  expect(calls.some((call) => call.endsWith("/ai-apply"))).toBe(false);
});
