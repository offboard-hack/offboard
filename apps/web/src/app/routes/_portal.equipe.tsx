import { TeamPending } from "../route-pending";
import { teamQuery } from "@/entities/team";
import { listSearchSchema } from "@/shared/lib/list-search";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/equipe")({
  validateSearch: listSearchSchema,
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Team"),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(teamQuery);
  },
  component: lazyRouteComponent(() => import("@/features/app-access/access-page"), "AccessPage"),
  head: () => ({ meta: [{ title: "Equipe · Offboard" }] }),
  pendingComponent: TeamPending,
});
