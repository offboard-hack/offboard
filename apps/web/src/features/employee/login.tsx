import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { employeeCodeSchema, employeeLoginSchema } from "@offboard/employee";
import { revalidateLogic, useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { notifySessionChange } from "@/shared/lib/session-change";
import { employeeAuth, requestEmployeeCode } from "./auth";

export function EmployeeLogin() {
  const [email, setEmail] = useState<string | null>(null);

  return email ? (
    <CodeForm key={email} email={email} reset={() => setEmail(null)} />
  ) : (
    <EmailForm onSent={setEmail} />
  );
}

function EmailForm({ onSent }: { onSent: (email: string) => void }) {
  const hydrated = useHydrated();

  const request = useMutation({
    mutationFn: requestEmployeeCode,
    onSuccess: (_result, email) => onSent(email),
  });

  const form = useForm({
    defaultValues: { email: "" },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: employeeLoginSchema },
    onSubmit: ({ value }) => request.mutate(employeeLoginSchema.parse(value).email),
  });

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => {
          const error = field.state.meta.errors[0]?.message;

          return (
            <div className="grid gap-2">
              <Label htmlFor="employee-email">E-mail</Label>
              <Input
                id="employee-email"
                name={field.name}
                type="email"
                className="h-12 px-4 text-base sm:text-sm"
                placeholder="voce@empresa.com.br"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoComplete="email"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={!!error}
                aria-describedby={error ? "employee-email-error" : undefined}
                disabled={!hydrated || request.isPending}
              />
              {error ? (
                <p id="employee-email-error" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }}
      </form.Field>
      {request.error ? (
        <p role="alert" className="text-sm text-destructive">
          {request.error.message}
        </p>
      ) : null}
      <Button
        type="submit"
        className="h-12 motion-reduce:transition-none"
        disabled={!hydrated || request.isPending}
      >
        {request.isPending ? (
          <Spinner aria-hidden="true" />
        ) : (
          <HugeiconsIcon icon={Mail01Icon} aria-hidden="true" />
        )}
        {request.isPending ? "Enviando…" : "Enviar código"}
      </Button>
    </form>
  );
}

function CodeForm({ email, reset }: { email: string; reset: () => void }) {
  const [error, setError] = useState("");
  const resend = useMutation({ mutationFn: () => requestEmployeeCode(email) });

  const form = useForm({
    defaultValues: { code: "" },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: employeeCodeSchema },
    onSubmit: async ({ value }) => {
      setError("");

      const { error: signInError } = await employeeAuth.signIn.emailOtp({
        email,
        otp: employeeCodeSchema.parse(value).code,
      });

      if (signInError) {
        setError(
          signInError.status === 429
            ? "Muitas tentativas. Aguarde antes de tentar novamente."
            : "Código inválido ou expirado. Confira ou solicite outro.",
        );

        return;
      }

      notifySessionChange();
      window.location.assign("/colaborador");
    },
  });

  const busy = useStore(form.store, (state) => state.isSubmitting);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm wrap-anywhere">
        Se {email} tiver acesso, você receberá um código de seis dígitos.
      </p>
      <form.Field name="code">
        {(field) => {
          const issue = field.state.meta.errors[0]?.message;

          return (
            <div className="grid gap-2">
              <Label htmlFor="employee-code">Código de acesso</Label>
              <Input
                id="employee-code"
                name={field.name}
                inputMode="numeric"
                className="h-12 px-4 text-base sm:text-sm"
                required
                autoComplete="one-time-code"
                maxLength={6}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                disabled={busy || resend.isPending}
                aria-invalid={!!issue}
                aria-describedby={issue ? "employee-code-error" : undefined}
              />
              {issue ? (
                <p id="employee-code-error" className="text-sm text-destructive">
                  {issue}
                </p>
              ) : null}
            </div>
          );
        }}
      </form.Field>
      {error || resend.error ? (
        <p role="alert" className="text-sm text-destructive">
          {error || resend.error?.message}
        </p>
      ) : null}
      {resend.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          Se houver acesso, enviamos outro código.
        </p>
      ) : null}
      <Button
        type="submit"
        className="h-12 motion-reduce:transition-none"
        disabled={busy || resend.isPending}
      >
        {busy ? <Spinner aria-hidden="true" /> : null}
        {busy ? "Entrando…" : "Entrar"}
      </Button>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" type="button" onClick={reset} disabled={busy || resend.isPending}>
          Usar outro e-mail
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={busy || resend.isPending}
          onClick={() => {
            setError("");
            resend.mutate();
          }}
        >
          {resend.isPending ? "Enviando…" : "Enviar outro código"}
        </Button>
      </div>
    </form>
  );
}
