import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/candidaturas-assistidas")({
  head: () => ({ meta: [{ title: "Candidaturas assistidas · Offboard" }] }),
  component: lazyRouteComponent(
    () => import("@/features/transition-insights/insights-pages"),
    "ApplicationsPage",
  ),
});
