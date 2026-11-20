import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/resultados-e-feedback")({
  head: () => ({ meta: [{ title: "Resultados e feedback · Offboard" }] }),
  component: lazyRouteComponent(
    () => import("@/features/transition-insights/insights-pages"),
    "FeedbackPage",
  ),
});
