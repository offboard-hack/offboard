import { listSearchSchema } from "@/shared/lib/list-search";
import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import {
  caseStatusLabels,
  offboardingDepartments,
  offboardingTeams,
  offboardingsQuery,
} from "@/entities/offboarding";
import { Cases } from "../portal";

export const Route = createFileRoute("/desligamentos")({
  validateSearch: listSearchSchema.extend({
    area: z.enum(offboardingDepartments).optional().catch(undefined),
    status: z.enum(Object.keys(caseStatusLabels)).optional().catch(undefined),
    team: z.enum(offboardingTeams).optional().catch(undefined),
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(offboardingsQuery);
  },
  component: Cases,
  head: () => ({ meta: [{ title: "Desligamentos · Offboard" }] }),
});
