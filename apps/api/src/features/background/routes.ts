import { Elysia, t } from "elysia";
import { hasBearer } from "../../shared/machine-auth.js";
import { drain, type JobHandler } from "./drain.js";
import type { BackgroundRepository } from "./repository.js";

const drained = t.Object({ processed: t.Number(), failed: t.Number() });

export function backgroundRoutes(
  repo: BackgroundRepository,
  handlers: Record<string, JobHandler>,
  cronSecret: string | undefined,
  schedule: { beforeDrain: () => Promise<void>; isolated: { kind: string; budgetMs: number } },
) {
  const scheduledDrain = async () => {
    await schedule.beforeDrain();

    const { kind, budgetMs } = schedule.isolated;
    const others = await drain(repo, handlers, { excludeKinds: [kind] });
    const isolated = await drain(repo, handlers, { kinds: [kind], limit: 1, budgetMs });

    return {
      processed: others.processed + isolated.processed,
      failed: others.failed + isolated.failed,
    };
  };

  return new Elysia()
    .macro({
      machine: (_caller: "cron") => ({
        beforeHandle({ request, status }) {
          if (!hasBearer(request, cronSecret)) return status(401, { error: "Unauthorized" });
        },
      }),
    })
    .get("/background/drain", scheduledDrain, {
      machine: "cron",
      response: drained,
    })
    .post("/background/drain", scheduledDrain, {
      machine: "cron",
      response: drained,
    });
}
