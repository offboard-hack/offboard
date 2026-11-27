import { z } from "zod";
import { addDays, expectStatus, parseBody, type Context } from "./context.js";
import type { Collaborator } from "./steps.js";

const jobList = z.object({
  items: z.array(z.object({ id: z.string(), title: z.string() })),
  total: z.number(),
  pageSize: z.number(),
});

const rejectionList = z.object({
  items: z.array(z.object({ job: z.object({ id: z.string(), title: z.string() }) })),
});

const applicationList = z.array(
  z.object({
    id: z.string(),
    status: z.string(),
    job: z.object({ id: z.string(), title: z.string() }),
  }),
);

const interviewList = z.array(z.object({ applicationId: z.string() }));

const stages = ["sent", "in_review", "interview", "offer"];

export type ApplicationPlan = {
  title: string;
  reach: "sent" | "in_review" | "interview" | "offer" | "rejected";
  interviewWith?: string;
};

export const applicationPlans = [
  { title: "Analista de Marketing Pleno", reach: "interview", interviewWith: "RH da Mercado Fino" },
  { title: "Analista de Growth", reach: "offer" },
  { title: "Analista de Marketing Digital", reach: "rejected" },
  { title: "Analista de Marketing de Produto", reach: "sent" },
] satisfies ApplicationPlan[];

async function readRejections(ctx: Context, collaborator: Collaborator) {
  const reply = expectStatus(
    await ctx.http("GET", "/me/rejections", { cookie: collaborator.session.cookie }),
    "Listing rejected jobs",
    200,
  );

  return parseBody(reply, "Rejections", rejectionList).items.map((item) => item.job);
}

async function readApplications(ctx: Context, collaborator: Collaborator) {
  const reply = expectStatus(
    await ctx.http("GET", "/me/applications", { cookie: collaborator.session.cookie }),
    "Listing applications",
    200,
  );

  return parseBody(reply, "Applications", applicationList);
}

async function findJobId(ctx: Context, collaborator: Collaborator, title: string) {
  const rejected = (await readRejections(ctx, collaborator)).find((job) => job.title === title);

  if (rejected) return rejected.id;

  for (let page = 1; ; page += 1) {
    const reply = expectStatus(
      await ctx.http("GET", `/me/jobs?view=all&page=${page}`, {
        cookie: collaborator.session.cookie,
      }),
      "Listing catalog jobs",
      200,
    );

    const jobs = parseBody(reply, "Jobs", jobList);
    const found = jobs.items.find((job) => job.title === title);

    if (found) return found.id;

    if (page * jobs.pageSize >= jobs.total) throw new Error(`Job ${title} is not in the catalog`);
  }
}

async function readResumeId(ctx: Context, collaborator: Collaborator) {
  const reply = expectStatus(
    await ctx.http("GET", "/me/resume", { cookie: collaborator.session.cookie }),
    "Reading the résumé",
    200,
  );

  return parseBody(reply, "Résumé", z.object({ id: z.string() })).id;
}

async function scheduleInterview(
  ctx: Context,
  collaborator: Collaborator,
  applicationId: string,
  withWhom: string,
) {
  const cookie = collaborator.session.cookie;
  const from = ctx.today();

  const scheduled = parseBody(
    expectStatus(
      await ctx.http("GET", `/me/interviews?from=${from}&to=${addDays(from, 30)}`, { cookie }),
      "Listing interviews",
      200,
    ),
    "Interviews",
    interviewList,
  );

  if (scheduled.some((item) => item.applicationId === applicationId)) return;

  expectStatus(
    await ctx.http("POST", `/me/applications/${applicationId}/interviews`, {
      cookie,
      body: {
        startsAt: `${addDays(from, 3)}T13:00:00.000Z`,
        mode: "video",
        with: withWhom,
        notes: "Conversa inicial sobre a vaga e a trajetória.",
      },
    }),
    "Scheduling the interview",
    201,
  );

  ctx.log(`${collaborator.person.name} scheduled an interview with ${withWhom}`);
}

