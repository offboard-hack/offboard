import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { integrationsQuery } from "@/entities/integration";

export const Route = createFileRoute("/integracoes")({
  validateSearch: z.object({
    status: z.enum(["connected", "disconnected", "all"]).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(integrationsQuery);
  },
  component: lazyRouteComponent(
    () => import("@/features/integrations/integrations-page"),
    "IntegrationsPage",
  ),
  head: () => ({ meta: [{ title: "Integrações · Offboard" }] }),
});
