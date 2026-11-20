import { listSearchSchema } from "@/shared/lib/list-search";
import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { equipmentStatus } from "@/features/asset-returns/status";

export const Route = createFileRoute("/bens-e-coleta")({
  validateSearch: listSearchSchema.extend({
    status: z.enum(Object.keys(equipmentStatus)).optional().catch(undefined),
  }),
  component: lazyRouteComponent(
    () => import("@/features/asset-returns/equipment-page"),
    "EquipmentPage",
  ),
  head: () => ({ meta: [{ title: "Bens e coleta · Offboard" }] }),
});
