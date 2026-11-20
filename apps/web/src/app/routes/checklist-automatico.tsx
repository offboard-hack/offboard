import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/checklist-automatico")({
  head: () => ({ meta: [{ title: "Checklist automático · Offboard" }] }),
  component: lazyRouteComponent(
    () => import("@/features/checklist/checklist-page"),
    "ChecklistRulesPage",
  ),
});
