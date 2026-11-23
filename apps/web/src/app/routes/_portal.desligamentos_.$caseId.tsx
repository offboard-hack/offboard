import { CasePending } from "../route-pending";
import { z } from "zod";
import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";
import { offboardingQuery } from "@/entities/offboarding";

export const Route = createFileRoute("/_portal/desligamentos_/$caseId")({
  validateSearch: z.object({ tasks: z.enum(["pending", "done"]).optional().catch(undefined) }),
  loader: async ({ context, params }) => {
    if (!z.guid().safeParse(params.caseId).success) throw notFound();

    const result = await context.queryClient.ensureQueryData(
      offboardingQuery(params.caseId, context.queryClient),
    );

    if (!result) throw notFound();

    return result.name;
  },
  component: lazyRouteComponent(() => import("../case-route"), "Case"),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData} · Offboard` : "Desligamento · Offboard" }],
  }),
  pendingComponent: CasePending,
});
