import { Elysia } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { saveChecklistSchema } from "../../shared/checklist.js";
import type { ChecklistRepository } from "./repository.js";

export function checklistRoutes(repos: ChecklistRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get("/checklist-model", ({ principal }) => repos.readChecklist(principal.orgId), {
      permit: ["manage", "Integrations"],
    })
    .put(
      "/checklist-model",
      async ({ body, principal, status }) =>
        (await repos.saveChecklist(principal.orgId, body)) ??
        status(409, { error: "Checklist changed" }),
      { permit: ["manage", "Integrations"], body: saveChecklistSchema },
    );
}
