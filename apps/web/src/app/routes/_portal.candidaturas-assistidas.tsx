import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_portal/candidaturas-assistidas")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
