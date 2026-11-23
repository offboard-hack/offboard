import { Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { authClient } from "./auth-client";
import { safeReturnPath } from "./return-path";
import { SignInVisual } from "./sign-in-visual";

const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Informe um e-mail válido." })),
});

type Delivery = "idle" | "sent" | "failed" | "limited";

export function SignInPage({
  returnPath,
  revoked,
  invalidLink,
}: {
  returnPath?: string;
  revoked: boolean;
  invalidLink: boolean;
}) {
  const hydrated = useHydrated();
  const [delivery, setDelivery] = useState<Delivery>("idle");

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setDelivery("idle");

      const { email } = signInSchema.parse(value);
      const destination = safeReturnPath(returnPath);
      const retry = new URLSearchParams({ voltar: destination });

      try {
        const { error } = await authClient.signIn.magicLink({
          email,
          callbackURL: destination,
          errorCallbackURL: `/entrar?${retry}`,
        });

        setDelivery(error?.status === 429 ? "limited" : error ? "failed" : "sent");
      } catch {
        setDelivery("failed");
      }
    },
  });

  return (
    <main className="grid min-h-svh grid-rows-[auto_1fr] bg-background p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:grid-rows-1 md:p-4">
      <SignInVisual />
      <section className="mx-auto grid w-full max-w-96 content-start gap-4 px-3 py-6 md:my-auto md:w-[calc(100%_-_4rem)] md:px-0 md:py-12">
        <svg
          role="img"
          aria-label="Offboard"
          viewBox="0 0 877 256"
          className="h-10 w-auto fill-foreground text-primary"
        >
          <use href="/offboard-logo.svg#wordmark" />
        </svg>
        <div className="grid gap-7">
          <div className="grid gap-3">
            <h1 className="text-[clamp(1.6rem,3vw,1.9rem)] leading-none font-[730] tracking-tight">
              Entrar no portal
            </h1>
            <p className="max-w-[36ch] text-base/relaxed text-muted-foreground">
              Informe seu e-mail cadastrado para receber um link de acesso.
            </p>
          </div>
          <form
            method="post"
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            {delivery === "idle" && (revoked || invalidLink) && (
              <p role="alert" className="text-sm text-destructive">
                {revoked
                  ? "Seu acesso foi removido. Fale com a pessoa responsável pelo portal."
                  : "Este link é inválido ou expirou. Solicite um novo link para entrar."}
              </p>
            )}
            <form.Field name="email">
              {(field) => {
                const error = field.state.meta.errors[0]?.message;

                return (
                  <div className="grid gap-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      name={field.name}
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      aria-invalid={!!error}
                      aria-describedby={error ? "email-error" : undefined}
                      className="h-12 px-4 text-base sm:text-sm"
                      placeholder="voce@empresa.com.br"
                      required
                    />
                    {error && (
                      <p id="email-error" role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(pending) => (
                <Button
                  type="submit"
                  disabled={!hydrated || pending}
                  className="h-12 motion-reduce:transition-none"
                >
                  {pending ? (
                    <Spinner aria-hidden="true" />
                  ) : (
                    <HugeiconsIcon icon={Mail01Icon} aria-hidden="true" />
                  )}
                  {pending ? "Enviando link…" : "Enviar link de acesso"}
                </Button>
              )}
            </form.Subscribe>
            {delivery === "sent" && (
              <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm">
                Se o e-mail estiver cadastrado, você receberá um link para entrar. Confira a caixa
                de entrada e o spam.
              </p>
            )}
            {(delivery === "failed" || delivery === "limited") && (
              <p role="alert" className="text-sm text-destructive">
                {delivery === "limited"
                  ? "Muitas tentativas. Aguarde um pouco e tente novamente."
                  : "Não foi possível solicitar o link. Tente novamente."}
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
