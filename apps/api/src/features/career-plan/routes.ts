import { Elysia, t } from "elysia";
import { errorResponse } from "../../shared/http.js";
import type { TalentAccessPlugin } from "../../shared/talent-access.js";
import type { CareerPlanRepository } from "./repository.js";

const nullableDate = t.Union([t.String(), t.Null()]);

const careerPlanResponse = t.Object({
  company: t.Object({
    name: t.Union([t.String(), t.Null()]),
    includesAiApply: t.Boolean(),
    sponsoredUntil: t.String(),
  }),
  individual: t.Union([
    t.Object({
      plan: t.Literal("carreira-pro"),
      status: t.Union([
        t.Literal("pending"),
        t.Literal("active"),
        t.Literal("past_due"),
        t.Literal("canceled"),
      ]),
      currentPeriodEnd: nullableDate,
    }),
    t.Null(),
  ]),
  aiApply: t.Object({
    allowedBy: t.Union([t.Literal("company"), t.Literal("individual"), t.Null()]),
  }),
  upgrade: t.Object({
    offered: t.Boolean(),
    priceCents: t.Number(),
    dailyLimit: t.Number(),
  }),
});

export function careerPlanRoutes(repos: CareerPlanRepository, talentAccess: TalentAccessPlugin) {
  return new Elysia()
    .use(talentAccess)
    .get(
      "/me/plan",
      async ({ me, status }) =>
        (await repos.plan(me.id, new Date())) ?? status(404, { error: "Profile not found" }),
      {
        talent: "active",
        response: { 200: careerPlanResponse, 404: errorResponse },
      },
    );
}