export async function recordApplications(ctx: Context, collaborator: Collaborator) {
  const cookie = collaborator.session.cookie;
  const resumeId = await readResumeId(ctx, collaborator);

  for (const plan of applicationPlans) {
    let application = (await readApplications(ctx, collaborator)).find(
      (item) => item.job.title === plan.title,
    );

    if (!application) {
      const jobId = await findJobId(ctx, collaborator, plan.title);

      expectStatus(
        await ctx.http("POST", `/me/jobs/${jobId}/apply`, { cookie, body: { resumeId } }),
        `Applying to ${plan.title}`,
        201,
      );

      application = (await readApplications(ctx, collaborator)).find(
        (item) => item.job.title === plan.title,
      );

      ctx.log(`${collaborator.person.name} applied to ${plan.title}`);
    }

    if (!application) throw new Error(`Application to ${plan.title} was not recorded`);

    const reached = stages.indexOf(application.status);
    const target = stages.indexOf(plan.reach);

    for (const status of stages.slice(Math.max(reached, 0) + 1, target + 1)) {
      expectStatus(
        await ctx.http("PATCH", `/me/applications/${application.id}`, { cookie, body: { status } }),
        `Moving ${plan.title} to ${status}`,
        200,
      );
      ctx.log(`${plan.title} moved to ${status}`);
    }

    if (plan.reach === "rejected" && application.status !== "closed") {
      expectStatus(
        await ctx.http("PATCH", `/me/applications/${application.id}`, {
          cookie,
          body: { status: "closed", closedReason: "rejected" },
        }),
        `Closing ${plan.title}`,
        200,
      );
      ctx.log(`${plan.title} closed as rejected`);
    }

    if (plan.interviewWith)
      await scheduleInterview(ctx, collaborator, application.id, plan.interviewWith);
  }
}

const library = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      answer: z.string().nullable(),
    }),
  ),
});

export const answerPlans = [
  {
    question: "Qual a sua pretensão salarial?",
    answer: "R$ 7.000 a R$ 8.500, negociável conforme o pacote.",
  },
  { question: "Qual a sua disponibilidade para início?", answer: "Imediata." },
  { question: "Qual o seu aviso prévio?", answer: "Não tenho aviso prévio em curso." },
  {
    question: "Qual o seu nível de inglês?",
    answer: "Avançado, uso diário em reuniões e e-mails.",
  },
  { question: "Você possui CNH?", answer: "Sim, categoria B." },
  {
    question: "Você se autodeclara pessoa com deficiência (PcD)?",
    answer: "Prefiro não informar.",
    sensitive: true,
  },
];

export const diversityFields = {
  disability: { value: "decline", share: false },
  gender: { value: "female", share: true },
};

export async function saveAnswers(ctx: Context, collaborator: Collaborator) {
  const cookie = collaborator.session.cookie;

  const questions = parseBody(
    expectStatus(
      await ctx.http("GET", "/me/answers", { cookie }),
      "Reading the answer library",
      200,
    ),
    "Answers",
    library,
  ).questions;

  let saved = 0;
  let sensitive = 0;

  for (const plan of answerPlans) {
    const question = questions.find((item) => item.text === plan.question);

    if (!question) continue;

    expectStatus(
      await ctx.http("PUT", `/me/answers/${question.id}`, {
        cookie,
        body: { answer: plan.answer },
      }),
      `Saving the answer to ${plan.question}`,
      200,
    );

    saved += 1;

    if (plan.sensitive) sensitive += 1;
  }

  expectStatus(
    await ctx.http("PUT", "/me/preferences", {
      cookie,
      body: { profileFields: diversityFields },
    }),
    "Saving the shared-or-private profile fields",
    200,
  );

  ctx.log(
    `${collaborator.person.name} saved ${saved} answers (${sensitive} sensitive) and profile fields: gender shared, disability private`,
  );
}

export async function rejectJobs(ctx: Context, collaborator: Collaborator) {
  const cookie = collaborator.session.cookie;
  const title = "Analista de CRM";
  const jobId = await findJobId(ctx, collaborator, title);

  expectStatus(
    await ctx.http("POST", `/me/jobs/${jobId}/reject`, { cookie, body: { reason: "location" } }),
    "Rejecting a job",
    204,
  );

  expectStatus(
    await ctx.http("DELETE", `/me/jobs/${jobId}/reject`, { cookie }),
    "Undoing a rejection",
    204,
  );

  const undone = (await readRejections(ctx, collaborator)).some((job) => job.id === jobId);

  expectStatus(
    await ctx.http("POST", `/me/jobs/${jobId}/reject`, {
      cookie,
      body: { reason: "salary", note: "Faixa abaixo do que busco." },
    }),
    "Rejecting a job",
    204,
  );

  ctx.log(
    `${collaborator.person.name} rejected ${title} for location, ${undone ? "the undo did not work" : "undid it"}, then rejected it for salary`,
  );
}

