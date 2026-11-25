import { Elysia, t } from "elysia";
import type { PortalAccessPlugin } from "../../shared/access.js";
import type { InsightsRepository } from "./repository.js";

const suppressedCount = t.Union([t.Integer(), t.Null()]);

const talentAggregatesResponse = t.Object({
  enabled: t.Integer(),
  activated: suppressedCount,
  funnel: t.Object({
    sent: suppressedCount,
    responded: suppressedCount,
    interviews: suppressedCount,
    offers: suppressedCount,
  }),
  hiresShared: suppressedCount,
  topJobs: t.Array(t.Object({ title: t.String(), company: t.String(), applications: t.Integer() })),
});

export function insightsRoutes(repos: InsightsRepository, access: PortalAccessPlugin) {
  return new Elysia().use(access).get("/talent/aggregates", () => repos.aggregates(), {
    permit: ["read", "TalentAggregates"],
    response: talentAggregatesResponse,
  });
}
