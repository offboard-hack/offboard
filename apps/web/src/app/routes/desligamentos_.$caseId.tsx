import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { offboardingsQuery } from "@/entities/offboarding";
import { Case, getCase } from "../portal";

export const Route = createFileRoute("/desligamentos_/$caseId")({
  validateSearch: z.object({ tasks: z.enum(["pending", "done"]).optional().catch(undefined) }),
  loader: async ({ context, params }) => {
    const cases = await context.queryClient.ensureQueryData(offboardingsQuery);

    return getCase(cases, params.caseId).name;
  },
  component: Case,
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData} · Offboard` : "Desligamento · Offboard" }],
  }),
});
