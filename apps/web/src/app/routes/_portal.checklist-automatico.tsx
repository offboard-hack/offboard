import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/checklist-automatico")({
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Integrations"),
  head: () => ({ meta: [{ title: "Checklist automático · Offboard" }] }),
  component: lazyRouteComponent(
    () => import("@/features/checklist/checklist-page"),
    "ChecklistRulesPage",
  ),
});
