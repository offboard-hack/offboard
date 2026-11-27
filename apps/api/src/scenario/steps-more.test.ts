import { expect, it } from "vitest";
import type { Context, Json } from "./context.js";
import type { Http, Reply } from "./http.js";
import { startReceiver } from "./receiver.js";
import type { Admin, Collaborator, Person } from "./steps.js";
import {
  draftAiApply,
  improveWithAi,
  recordApplications,
  rejectJobs,
  saveAnswers,
} from "./steps-career.js";
import { ensureResume } from "./steps.js";
import {
  configureActions,
  expectManualBenefit,
  manageEquipment,
  overrideBenefit,
} from "./steps-hr.js";

const reply = (status: number, body: Json = null) =>
  ({ status, body, cookies: [] }) satisfies Reply;

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
    startReceiver,
    newId: () => "abcdef12-0000-0000-0000-000000000000",
    today: () => "2026-11-26",
    log: (line) => lines.push(line),
    sessions: new Map(),
    logins: [],
  } satisfies Context;

  return { ctx, calls, lines };
}

const person: Person = {
  caseId: "case",
  email: "p@example.com",
  name: "Pessoa",
  department: "Marketing",
  role: "Analista",
};

const collaborator: Collaborator = { person, session: { cookie: "c=1" } };
const admin: Admin = { orgId: "org", email: "a@example.com", session: { cookie: "c=1" } };
const ai = { ANTHROPIC_API_KEY: "key" };

const jobs = reply(200, {
  items: [{ id: "job-1", title: "Analista de Marketing Pleno" }],
  total: 1,
  pageSize: 20,
});

const noRejections = reply(200, { items: [] });

it("skips the AI steps without a key", async () => {
  const { ctx, lines } = scripted([]);

  expect(await improveWithAi(ctx, collaborator)).toBe("skipped");
  expect(await draftAiApply(ctx, collaborator, "Vaga")).toBe("skipped");
  expect(lines).toEqual(["skipped: AI not configured", "skipped: AI not configured"]);
});

it("scores, matches and applies a suggestion and shows the score change", async () => {
  const { ctx, calls, lines } = scripted(
    [
      reply(200, { score: 40 }),
      reply(200, { processed: 2, failed: 0 }),
      reply(200, [{ id: "s1", rationale: "Quantifique resultados" }]),
      reply(200, {}),
      reply(200, { score: 55 }),
    ],
    { ...ai, CRON_SECRET: "cron" },
  );

  expect(await improveWithAi(ctx, collaborator)).toBe("done");
  expect(calls).toEqual([
    "POST /me/resume/score/run",
    "POST /background/drain",
    "GET /me/resume/suggestions",
    "POST /me/resume/suggestions/s1/apply",
    "POST /me/resume/score/run",
  ]);
  expect(lines).toContain("job matching ran: 2 jobs processed, 0 failed");
  expect(lines).toContain('applied "Quantifique resultados": score 40 -> 55');
});

it("waits for the score to arrive after the run-now call", async () => {
  const { ctx, calls, lines } = scripted(
    [reply(200, { score: null }), reply(200, { score: 61 }), reply(200, [])],
    ai,
  );

  await improveWithAi(ctx, collaborator, 1, 5000);

  expect(calls.slice(0, 2)).toEqual(["POST /me/resume/score/run", "GET /me/resume"]);
  expect(lines).toContain("Pessoa résumé score is 61");
});

it("reports pending scores, skipped matching and missing suggestions", async () => {
  const none = scripted([reply(200, { score: null }), reply(200, [])], ai);

  expect(await improveWithAi(none.ctx, collaborator, 1, 0)).toBe("done");
  expect(none.lines).toContain("Pessoa résumé score is pending");
  expect(
    none.lines.some((line) => line.startsWith("skipped: job matching needs CRON_SECRET")),
  ).toBe(true);
  expect(none.lines).toContain("no open résumé suggestions to apply");

  const pending = scripted(
    [
      reply(200, { score: null }),
      reply(200, { processed: 0, failed: 0 }),
      reply(200, [{ id: "s1", rationale: "Ajuste" }]),
      reply(200, {}),
      reply(200, { score: null }),
    ],
    { ...ai, CRON_SECRET: "cron" },
  );

  await improveWithAi(pending.ctx, collaborator, 1, 0);

  expect(pending.lines).toContain('applied "Ajuste": score pending -> pending');
});

it("drafts an AI Apply attempt and explains what it does not run", async () => {
  const plain = scripted(
    [reply(200, {}), noRejections, jobs, reply(201, { attempt: { state: "draft" } })],
    ai,
  );

  expect(await draftAiApply(plain.ctx, collaborator, "Analista de Marketing Pleno")).toBe(
    "drafted",
  );
  expect(plain.lines).toContain("AI Apply draft for Analista de Marketing Pleno is draft");
  expect(plain.lines).toContain("skipped: Browserbase not configured, so the draft is not run");

  const browser = scripted(
    [reply(200, {}), noRejections, jobs, reply(200, { attempt: { state: "assisted" } })],
    { ...ai, BROWSERBASE_API_KEY: "k", BROWSERBASE_PROJECT_ID: "p" },
  );

  await draftAiApply(browser.ctx, collaborator, "Analista de Marketing Pleno");

  expect(browser.lines).toContain("skipped: running the rehearsal is not driven by this runner");
});

