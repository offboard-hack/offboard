import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { EmployeeLogin } from "@/features/employee/login";
import { SignInLayout } from "@/features/sign-in/sign-in-layout";
import { getApiClient } from "@/shared/lib/api-client";
import { Alert, AlertDescription } from "@/shared/ui/shadcn/alert";

export const Route = createFileRoute("/colaborador_/entrar")({
  validateSearch: z.object({ aviso: z.literal("conta-apagada").optional().catch(undefined) }),
  beforeLoad: async () => {
    const result = await getApiClient().api.employee.session.get();

    if (result.data) throw redirect({ to: "/colaborador", replace: true });
  },
  head: () => ({
    meta: [{ title: "Entrar na sua jornada · Offboard" }, { name: "robots", content: "noindex" }],
  }),
  component: EmployeeLoginRoute,
});

function EmployeeLoginRoute() {
  const { aviso } = Route.useSearch();

  return (
    <SignInLayout
      title="Entre na sua jornada"
      description="Informe o e-mail cadastrado pelo RH para receber um código de acesso."
      visualDescription="Acompanhe seu desligamento e organize seus próximos passos."
      secondaryLink={
        <Link to="/entrar" className="font-bold text-primary underline-offset-4 hover:underline">
          Entrar no portal do RH
        </Link>
      }
    >
      {aviso ? (
        <Alert role="status">
          <AlertDescription>Sua conta foi apagada.</AlertDescription>
        </Alert>
      ) : null}
      <EmployeeLogin />
    </SignInLayout>
  );
}
