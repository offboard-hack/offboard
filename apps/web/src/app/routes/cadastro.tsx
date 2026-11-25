import { createFileRoute, Link } from "@tanstack/react-router";
import { SignUpPage } from "@/features/sign-in/sign-up-page";

export const Route = createFileRoute("/cadastro")({
  head: () => ({
    meta: [{ title: "Criar organização · Offboard" }],
  }),
  component: SignUpRoute,
});

function SignUpRoute() {
  return (
    <SignUpPage
      signInLink={
        <Link to="/entrar" className="font-bold text-primary underline-offset-4 hover:underline">
          Já tenho uma conta
        </Link>
      }
    />
  );
}
