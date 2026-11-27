import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { automationRulesQuery } from "@/entities/automation-rule";

import { requirePortalAccess } from "../portal-access";
import { AutomationsPending } from "../route-pending";

export const Route = createFileRoute("/_portal/automacoes")({
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Integrations"),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(automationRulesQuery);
  },
  component: lazyRouteComponent(
    () => import("@/features/automations/automations-page"),
    "AutomationsPage",
  ),
  head: () => ({ meta: [{ title: "Automações · Offboard" }] }),
  pendingComponent: AutomationsPending,
});
