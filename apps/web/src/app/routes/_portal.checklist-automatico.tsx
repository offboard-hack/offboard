import { actionConfigsQuery } from "@/features/checklist/action-config";
import { ChecklistPending } from "@/features/checklist/checklist-pending";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/checklist-automatico")({
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Integrations"),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(actionConfigsQuery);
  },
  component: lazyRouteComponent(
    () => import("@/features/checklist/checklist-page"),
    "ChecklistRulesPage",
  ),
  head: () => ({ meta: [{ title: "Checklist automático · Offboard" }] }),
  pendingComponent: ChecklistPending,
});