function aiConfigured(ctx: Context) {
  return Boolean(ctx.env.AI_GATEWAY_API_KEY || ctx.env.ANTHROPIC_API_KEY);
}

const scored = z.object({ score: z.number().nullable() });

const openSuggestions = z.array(z.object({ id: z.string(), rationale: z.string() }));

const drained = z.object({ processed: z.number(), failed: z.number() });

async function runScore(
  ctx: Context,
  collaborator: Collaborator,
  pollMs: number,
  timeoutMs: number,
) {
  const cookie = collaborator.session.cookie;
  const deadline = Date.now() + timeoutMs;

  let score = parseBody(
    expectStatus(
      await ctx.http("POST", "/me/resume/score/run", { cookie }),
      "Scoring the résumé",
      200,
    ),
    "Résumé score",
    scored,
  ).score;

  while (score === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));

    score = parseBody(
      expectStatus(await ctx.http("GET", "/me/resume", { cookie }), "Reading the résumé", 200),
      "Résumé score",
      scored,
    ).score;
  }

  return score;
}

export async function improveWithAi(
  ctx: Context,
  collaborator: Collaborator,
  pollMs = 500,
  timeoutMs = 90_000,
) {
  if (!aiConfigured(ctx)) {
    ctx.log("skipped: AI not configured");

    return "skipped" as const;
  }

  const cookie = collaborator.session.cookie;
  const before = await runScore(ctx, collaborator, pollMs, timeoutMs);

  ctx.log(`${collaborator.person.name} résumé score is ${before ?? "pending"}`);

  const secret = ctx.env.CRON_SECRET;

  if (secret) {
    const result = parseBody(
      expectStatus(
        await ctx.http("POST", "/background/drain", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        "Draining the background queue",
        200,
      ),
      "Drain",
      drained,
    );

    ctx.log(`job matching ran: ${result.processed} jobs processed, ${result.failed} failed`);
  } else {
    ctx.log(
      "skipped: job matching needs CRON_SECRET on the API and the runner (POST /background/drain)",
    );
  }

  const suggestions = parseBody(
    expectStatus(
      await ctx.http("GET", "/me/resume/suggestions", { cookie }),
      "Listing suggestions",
      200,
    ),
    "Suggestions",
    openSuggestions,
  );

  const first = suggestions.at(0);

  if (!first) {
    ctx.log("no open résumé suggestions to apply");

    return "done" as const;
  }

  expectStatus(
    await ctx.http("POST", `/me/resume/suggestions/${first.id}/apply`, { cookie }),
    "Applying a suggestion",
    200,
  );

  const after = await runScore(ctx, collaborator, pollMs, timeoutMs);

  ctx.log(`applied "${first.rationale}": score ${before ?? "pending"} -> ${after ?? "pending"}`);

  return "done" as const;
}

const attempt = z.object({ attempt: z.object({ state: z.string() }) });

const refusal = z.object({ error: z.string() }).nullable();

export async function draftAiApply(ctx: Context, collaborator: Collaborator, title: string) {
  if (!aiConfigured(ctx)) {
    ctx.log("skipped: AI not configured");

    return "skipped" as const;
  }

  const cookie = collaborator.session.cookie;

  expectStatus(
    await ctx.http("PUT", "/me/ai-apply/consent", { cookie, body: { accept: true } }),
    "Recording the AI Apply consent",
    200,
  );

  const jobId = await findJobId(ctx, collaborator, title);
  const reply = await ctx.http("POST", `/me/jobs/${jobId}/ai-apply`, { cookie });

  if (reply.status !== 200 && reply.status !== 201) {
    const reason = refusal.safeParse(reply.body);

    ctx.log(
      `skipped: AI Apply draft refused (${reply.status}${reason.success && reason.data ? `: ${reason.data.error}` : ""})`,
    );

    return "refused" as const;
  }

  const drafted = parseBody(reply, "AI Apply attempt", attempt);

  ctx.log(`AI Apply draft for ${title} is ${drafted.attempt.state}`);

  if (ctx.env.BROWSERBASE_API_KEY && ctx.env.BROWSERBASE_PROJECT_ID) {
    ctx.log("skipped: running the rehearsal is not driven by this runner");
  } else {
    ctx.log("skipped: Browserbase not configured, so the draft is not run");
  }

  return "drafted" as const;
}
