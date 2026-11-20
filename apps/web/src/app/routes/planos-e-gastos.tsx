import { listSearchSchema } from "@/shared/lib/list-search";
import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/planos-e-gastos")({
  validateSearch: listSearchSchema,
  component: lazyRouteComponent(() => import("@/features/billing/billing-page"), "PlansPage"),
  head: () => ({ meta: [{ title: "Planos e gastos · Offboard" }] }),
});
