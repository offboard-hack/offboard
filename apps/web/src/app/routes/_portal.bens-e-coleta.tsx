import { EquipmentPending } from "../route-pending";
import { listSearchSchema } from "@/shared/lib/list-search";
import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { equipmentQuery } from "@/entities/equipment";
import { offboardingsQuery } from "@/entities/offboarding";
import { equipmentStatusValues } from "@/features/asset-returns/status";

export const Route = createFileRoute("/_portal/bens-e-coleta")({
  validateSearch: listSearchSchema.extend({
    status: z.enum(equipmentStatusValues).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(offboardingsQuery),
      context.queryClient.ensureQueryData(equipmentQuery()),
    ]);
  },
  component: lazyRouteComponent(
    () => import("@/features/asset-returns/equipment-page"),
    "EquipmentPage",
  ),
  head: () => ({ meta: [{ title: "Bens e coleta · Offboard" }] }),
  pendingComponent: EquipmentPending,
});
