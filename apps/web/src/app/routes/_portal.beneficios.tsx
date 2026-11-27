import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_portal/beneficios")({
  beforeLoad: () => {
    throw redirect({ to: "/planos-e-gastos", search: { aba: "beneficios" }, replace: true });
  },
});