it("reports a refused AI Apply draft with or without a reason", async () => {
  const withReason = scripted(
    [reply(200, {}), noRejections, jobs, reply(403, { error: "AI Apply not available" })],
    ai,
  );

  expect(await draftAiApply(withReason.ctx, collaborator, "Analista de Marketing Pleno")).toBe(
    "refused",
  );
  expect(withReason.lines).toContain(
    "skipped: AI Apply draft refused (403: AI Apply not available)",
  );

  const bare = scripted([reply(200, {}), noRejections, jobs, reply(502)], ai);

  await draftAiApply(bare.ctx, collaborator, "Analista de Marketing Pleno");

  expect(bare.lines).toContain("skipped: AI Apply draft refused (502)");

  const missing = scripted([reply(200, {}), noRejections, jobs], ai);

  await expect(draftAiApply(missing.ctx, collaborator, "Outra vaga")).rejects.toThrow(
    "Job Outra vaga is not in the catalog",
  );
});

it("finds a rejected job through the rejections list", async () => {
  const rejected = reply(200, { items: [{ job: { id: "job-9", title: "Analista de CRM" } }] });

  const { ctx, calls } = scripted([rejected, reply(204), reply(204), rejected, reply(204)]);

  await rejectJobs(ctx, collaborator);

  expect(calls[1]).toBe("POST /me/jobs/job-9/reject");
});

it("pages through the catalog and fails on a missing application", async () => {
  const firstPage = reply(200, {
    items: [{ id: "job-0", title: "Outra" }],
    total: 25,
    pageSize: 20,
  });

  const lost = scripted([
    reply(200, { id: "resume-1" }),
    reply(200, []),
    noRejections,
    firstPage,
    jobs,
    reply(201, { applicationId: "a1" }),
    reply(200, []),
  ]);

  await expect(recordApplications(lost.ctx, collaborator)).rejects.toThrow(
    "Application to Analista de Marketing Pleno was not recorded",
  );
  expect(lost.calls).toContain("GET /me/jobs?view=all&page=2");
});

it("fails when a benefit cannot be overridden or the manual one is lost", async () => {
  const noPlan = scripted([reply(200, []), reply(200, [])]);

  await expect(overrideBenefit(noPlan.ctx, admin, "Pessoa", "platinum")).rejects.toThrow(
    "Plan platinum is not in the catalog",
  );

  const plans = reply(200, [{ id: "p1", slug: "platinum", monthlyPriceCents: 1 }]);
  const noBenefit = scripted([plans, reply(200, [])]);

  await expect(overrideBenefit(noBenefit.ctx, admin, "Pessoa", "platinum")).rejects.toThrow(
    "Pessoa has no benefit to override",
  );

  const lost = scripted([
    reply(200, [{ id: "a1", profileName: "Pessoa", assignedPlanName: "Silver", source: "rule" }]),
  ]);

  await expect(expectManualBenefit(lost.ctx, admin, "Pessoa")).rejects.toThrow(
    "lost the manual benefit (source rule)",
  );

  const none = scripted([reply(200, [])]);

  await expect(expectManualBenefit(none.ctx, admin, "Pessoa")).rejects.toThrow("(source none)");
});

it("fails when equipment is not listed after creating it", async () => {
  const { ctx } = scripted([reply(201), reply(201), reply(201), reply(200, [])]);

  await expect(manageEquipment(ctx, admin, person)).rejects.toThrow(
    "SCN-1001 was not listed after creating it",
  );
});

it("fails when the checklist has no task or the action never fires", async () => {
  const receiver = await startReceiver();

  try {
    const action = reply(201, { id: "act-1" });

    const noTask = scripted([
      reply(200, []),
      action,
      action,
      reply(200, { tasks: [{ id: "t1", title: "Outra", status: "todo" }] }),
    ]);

    await expect(configureActions(noTask.ctx, admin, person, receiver, 50)).rejects.toThrow(
      'has no task "Fechar ponto e banco de horas"',
    );

    const silent = scripted([
      reply(200, [{ id: "act-1", name: "webhook:point" }]),
      reply(200, { id: "act-1" }),
      action,
      reply(200, {
        tasks: [{ id: "t1", title: "Fechar ponto e banco de horas", status: "todo" }],
      }),
      reply(200, {}),
    ]);

    await expect(configureActions(silent.ctx, admin, person, receiver, 50)).rejects.toThrow(
      'The webhook action did not fire for "Fechar ponto e banco de horas"',
    );
    expect(silent.calls[1]).toBe("PUT /automation-rules/act-1");
  } finally {
    await receiver.close();
  }
});

it("saves a missing résumé and skips answers for questions the library lacks", async () => {
  const resume = scripted([reply(404), reply(200, {})]);

  await ensureResume(resume.ctx, collaborator, { headline: { text: "x" } });

  expect(resume.calls).toEqual(["GET /me/resume", "POST /me/resume"]);

  const answers = scripted([
    reply(200, { questions: [{ id: "q1", text: "Você possui CNH?", answer: null }] }),
    reply(200, {}),
    reply(200, {}),
  ]);

  await saveAnswers(answers.ctx, collaborator);

  expect(answers.calls).toEqual(["GET /me/answers", "PUT /me/answers/q1", "PUT /me/preferences"]);
  expect(answers.lines[0]).toContain("saved 1 answers (0 sensitive)");
});
