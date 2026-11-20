import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/integracoes")({
  validateSearch: z.object({
    status: z.enum(["connected", "disconnected"]).optional().catch(undefined),
  }),
  component: lazyRouteComponent(
    () => import("@/features/integrations/integrations-page"),
    "IntegrationsPage",
  ),
  head: () => ({ meta: [{ title: "Integrações · Offboard" }] }),
});
