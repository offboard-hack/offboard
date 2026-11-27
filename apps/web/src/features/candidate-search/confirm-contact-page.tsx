import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getApiClient } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/utils";
import { Button, buttonVariants } from "@/shared/ui/shadcn/button";
import { confirmFailure } from "./contact-form";
import { SearchHeader } from "./search-header";

class ConfirmFailed extends Error {}

function ConfirmContact({ token }: { token: string }) {
  const confirm = useMutation({
    mutationFn: async () => {
      const result = await getApiClient().api.candidates.contact.confirm.post({ token });

      if (result.error !== null) throw new ConfirmFailed(confirmFailure(result.status));
    },
  });

  if (confirm.isSuccess) {
    return (
      <p role="status" className="text-pretty">
        Mensagem enviada. Se tiver interesse, a pessoa responde direto no seu e-mail.
      </p>
    );
  }

  return (
    <>
      <p className="text-muted-foreground text-pretty">
        Este link confirma que o e-mail é seu. Depois disso a mensagem que você escreveu é enviada,
        uma única vez.
      </p>
      {confirm.error ? (
        <p role="alert" className="text-sm text-destructive">
          {confirm.error.message}
        </p>
      ) : null}
      <Button
        size="lg"
        className="w-fit justify-self-center"
        disabled={confirm.isPending}
        onClick={() => confirm.mutate()}
      >
        {confirm.isPending ? "Enviando…" : "Confirmar e enviar"}
      </Button>
    </>
  );
}

export function ConfirmContactPage({ token }: { token: string | undefined }) {
  return (
    <main className="min-h-svh bg-background">
      <SearchHeader />
      <section className="mx-auto grid max-w-xl gap-5 px-5 py-16 text-center">
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance">
          Confirmar mensagem
        </h1>
        {token ? (
          <ConfirmContact token={token} />
        ) : (
          <p role="alert" className="text-destructive text-pretty">
            Este link está incompleto. Abra o link do e-mail de novo ou escreva pela busca.
          </p>
        )}
        <Link
          to="/busca-candidato"
          className={cn(buttonVariants({ variant: "ghost" }), "w-fit justify-self-center")}
        >
          Voltar para a busca
        </Link>
      </section>
    </main>
  );
}
