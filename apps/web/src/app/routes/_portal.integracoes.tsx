import { IntegrationsPending } from "../route-pending";
import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { integrationsQuery } from "@/entities/integration";

import { requirePortalAccess } from "../portal-access";

export const Route = createFileRoute("/_portal/integracoes")({
  validateSearch: z.object({
    status: z.enum(["connected", "disconnected", "all"]).optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => requirePortalAccess(context.principal, "manage", "Integrations"),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(integrationsQuery);
  },
  component: lazyRouteComponent(
    () => import("@/features/integrations/integrations-page"),
    "IntegrationsPage",
  ),
  head: () => ({ meta: [{ title: "Integrações · Offboard" }] }),
  pendingComponent: IntegrationsPending,
});
