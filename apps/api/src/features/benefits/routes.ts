import { Elysia, t } from "elysia";
import { z } from "zod";
import { benefitRuleSchema } from "../../shared/benefit-rules.js";
import type { PortalAccessPlugin } from "../../shared/access.js";
import { errorResponse } from "../../shared/http.js";
import { saoPauloDate } from "../../shared/sao-paulo-date.js";
import type { BenefitRepository } from "./repository.js";

const defaultDurationMonths = 6;

const policyBody = z.object({
  defaultPlanId: z.string().uuid().nullable(),
  benefitDurationMonths: z.int().min(1).max(24),
  rules: z.array(benefitRuleSchema).max(100),
});

const policyRow = t.Object({
  defaultPlanId: t.Nullable(t.String()),
  benefitDurationMonths: t.Number(),
  rules: t.Array(
    t.Object({
      id: t.String(),
      field: t.Union([t.Literal("department"), t.Literal("role")]),
      operator: t.Union([t.Literal("equals"), t.Literal("notEquals"), t.Literal("contains")]),
      value: t.String(),
      planId: t.String(),
    }),
  ),
});

const assignmentRow = t.Object({
  id: t.String(),
  profileId: t.String(),
  profileName: t.String(),
  assignedPlanName: t.String(),
  effectivePlanName: t.String(),
  source: t.Union([t.Literal("default"), t.Literal("rule"), t.Literal("manual")]),
  validUntil: t.String(),
});

const idRow = t.Object({ id: t.String() });

function addMonths(date: string, months: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCMonth(result.getUTCMonth() + months);

  return result.toISOString().slice(0, 10);
}

export function benefitRoutes(repos: BenefitRepository, access: PortalAccessPlugin) {
  return new Elysia()
    .use(access)
    .get(
      "/benefit-policy",
      async ({ principal, status }) =>
        (await repos.getPolicy(principal.orgId)) ?? status(404, { error: "No benefit policy" }),
      {
        permit: ["read", "Billing"],
        response: { 200: policyRow, 404: errorResponse },
      },
    )
    .put(
      "/benefit-policy",
      async ({ body, principal, status }) => {
        const prices = await repos.planPriceMap();
        const planIds = [body.defaultPlanId, ...body.rules.map((rule) => rule.planId)];

        if (planIds.some((planId) => planId !== null && !prices.has(planId))) {
          return status(422, { error: "Unknown plan" });
        }

        await repos.savePolicy(principal.orgId, body);

        return new Response(null, { status: 204 });
      },
      {
        permit: ["manage", "Billing"],
        body: policyBody,
        response: { 204: t.Void(), 422: errorResponse },
      },
    )
    .get("/benefit-assignments", ({ principal }) => repos.listAssignments(principal.orgId), {
      permit: ["read", "Billing"],
      response: t.Array(assignmentRow),
    })
    .post(
      "/benefit-assignments",
      async ({ body, principal, set, status }) => {
        const prices = await repos.planPriceMap();

        if (!prices.has(body.planId)) return status(422, { error: "Unknown plan" });

        if (!(await repos.profileInOrg(principal.orgId, body.profileId))) {
          return status(404, { error: "Profile not found" });
        }

        const policy = await repos.getPolicy(principal.orgId);

        const validUntil = addMonths(
          saoPauloDate(new Date()),
          policy?.benefitDurationMonths ?? defaultDurationMonths,
        );

        const created = await repos.upsertAssignment({
          orgId: principal.orgId,
          profileId: body.profileId,
          assignedPlanId: body.planId,
          effectivePlanId: body.planId,
          source: "manual",
          validUntil,
        });

        set.status = 201;

        return created;
      },
      {
        permit: ["manage", "Billing"],
        body: t.Object({
          profileId: t.String({ format: "uuid" }),
          planId: t.String({ format: "uuid" }),
          source: t.Optional(t.Literal("manual")),
        }),
        response: { 201: idRow, 404: errorResponse, 422: errorResponse },
      },
    )
    .put(
      "/benefit-assignments/:id",
      async ({ params, body, principal, status }) => {
        const prices = await repos.planPriceMap();

        if (!prices.has(body.planId)) return status(422, { error: "Unknown plan" });

        const assignments = await repos.listAssignments(principal.orgId);
        const existing = assignments.find((assignment) => assignment.id === params.id);

        if (!existing) return status(404, { error: "Assignment not found" });

        return repos.upsertAssignment({
          orgId: principal.orgId,
          profileId: existing.profileId,
          assignedPlanId: body.planId,
          effectivePlanId: body.planId,
          source: "manual",
          validUntil: existing.validUntil,
        });
      },
      {
        permit: ["manage", "Billing"],
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        body: t.Object({ planId: t.String({ format: "uuid" }) }),
        response: { 200: idRow, 404: errorResponse, 422: errorResponse },
      },
    );
}
