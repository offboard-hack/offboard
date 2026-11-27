import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import {
  benefitAssignmentsQuery,
  benefitPlansQuery,
  benefitPolicyQuery,
} from "@/entities/benefits";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/beneficios")({
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "read", "Billing"),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(benefitPolicyQuery),
      context.queryClient.ensureQueryData(benefitAssignmentsQuery),
      context.queryClient.ensureQueryData(benefitPlansQuery),
    ]);
  },
  component: lazyRouteComponent(() => import("@/features/benefits/benefits-page"), "BenefitsPage"),
  head: () => ({ meta: [{ title: "Benefícios · Offboard" }] }),
});
