import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { offboardingTeams, offboardingsQuery } from "@/entities/offboarding";
import { deadlineGroups } from "@/features/dashboard/deadline";
import { Dashboard } from "../portal";

export const Route = createFileRoute("/painel")({
  validateSearch: z.object({
    area: z.enum(offboardingTeams).optional().catch(undefined),
    deadline: z.enum(deadlineGroups).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(offboardingsQuery);
  },
  component: Dashboard,
  head: () => ({ meta: [{ title: "Painel de desligamentos · Offboard" }] }),
});
