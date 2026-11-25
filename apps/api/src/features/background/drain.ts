import type { BackgroundJob, BackgroundRepository, ClaimFilter } from "./repository.js";

export type JobHandler = (
  job: BackgroundJob,
) => Promise<void | { postponeUntil: Date } | { skipped: true }>;

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
  options: { limit?: number; budgetMs?: number; now?: () => number } & ClaimFilter = {},
) {
  const { limit = 5, budgetMs = 20_000, now = Date.now, ...filter } = options;
  const startedAt = now();
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  while (processed - skipped + failed < limit && now() - startedAt < budgetMs) {
    const [job] = await repo.claim(1, undefined, filter);

    if (!job) break;

    const result = await run(handlers, job);

    if (!result.ok) {
      await repo.retry(job, result.failure);
      failed += 1;
    } else {
      const { outcome } = result;

      if (outcome && "postponeUntil" in outcome) await repo.postpone(job, outcome.postponeUntil);
      else await repo.complete(job);

      if (outcome && "skipped" in outcome) skipped += 1;

      processed += 1;
    }
  }

  return { processed, failed };
}
