import type { BackgroundJob, BackgroundRepository } from "./repository.js";

export type JobHandler = (job: BackgroundJob) => Promise<void | { postponeUntil: Date }>;

async function run(handlers: Record<string, JobHandler>, job: BackgroundJob) {
  if (!Object.hasOwn(handlers, job.kind))
    return { ok: false, failure: "Unknown job kind" } as const;

  try {
    return { ok: true, outcome: await handlers[job.kind](job) } as const;
  } catch (error) {
    return { ok: false, failure: String(error) } as const;
  }
}

export async function drain(
  repo: BackgroundRepository,
  handlers: Record<string, JobHandler>,
  options: { limit?: number; budgetMs?: number; now?: () => number } = {},
) {
  const { limit = 5, budgetMs = 20_000, now = Date.now } = options;
  const startedAt = now();
  const jobs = await repo.claim(limit);
  let processed = 0;
  let failed = 0;

  for (const [index, job] of jobs.entries()) {
    if (now() - startedAt >= budgetMs) {
      for (const unstarted of jobs.slice(index)) await repo.postpone(unstarted.id, new Date());

      break;
    }

    const result = await run(handlers, job);

    if (!result.ok) {
      await repo.retry(job.id, result.failure, job.attempts);
      failed += 1;
    } else {
      if (result.outcome) await repo.postpone(job.id, result.outcome.postponeUntil);
      else await repo.complete(job.id);
      processed += 1;
    }
  }

  return { processed, failed };
}
