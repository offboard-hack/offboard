import { Elysia, t } from "elysia";
import { hasBearer } from "../../shared/machine-auth.js";
import { drain, type JobHandler } from "./drain.js";
import type { BackgroundRepository } from "./repository.js";

const drained = t.Object({ processed: t.Number(), failed: t.Number() });

export function backgroundRoutes(
  repo: BackgroundRepository,
  handlers: Record<string, JobHandler>,
  cronSecret: string | undefined,
) {
  return new Elysia()
    .macro({
      machine: (_caller: "cron") => ({
        beforeHandle({ request, status }) {
          if (!hasBearer(request, cronSecret)) return status(401, { error: "Unauthorized" });
        },
      }),
    })
    .get("/background/drain", () => drain(repo, handlers), {
      machine: "cron",
      response: drained,
    })
    .post("/background/drain", () => drain(repo, handlers), {
      machine: "cron",
      response: drained,
    });
}
