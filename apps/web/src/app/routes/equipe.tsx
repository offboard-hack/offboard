import { teamQuery } from "@/entities/team";
import { listSearchSchema, teamListSearchSchema } from "@/shared/lib/list-search";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/equipe")({
  validateSearch: listSearchSchema.extend(teamListSearchSchema.shape),
  component: lazyRouteComponent(() => import("@/features/app-access/access-page"), "AccessPage"),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(teamQuery);
  },
  head: () => ({ meta: [{ title: "Equipe · Offboard" }] }),
});
