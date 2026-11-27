import { Elysia, t } from "elysia";
import { logFailureCode } from "../../shared/error-summary.js";
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
    aiApplyConsentAt: nullable,
    aiApplyConsentVersion: nullable,
    searchableAt: nullable,
    firstSignedInAt: nullable,
    createdAt: nullable,
  }),
  resumes: t.Array(
    t.Object({
      kind: t.String(),
      status: t.String(),
      content: t.Unknown(),
      score: t.Union([t.Number(), t.Null()]),
      scoreBreakdown: t.Union([
        t.Record(t.String(), t.Object({ points: t.Number(), max: t.Number(), reason: t.String() })),
        t.Null(),
      ]),
      scoredAt: nullable,
      updatedAt: t.String(),
      job: t.Union([
        t.Object({ title: t.String(), company: t.String(), url: t.String() }),
        t.Null(),
      ]),
      matchScore: t.Union([t.Number(), t.Null()]),
      suggestions: t.Array(
        t.Object({
          originalText: t.String(),
          suggestedText: t.String(),
          rationale: t.String(),
          criterion: nullable,
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
      channel: t.Union([t.Literal("manual"), t.Literal("ai_apply")]),
      appliedAt: t.String(),
      job: t.Object({ title: t.String(), company: t.String(), url: t.String() }),
      resume: t.Union([
        t.Object({
          kind: t.Union([t.Literal("base"), t.Literal("tailored")]),
          job: t.Union([t.Object({ title: t.String(), company: t.String() }), t.Null()]),
        }),
        t.Null(),
      ]),
      events: t.Array(
        t.Object({ status: t.String(), closedReason: nullable, createdAt: t.String() }),
      ),
      interviews: t.Array(
        t.Object({ startsAt: t.String(), mode: t.String(), with: t.String(), notes: t.String() }),
      ),
    }),
  ),
  matches: t.Array(
    t.Object({
      job: t.Object({ title: t.String(), company: t.String(), url: t.String() }),
      score: t.Number(),
      reasons: t.Array(t.String()),
      computedAt: t.String(),
    }),
  ),
  page: t.Union([
    t.Object({
      slug: t.String(),
      enabled: t.Boolean(),
      resume: t.Union([
        t.Object({
          kind: t.Union([t.Literal("base"), t.Literal("tailored")]),
          job: t.Union([t.Object({ title: t.String(), company: t.String() }), t.Null()]),
        }),
        t.Null(),
      ]),
      createdAt: nullable,
      updatedAt: nullable,
    }),
    t.Null(),
  ]),
  pageViews: t.Array(
    t.Object({ day: t.String(), visits: t.Number(), recruiterVisits: t.Number() }),
  ),
  preferences: t.Unknown(),
  rejections: t.Array(
    t.Object({
      job: t.Object({ id: t.String(), title: t.String(), company: t.String() }),
      reason: t.String(),
      note: nullable,
      createdAt: nullable,
    }),
  ),
  aiApplications: t.Array(
    t.Object({
      job: t.Object({ id: t.String(), title: t.String(), company: t.String() }),
      state: t.String(),
      reason: nullable,
      answers: t.Array(
        t.Object({
          question: t.String(),
          value: t.Union([t.String(), t.Array(t.String()), t.Null()]),
        }),
      ),
      preparedAt: t.String(),
      confirmedAt: nullable,
      finishedAt: nullable,
      evidence: t.Union([
        t.Object({
          fields: t.Array(
            t.Object({
              question: t.String(),
              value: t.Union([t.String(), t.Array(t.String()), t.Null()]),
            }),
          ),
          files: t.Array(t.String()),
          finalUrl: nullable,
        }),
        t.Null(),
      ]),
    }),
  ),
  answers: t.Array(t.Object({ question: t.String(), answer: t.String(), updatedAt: nullable })),
  packages: t.Array(
    t.Object({
      job: t.Object({ id: t.String(), title: t.String(), company: t.String() }),
      coverLetter: t.String(),
      updatedAt: nullable,
    }),
  ),
  careerSubscription: t.Union([
    t.Object({
      plan: t.String(),
      status: t.String(),
      currentPeriodEnd: nullable,
      createdAt: nullable,
      updatedAt: nullable,
    }),
    t.Null(),
  ]),
});

type SubscriptionGateway = {
  configured: boolean;
  cancelSubscription(id: string): Promise<void>;
};

export function accountRoutes(
  repos: AccountRepository,
  talentAccess: TalentAccessPlugin,
  storage: ObjectStorage | undefined,
  gateway: SubscriptionGateway,
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
        const subscriptionId = await repos.cancelableSubscription(me.id);

        if (subscriptionId !== null) {
          if (!gateway.configured) return status(503, { error: "Billing not configured" });

          try {
            await gateway.cancelSubscription(subscriptionId);
          } catch (cause) {
            logFailureCode("Carreira Pro cancellation failed")(cause);

            return status(502, { error: "Could not cancel Carreira Pro; try again" });
          }

          await repos.markSubscriptionCanceled(me.id, subscriptionId);
        }

        if (storage) {
          try {
            await storage.removePrefix(`resumes/${me.id}/`);
            await storage.removePrefix(`ai-applications/${me.id}/`);
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
