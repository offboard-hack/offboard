import { CasesPending } from "../route-pending";
import { listSearchSchema } from "@/shared/lib/list-search";
import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { caseStatusLabels, offboardingTeams, offboardingsQuery } from "@/entities/offboarding";

export const Route = createFileRoute("/_portal/desligamentos")({
  validateSearch: listSearchSchema.extend({
    area: z.string().trim().min(1).optional().catch(undefined),
    status: z.enum(Object.keys(caseStatusLabels)).optional().catch(undefined),
    team: z.enum(offboardingTeams).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(offboardingsQuery);
  },
  component: lazyRouteComponent(() => import("../cases-route"), "Cases"),
  head: () => ({ meta: [{ title: "Desligamentos · Offboard" }] }),
  pendingComponent: CasesPending,
});
