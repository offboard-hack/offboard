import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { invoicesQuery, plansQuery, subscriptionQuery } from "@/entities/billing";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/planos-e-gastos")({
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Integrations"),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(plansQuery),
      context.queryClient.ensureQueryData(subscriptionQuery),
      context.queryClient.ensureQueryData(invoicesQuery),
    ]);
  },
  component: lazyRouteComponent(() => import("@/features/billing/billing-page"), "PlansPage"),
  head: () => ({ meta: [{ title: "Planos e gastos · Offboard" }] }),
});
