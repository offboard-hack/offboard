import { DashboardPending } from "../route-pending";
import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { offboardingTeams, offboardingsQuery } from "@/entities/offboarding";
import { deadlineGroups } from "@/features/dashboard/deadline";

export const Route = createFileRoute("/_portal/painel")({
  validateSearch: z.object({
    area: z.enum(offboardingTeams).optional().catch(undefined),
    deadline: z.enum(deadlineGroups).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(offboardingsQuery);
  },
  component: lazyRouteComponent(() => import("../dashboard-route"), "Dashboard"),
  head: () => ({ meta: [{ title: "Painel de desligamentos · Offboard" }] }),
  pendingComponent: DashboardPending,
});
