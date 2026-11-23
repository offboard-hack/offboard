import { createFileRoute, redirect } from "@tanstack/react-router";
import { getApiClient } from "@/shared/lib/api-client";
import { safeReturnPath } from "@/features/sign-in/return-path";
import { Portal } from "../portal";

export const Route = createFileRoute("/_portal")({
  beforeLoad: async ({ context, location }) => {
    const { status, data, error } = await getApiClient().api.session.get();

    if (status === 401 || status === 403) {
      context.queryClient.clear();
      throw redirect({
        to: "/entrar",
        search: {
          voltar: safeReturnPath(location.href),
          acesso: status === 403 ? "revogado" : undefined,
        },
        replace: true,
      });
    }

    if (error) throw new Error("Failed to verify portal session");

    return { principal: data };
  },
  component: Portal,
});
