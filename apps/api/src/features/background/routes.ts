import { Elysia, t } from "elysia";
import { hasBearer } from "../../shared/machine-auth.js";
import { drain, type JobHandler } from "./drain.js";
import type { BackgroundRepository } from "./repository.js";

const drained = t.Object({ processed: t.Number(), failed: t.Number() });

export function backgroundRoutes(
  repo: BackgroundRepository,
  handlers: Record<string, JobHandler>,
  cronSecret: string | undefined,
  beforeDrain?: () => Promise<void>,
) {
  const scheduledDrain = async () => {
    await beforeDrain?.();

    return drain(repo, handlers);
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
