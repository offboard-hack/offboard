import { z } from "zod";
import { expectStatus, parseBody, type Context } from "./context.js";
import { aiConfigured } from "./steps-career.js";
import type { Collaborator } from "./steps.js";

const jobPage = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      company: z.string(),
      aiApplyCapable: z.boolean(),
      applied: z.boolean(),
    }),
  ),
  total: z.number(),
  pageSize: z.number(),
});

type PageJob = z.infer<typeof jobPage>["items"][number];

const answerValue = z.union([z.string(), z.array(z.string()), z.null()]);

const attemptView = z.object({
  id: z.string(),
  job: z.object({ id: z.string(), title: z.string(), company: z.string() }),
  state: z.string(),
  reason: z.string().nullable(),
  rehearsal: z.boolean(),
  hasScreenshot: z.boolean(),
  liveUrl: z.string().nullable(),
  questions: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      required: z.boolean(),
      fields: z.array(
        z.object({ type: z.string(), options: z.array(z.object({ value: z.string() })) }),
      ),
    }),
  ),
  answers: z.array(z.object({ questionId: z.string(), value: answerValue })),
});

type Attempt = z.infer<typeof attemptView>;

const attemptReply = z.object({ attempt: attemptView });

const attemptList = z.object({ items: z.array(attemptView) });

const refusal = z.object({ error: z.string() }).nullable();

const drained = z.object({ processed: z.number(), failed: z.number() });

const fileKinds = new Set(["resume", "cover_letter", "document"]);

const live = new Set(["queued", "running"]);

const maxCandidates = 3;

export function rehearsalGap(env: Record<string, string | undefined>) {
  if (!aiConfigured(env)) return "AI not configured";

  if (!env.BROWSERBASE_API_KEY || !env.BROWSERBASE_PROJECT_ID) return "Browserbase not configured";

  if (!env.CRON_SECRET) return "CRON_SECRET not set, so the job sources cannot be synced";

  return undefined;
}

export function capableJobs(items: PageJob[]) {
  return items.filter((job) => job.aiApplyCapable && !job.applied);
}

export function rehearsalStatus(state: string) {
  if (state === "submitted" || state === "submitting") {
    throw new Error(`The rehearsal reached ${state}; it must never submit`);
  }

  return state === "assisted" ? "blocked" : state;
}

function placeholder(question: Attempt["questions"][number]) {
  if (!question.required) return null;

  const [field] = question.fields;
  const [first] = field?.options ?? [];

  if (field?.type === "multi_select") return first ? [first.value] : null;

  if (field?.type === "single_select") return first ? first.value : null;

  return "Não se aplica";
}

export function rehearsalAnswers(attempt: Attempt) {
  const drafted = new Map(attempt.answers.map((answer) => [answer.questionId, answer.value]));

  return attempt.questions
    .filter(
      (question) =>
        !fileKinds.has(question.kind) &&
        !(question.fields.length > 0 && question.fields.every((field) => field.type === "hidden")),
    )
    .map((question) => ({
      questionId: question.id,
      value: drafted.get(question.id) ?? placeholder(question),
    }));
}

export async function findCandidates(ctx: Context, cookie: string) {
  const found: PageJob[] = [];

  for (let page = 1; found.length < maxCandidates; page += 1) {
    const jobs = parseBody(
      expectStatus(
        await ctx.http("GET", `/me/jobs?view=all&page=${page}`, { cookie }),
        "Listing jobs",
        200,
      ),
      "Jobs",
      jobPage,
    );

    found.push(...capableJobs(jobs.items));

    if (page * jobs.pageSize >= jobs.total) break;
  }

  return found.slice(0, maxCandidates);
}

async function readAttempt(ctx: Context, collaborator: Collaborator, id: string) {
  return parseBody(
    expectStatus(
      await ctx.http("GET", `/me/ai-applications/${id}`, { cookie: collaborator.session.cookie }),
      "Reading the AI Apply attempt",
      200,
    ),
    "AI Apply attempt",
    attemptView,
  );
}

