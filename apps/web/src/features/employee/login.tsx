import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { employeeCodeSchema, employeeLoginSchema } from "@offboard/employee";
import { revalidateLogic, useForm, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useState } from "react";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/shared/ui/shadcn/input-otp";
import { Label } from "@/shared/ui/shadcn/label";
import { Spinner } from "@/shared/ui/shadcn/spinner";
import { resendCooldownSeconds, useResendCountdown } from "@/shared/lib/resend-countdown";
import { notifySessionChange } from "@/shared/lib/session-change";
import { employeeAuth, requestEmployeeCode } from "./auth";

const otpSlots = [0, 1, 2, 3, 4, 5];

type LoginStep =
  | { kind: "email"; email: string }
  | { kind: "code"; email: string; resendAt: number };

export function EmployeeLogin() {
  const [step, setStep] = useState<LoginStep>({ kind: "email", email: "" });

  return step.kind === "code" ? (
    <CodeForm
      email={step.email}
      initialResendAt={step.resendAt}
      editEmail={() => setStep({ kind: "email", email: step.email })}
    />
  ) : (
    <EmailForm
      initialEmail={step.email}
      onSent={(email) =>
        setStep({ kind: "code", email, resendAt: Date.now() + resendCooldownSeconds * 1000 })
      }
    />
  );
}

function EmailForm({
  initialEmail,
  onSent,
}: {
  initialEmail: string;
  onSent: (email: string) => void;
}) {
  const hydrated = useHydrated();

  const request = useMutation({
    mutationFn: requestEmployeeCode,
    onSuccess: (_result, email) => onSent(email),
  });

  const form = useForm({
    defaultValues: { email: initialEmail },
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
                autoFocus={initialEmail !== ""}
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

function CodeForm({
  email,
  initialResendAt,
  editEmail,
}: {
  email: string;
  initialResendAt: number;
  editEmail: () => void;
}) {
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(initialResendAt);

  const secondsLeft = useResendCountdown(resendAt);

  const form = useForm({
    defaultValues: { code: "" },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: employeeCodeSchema },
    onSubmit: async ({ value }) => {
      setError("");

      const { code } = employeeCodeSchema.parse(value);

      try {
        const { error: signInError } = await employeeAuth.signIn.emailOtp({ email, otp: code });

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
      } catch {
        setError("Não foi possível entrar. Tente novamente.");
      }
    },
  });

  const resend = useMutation({
    mutationFn: () => requestEmployeeCode(email),
    onSuccess: () => {
      form.reset();
      setResendAt(Date.now() + resendCooldownSeconds * 1000);
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
      <p role="status" className="rounded-xl bg-muted px-3 py-2 text-sm">
        {resend.isSuccess
          ? "Se este e-mail tiver acesso, você receberá um novo código de seis dígitos."
          : "Se este e-mail tiver acesso, você receberá um código de seis dígitos."}
      </p>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="employee-email">E-mail</Label>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="-my-1 px-0 motion-reduce:transition-none"
            onClick={editEmail}
            disabled={busy || resend.isPending}
          >
            Usar outro e-mail
          </Button>
        </div>
        <Input
          id="employee-email"
          type="email"
          className="h-12 px-4 text-base sm:text-sm"
          value={email}
          readOnly
        />
      </div>
      <form.Field name="code">
        {(field) => {
          const issue = field.state.meta.errors[0]?.message;

          return (
            <div className="grid gap-2">
              <Label htmlFor="employee-code">Código de acesso</Label>
              <InputOTP
                id="employee-code"
                name={field.name}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={otpSlots.length}
                pattern={REGEXP_ONLY_DIGITS}
                pasteTransformer={(text) => text.replace(/[\s-]/g, "")}
                containerClassName="w-full"
                value={field.state.value}
                onChange={(code) => {
                  field.handleChange(code);
                  setError("");
                }}
                onBlur={field.handleBlur}
                disabled={busy || resend.isPending}
                aria-invalid={!!issue}
                aria-describedby={issue ? "employee-code-error" : undefined}
              >
                <InputOTPGroup className="grid w-full grid-cols-6">
                  {otpSlots.map((index) => (
                    <InputOTPSlot
                      key={index}
                      index={index}
                      className="h-12 w-full text-lg"
                      aria-invalid={!!issue}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
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
      <div className="grid gap-2">
        <Button
          type="submit"
          className="h-12 motion-reduce:transition-none"
          disabled={busy || resend.isPending}
        >
          {busy ? <Spinner aria-hidden="true" /> : null}
          {busy ? "Entrando…" : "Entrar"}
        </Button>
        <Button
          variant="secondary"
          type="button"
          className="h-12 tabular-nums motion-reduce:transition-none disabled:text-muted-foreground disabled:opacity-100"
          disabled={busy || resend.isPending || secondsLeft > 0}
          onClick={() => {
            setError("");
            resend.mutate();
          }}
        >
          {resend.isPending ? (
            <>
              <Spinner aria-hidden="true" />
              Enviando…
            </>
          ) : (
            <>Enviar outro código{secondsLeft > 0 ? ` em ${secondsLeft}s` : ""}</>
          )}
        </Button>
      </div>
    </form>
  );
}
