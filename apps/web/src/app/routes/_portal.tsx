import { createFileRoute, redirect } from "@tanstack/react-router";
import { principalSchema } from "@offboard/access";
import { apiFetch } from "@/shared/lib/api-fetch";
import { safeReturnPath } from "@/features/sign-in/return-path";
import { Portal } from "../portal";

export const Route = createFileRoute("/_portal")({
  beforeLoad: async ({ context, location }) => {
    const response = await apiFetch("/api/session");

    if (response.status === 401 || response.status === 403) {
      context.queryClient.clear();
      throw redirect({
        to: "/entrar",
        search: {
          voltar: safeReturnPath(location.href),
          acesso: response.status === 403 ? "revogado" : undefined,
        },
        replace: true,
      });
    }

    if (!response.ok) throw new Error("Failed to verify portal session");

    return { principal: principalSchema.parse(await response.json()) };
  },
  component: Portal,
});
