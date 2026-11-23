import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/shared/ui/shadcn/button";

export const Route = createFileRoute("/_portal/sem-acesso")({
  head: () => ({ meta: [{ title: "Acesso restrito · Offboard" }] }),
  component: RestrictedPage,
});

function RestrictedPage() {
  return (
    <section className="grid justify-items-start gap-3">
      <h1 id="titulo-pagina" tabIndex={-1} className="text-xl font-semibold">
        Acesso restrito
      </h1>
      <p className="text-sm text-muted-foreground">Seu papel não tem acesso a esta página.</p>
      <Button render={<Link to="/desligamentos" />} variant="outline" nativeButton={false}>
        Voltar para desligamentos
      </Button>
    </section>
  );
}
