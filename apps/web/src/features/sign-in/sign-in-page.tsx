import type { ReactNode } from "react";
import { Mail01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { resendCooldownSeconds, useResendCountdown } from "@/shared/lib/resend-countdown";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { authClient } from "./auth-client";
import { safeReturnPath } from "./return-path";
import { SignInLayout } from "./sign-in-layout";

const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "Informe um e-mail válido." })),
});

type Failure = "failed" | "limited";

type SignInStep =
  | { kind: "email"; email: string }
  | { kind: "sent"; email: string; resendAt: number };

async function requestLink(email: string, returnPath?: string) {
  const destination = safeReturnPath(returnPath);
  const retry = new URLSearchParams({ voltar: destination });

  try {
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: destination,
      errorCallbackURL: `/entrar?${retry}`,
    });

    const failure: Failure | null = error?.status === 429 ? "limited" : error ? "failed" : null;

    return failure;
  } catch {
    return "failed" satisfies Failure;
  }
}

function FailureAlert({ failure }: { failure: Failure | null }) {
  return failure ? (
    <p role="alert" className="text-sm text-destructive">
      {failure === "limited"
        ? "Muitas tentativas. Aguarde um pouco e tente novamente."
        : "Não foi possível solicitar o link. Tente novamente."}
    </p>
  ) : null;
}

export function SignInPage({
  returnPath,
  revoked,
  invalidLink,
  employeeLink,
}: {
  returnPath?: string;
  revoked: boolean;
  invalidLink: boolean;
  employeeLink?: ReactNode;
}) {
  const [step, setStep] = useState<SignInStep>({ kind: "email", email: "" });

  return (
    <SignInLayout
      title="Entrar no portal"
      description="Informe seu e-mail cadastrado para receber um link de acesso."
      secondaryLink={employeeLink}
    >
      {step.kind === "sent" ? (
        <SentStep
          email={step.email}
          returnPath={returnPath}
          initialResendAt={step.resendAt}
          editEmail={() => setStep({ kind: "email", email: step.email })}
        />
      ) : (
        <EmailStep
          initialEmail={step.email}
          returnPath={returnPath}
          notice={
            step.email === "" && (revoked || invalidLink)
              ? revoked
                ? "Seu acesso foi removido. Fale com a pessoa responsável pelo portal."
                : "Este link é inválido ou expirou. Solicite um novo link para entrar."
              : undefined
          }
          onSent={(email) =>
            setStep({ kind: "sent", email, resendAt: Date.now() + resendCooldownSeconds * 1000 })
          }
        />
      )}
    </SignInLayout>
  );
}

function EmailStep({
  initialEmail,
  returnPath,
  notice,
  onSent,
}: {
  initialEmail: string;
  returnPath?: string;
  notice?: string;
  onSent: (email: string) => void;
}) {
  const hydrated = useHydrated();
  const [failure, setFailure] = useState<Failure | null>(null);

  const form = useForm({
    defaultValues: { email: initialEmail },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setFailure(null);

      const { email } = signInSchema.parse(value);
      const result = await requestLink(email, returnPath);

      if (result) setFailure(result);
      else onSent(email);
    },
  });

  return (
    <form
      method="post"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {!failure && notice ? (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      ) : null}
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
                autoFocus={initialEmail !== ""}
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
      <FailureAlert failure={failure} />
    </form>
  );
}

function SentStep({
  email,
  returnPath,
  initialResendAt,
  editEmail,
}: {
  email: string;
  returnPath?: string;
  initialResendAt: number;
  editEmail: () => void;
}) {
  const [resendAt, setResendAt] = useState(initialResendAt);
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const secondsLeft = useResendCountdown(resendAt);

  async function resend() {
    setPending(true);
    setFailure(null);

    try {
      const result = await requestLink(email, returnPath);

      setFailure(result);

      if (!result) {
        setResent(true);
        setResendAt(Date.now() + resendCooldownSeconds * 1000);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm">
        {resent
          ? "Se o e-mail estiver cadastrado, você receberá um novo link para entrar."
          : "Se o e-mail estiver cadastrado, você receberá um link para entrar."}{" "}
        Confira a caixa de entrada e o spam.
      </p>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="email">E-mail</Label>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="-my-1 px-0 motion-reduce:transition-none"
            onClick={editEmail}
            disabled={pending}
          >
            Usar outro e-mail
          </Button>
        </div>
        <Input
          id="email"
          type="email"
          className="h-12 px-4 text-base sm:text-sm"
          value={email}
          readOnly
        />
      </div>
      <FailureAlert failure={failure} />
      <Button
        variant="secondary"
        type="button"
        className="h-12 tabular-nums motion-reduce:transition-none disabled:text-muted-foreground disabled:opacity-100"
        disabled={pending || secondsLeft > 0}
        onClick={() => void resend()}
      >
        {pending ? (
          <>
            <Spinner aria-hidden="true" />
            Enviando…
          </>
        ) : (
          <>Enviar outro link{secondsLeft > 0 ? ` em ${secondsLeft}s` : ""}</>
        )}
      </Button>
    </div>
  );
}
