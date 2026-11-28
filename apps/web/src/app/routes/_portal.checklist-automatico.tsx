import { checklistRulesQueryByOrg } from "@/features/checklist/checklist-rules";
import { checklistModelQuery } from "@/features/checklist/checklist-model";
import { ChecklistPending } from "@/features/checklist/checklist-pending";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/checklist-automatico")({
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Integrations"),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(checklistRulesQueryByOrg(context.principal.orgId)),
      context.queryClient.ensureQueryData(checklistModelQuery(context.principal.orgId)),
    ]);
  },
  component: lazyRouteComponent(
    () => import("@/features/checklist/checklist-page"),
    "ChecklistRulesPage",
  ),
  head: () => ({ meta: [{ title: "Checklist automático · Offboard" }] }),
  pendingComponent: ChecklistPending,
});
