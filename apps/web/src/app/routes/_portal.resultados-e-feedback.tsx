import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { exitSurveyAggregatesQuery } from "@/entities/exit-survey";

export const Route = createFileRoute("/_portal/resultados-e-feedback")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(exitSurveyAggregatesQuery);
  },
  head: () => ({ meta: [{ title: "Resultados e feedback · Offboard" }] }),
  component: lazyRouteComponent(
    () => import("@/features/transition-insights/insights-pages"),
    "FeedbackPage",
  ),
});
