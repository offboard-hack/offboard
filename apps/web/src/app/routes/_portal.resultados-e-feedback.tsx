import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { exitSurveyAggregatesQuery, exitSurveyCommentsQuery } from "@/entities/exit-survey";

export const Route = createFileRoute("/_portal/resultados-e-feedback")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(exitSurveyAggregatesQuery),
      context.queryClient.ensureQueryData(exitSurveyCommentsQuery),
    ]);
  },
  head: () => ({ meta: [{ title: "Resultados e feedback · Offboard" }] }),
  component: lazyRouteComponent(
    () => import("@/features/transition-insights/insights-pages"),
    "FeedbackPage",
  ),
});
