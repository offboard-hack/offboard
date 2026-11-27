import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConfirmContactPage } from "@/features/candidate-search/confirm-contact-page";

export const Route = createFileRoute("/busca-candidato_/confirmar")({
  validateSearch: z.object({ token: z.string().min(20).max(100).optional().catch(undefined) }),
  head: () => ({ meta: [{ title: "Confirmar mensagem · Offboard" }] }),
  component: ConfirmContactRoute,
});

function ConfirmContactRoute() {
  const { token } = Route.useSearch();

  return <ConfirmContactPage token={token} />;
}