async function draftFor(ctx: Context, collaborator: Collaborator, jobs: PageJob[]) {
  const open = parseBody(
    expectStatus(
      await ctx.http("GET", "/me/ai-applications", { cookie: collaborator.session.cookie }),
      "Listing AI Apply attempts",
      200,
    ),
    "AI Apply attempts",
    attemptList,
  ).items.filter((item) => item.state === "draft" || item.state === "rehearsed");

  const existing = open.find((item) => jobs.some((job) => job.id === item.job.id));

  if (existing) return existing;

  for (const job of jobs) {
    const reply = await ctx.http("POST", `/me/jobs/${job.id}/ai-apply`, {
      cookie: collaborator.session.cookie,
    });

    if (reply.status === 200 || reply.status === 201) {
      return parseBody(reply, "AI Apply attempt", attemptReply).attempt;
    }

    const reason = refusal.safeParse(reply.body);

    ctx.log(
      `${job.title} at ${job.company}: draft refused (${reply.status}${reason.success && reason.data ? `: ${reason.data.error}` : ""})`,
    );
  }

  return undefined;
}

async function settle(
  ctx: Context,
  collaborator: Collaborator,
  first: Attempt,
  pollMs: number,
  timeoutMs: number,
) {
  const cookie = collaborator.session.cookie;
  const deadline = Date.now() + timeoutMs;
  let attempt = first;
  let announced = false;

  while (live.has(attempt.state) && Date.now() < deadline) {
    if (attempt.state === "queued") {
      await ctx.http("POST", `/me/ai-applications/${attempt.id}/run`, { cookie });
    }

    attempt = await readAttempt(ctx, collaborator, attempt.id);

    if (attempt.liveUrl !== null && !announced) {
      announced = true;
      ctx.log(`live view: ${attempt.liveUrl}`);
    }

    if (live.has(attempt.state)) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return attempt;
}

export async function rehearseAiApply(
  ctx: Context,
  collaborator: Collaborator,
  pollMs = 2_000,
  timeoutMs = 240_000,
) {
  const gap = rehearsalGap(ctx.env);

  if (gap !== undefined) {
    ctx.log(`skipped: ${gap}`);

    return "skipped" as const;
  }

  const cookie = collaborator.session.cookie;

  expectStatus(
    await ctx.http("PUT", "/me/ai-apply/consent", { cookie, body: { accept: true } }),
    "Recording the AI Apply consent",
    200,
  );

  const result = parseBody(
    expectStatus(
      await ctx.http("POST", "/background/drain", {
        headers: { authorization: `Bearer ${ctx.env.CRON_SECRET}` },
      }),
      "Draining the background queue",
      200,
    ),
    "Drain",
    drained,
  );

  ctx.log(`job sources synced: ${result.processed} jobs processed, ${result.failed} failed`);

  const candidates = await findCandidates(ctx, cookie);

  if (candidates.length === 0) {
    ctx.log("skipped: no synced job has aiApplyCapable set");

    return "skipped" as const;
  }

  const drafted = await draftFor(ctx, collaborator, candidates);

  if (drafted === undefined) {
    ctx.log("skipped: no Greenhouse job had a readable form this collaborator could draft");

    return "refused" as const;
  }

  ctx.log(`AI Apply draft for ${drafted.job.title} at ${drafted.job.company} is ${drafted.state}`);

  let attempt = drafted;

  if (drafted.state === "draft" || drafted.state === "rehearsed") {
    const confirmed = await ctx.http("POST", `/me/ai-applications/${drafted.id}/confirm`, {
      cookie,
      body: { answers: rehearsalAnswers(drafted), rehearsal: true },
    });

    if (confirmed.status !== 200) {
      const reason = refusal.safeParse(confirmed.body);

      ctx.log(
        `skipped: the rehearsal was refused (${confirmed.status}${reason.success && reason.data ? `: ${reason.data.error}` : ""})`,
      );

      return "refused" as const;
    }

    attempt = parseBody(confirmed, "AI Apply attempt", attemptView);

    if (!attempt.rehearsal) throw new Error("The confirmed attempt is not a rehearsal");
  }

  attempt = await settle(ctx, collaborator, attempt, pollMs, timeoutMs);

  const status = live.has(attempt.state) ? "pending" : rehearsalStatus(attempt.state);

  ctx.log(
    `AI Apply rehearsal for ${attempt.job.title} at ${attempt.job.company}: ${status}${attempt.reason === null ? "" : ` (${attempt.reason})`}`,
  );

  if (attempt.hasScreenshot) {
    ctx.log(`screenshot: /api/me/ai-applications/${attempt.id}/screenshot`);
  }

  return status;
}
