import { listSearchSchema, teamListSearchSchema } from "@/shared/lib/list-search";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/acessos-ao-app")({
  validateSearch: listSearchSchema.extend(teamListSearchSchema.shape),
  component: lazyRouteComponent(() => import("@/features/app-access/access-page"), "AccessPage"),
  head: () => ({ meta: [{ title: "Acessos ao app · Offboard" }] }),
});
