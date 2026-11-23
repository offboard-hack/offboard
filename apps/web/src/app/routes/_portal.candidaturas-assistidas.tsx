import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/_portal/candidaturas-assistidas")({
  head: () => ({ meta: [{ title: "Candidaturas assistidas · Offboard" }] }),
  component: lazyRouteComponent(
    () => import("@/features/transition-insights/insights-pages"),
    "ApplicationsPage",
  ),
});
