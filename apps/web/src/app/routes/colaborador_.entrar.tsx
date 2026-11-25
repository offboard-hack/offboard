import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { EmployeeLogin } from "@/features/employee/login";
import { SignInLayout } from "@/features/sign-in/sign-in-layout";
import { getApiClient } from "@/shared/lib/api-client";

export const Route = createFileRoute("/colaborador_/entrar")({
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
      <EmployeeLogin />
    </SignInLayout>
  );
}
