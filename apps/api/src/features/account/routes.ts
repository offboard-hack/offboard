import { Elysia, t } from "elysia";
import { errorResponse } from "../../shared/http.js";
import type { ObjectStorage } from "../../shared/object-storage.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import type { AccountRepository } from "./repository.js";

const nullable = t.Union([t.String(), t.Null()]);

const exportResponse = t.Object({
  profile: t.Object({
    name: t.String(),
    email: t.String(),
    sponsoredUntil: nullable,
    termsAcceptedAt: nullable,
    shareOutcomeWithHr: t.Boolean(),
    firstSignedInAt: nullable,
    createdAt: nullable,
  }),
  resumes: t.Array(
    t.Object({
      kind: t.String(),
      status: t.String(),
      content: t.Unknown(),
      score: t.Union([t.Number(), t.Null()]),
      scoredAt: nullable,
      updatedAt: t.String(),
      suggestions: t.Array(
        t.Object({
          originalText: t.String(),
          suggestedText: t.String(),
          rationale: t.String(),
          estimatedGain: t.Number(),
          status: t.String(),
          createdAt: nullable,
        }),
      ),
    }),
  ),
  applications: t.Array(
    t.Object({
      status: t.String(),
      closedReason: nullable,
      appliedAt: t.String(),
      job: t.Object({ title: t.String(), company: t.String(), url: t.String() }),
      events: t.Array(
        t.Object({ status: t.String(), closedReason: nullable, createdAt: t.String() }),
      ),
      interviews: t.Array(
        t.Object({ startsAt: t.String(), mode: t.String(), with: t.String(), notes: t.String() }),
      ),
    }),
  ),
});

export function accountRoutes(
  repos: AccountRepository,
  talentAccess: TalentAccessPlugin,
  storage: ObjectStorage | undefined,
) {
  return new Elysia()
    .use(talentAccess)
    .get(
      "/me/export",
      async ({ me, set, status }) => {
        const data = await repos.exportData(me.id);

        if (!data) return status(404, { error: "Profile not found" });

        set.headers["content-disposition"] = 'attachment; filename="offboard-dados.json"';

        return data;
      },
      {
        talent: "signed-in",
        response: { 200: exportResponse, 404: errorResponse },
      },
    )
    .delete(
      "/me",
      async ({ me, status }) => {
        if (storage) {
          try {
            await storage.removePrefix(`resumes/${me.id}/`);
          } catch {
            return status(502, { error: "Could not delete stored files" });
          }
        } else if ((await repos.fileKeys(me.id)).length > 0) {
          return status(503, { error: "File storage not configured" });
        }

        await repos.deleteProfile(me.id);

        return new Response(null, { status: 204 });
      },
      {
        talent: "signed-in",
        response: {
          204: t.Void(),
          502: errorResponse,
          503: errorResponse,
        },
      },
    );
}
