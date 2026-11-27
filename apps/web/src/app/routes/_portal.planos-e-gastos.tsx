import { createPortalAbility } from "@offboard/access";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import {
  benefitAssignmentsQuery,
  benefitPlansQuery,
  benefitPolicyQuery,
} from "@/entities/benefits";
import { invoicesQuery, plansQuery, subscriptionQuery } from "@/entities/billing";

import { requirePortalAccess } from "../portal-access";
import { spendingSearchSchema } from "../spending-tabs";

export const Route = createFileRoute("/_portal/planos-e-gastos")({
  validateSearch: spendingSearchSchema,
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "read", "Billing"),
  loader: async ({ context }) => {
    const ability = createPortalAbility(context.principal.role);
    await Promise.all([
      ...(ability.can("manage", "Integrations")
        ? [
            context.queryClient.ensureQueryData(plansQuery),
            context.queryClient.ensureQueryData(subscriptionQuery),
            context.queryClient.ensureQueryData(invoicesQuery),
          ]
        : []),
      context.queryClient.ensureQueryData(benefitPolicyQuery),
      context.queryClient.ensureQueryData(benefitAssignmentsQuery),
      context.queryClient.ensureQueryData(benefitPlansQuery),
    ]);
  },
  component: lazyRouteComponent(() => import("../spending-page"), "SpendingPage"),
  head: () => ({ meta: [{ title: "Planos e gastos · Offboard" }] }),
});
