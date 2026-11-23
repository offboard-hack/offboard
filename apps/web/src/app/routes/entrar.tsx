import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignInPage } from "@/features/sign-in/sign-in-page";

export const Route = createFileRoute("/entrar")({
  validateSearch: z.object({
    voltar: z.string().optional().catch(undefined),
    acesso: z.literal("revogado").optional().catch(undefined),
    error: z.string().optional().catch(undefined),
  }),
  head: () => ({
    meta: [{ title: "Entrar · Offboard" }, { name: "referrer", content: "no-referrer" }],
  }),
  component: SignInRoute,
});

function SignInRoute() {
  const { voltar, acesso, error } = Route.useSearch();

  return <SignInPage returnPath={voltar} revoked={acesso === "revogado"} invalidLink={!!error} />;
}
