import { EquipmentPending } from "../route-pending";
import { listSearchSchema } from "@/shared/lib/list-search";
import { z } from "zod";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { offboardingsQuery } from "@/entities/offboarding";
import { equipmentReturnsQuery, equipmentStatus } from "@/entities/equipment-returns";

export const Route = createFileRoute("/_portal/bens-e-coleta")({
  validateSearch: listSearchSchema.extend({
    status: z.enum(Object.keys(equipmentStatus)).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(offboardingsQuery),
      context.queryClient.ensureQueryData(equipmentReturnsQuery),
    ]);
  },
  component: lazyRouteComponent(
    () => import("@/features/asset-returns/equipment-page"),
    "EquipmentPage",
  ),
  head: () => ({ meta: [{ title: "Bens e coleta · Offboard" }] }),
  pendingComponent: EquipmentPending,
});
