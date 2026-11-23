import { listSearchSchema } from "@/shared/lib/list-search";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/planos-e-gastos")({
  validateSearch: listSearchSchema,
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Integrations"),
  component: lazyRouteComponent(() => import("@/features/billing/billing-page"), "PlansPage"),
  head: () => ({ meta: [{ title: "Planos e gastos · Offboard" }] }),
});
