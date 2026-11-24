import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import { revalidateLogic, useForm, useStore } from "@tanstack/react-form";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { employeeCodeSchema, employeeLoginSchema } from "@offboard/employee";
import { Brand } from "../../shared/brand";
import { colors } from "../../shared/theme";
import { Button, Card, Field, Icon, Screen, Text } from "../../shared/ui";
import { AuthRequestError, useAuth } from "./session";

export function LoginScreen() {
  const { mode } = useAuth();

  return (
    <Screen>
      <View style={styles.layout}>
        <Brand />
        <Text variant="title" accessibilityRole="header">
          {mode === "demo" ? "Seu próximo passo começa aqui" : "Entre na sua jornada"}
        </Text>
        {mode === "demo" ? <DemoAccess /> : <EmployeeLoginForm />}
      </View>
    </Screen>
  );
}

function DemoAccess() {
  const { startDemo } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enterDemo() {
    setBusy(true);
    setError("");

    try {
      await startDemo();
    } catch {
      setError("Não foi possível abrir a demonstração. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card tone="subtle">
        <View style={styles.notice}>
          <Icon name={SmartPhone01Icon} color={colors.primary} size={21} />
          <View style={styles.noticeCopy}>
            <Text variant="label">Modo demonstração</Text>
            <Text variant="muted">
              Acompanhe um desligamento de exemplo e explore os recursos de carreira.
            </Text>
          </View>
        </View>
      </Card>
      {error ? <FormError message={error} /> : null}
      <Button
        label="Entrar na demonstração"
        icon={ArrowRight01Icon}
        onPress={() => void enterDemo()}
        busy={busy}
      />
    </>
  );
}

function EmployeeLoginForm() {
  const [email, setEmail] = useState<string | null>(null);

  return (
    <>
      <Card tone="subtle">
        <View style={styles.notice}>
          <Icon name={Mail01Icon} color={colors.primary} size={21} />
          <View style={styles.noticeCopy}>
            <Text variant="label">
              {email ? "Confira seu e-mail" : "Use o e-mail informado ao RH"}
            </Text>
            <Text variant="muted">
              {email
                ? `Se ${email} tiver acesso, você receberá um código de seis dígitos.`
                : "Você vai receber um código para acessar sua jornada."}
            </Text>
          </View>
        </View>
      </Card>
      {email ? (
        <CodeForm email={email} reset={() => setEmail(null)} />
      ) : (
        <EmailForm onCodeRequested={setEmail} />
      )}
    </>
  );
}

function EmailForm({ onCodeRequested }: { onCodeRequested: (email: string) => void }) {
  const { requestCode } = useAuth();
  const [error, setError] = useState("");

  const form = useForm({
    defaultValues: { email: "" },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: employeeLoginSchema },
    onSubmit: async ({ value }) => {
      setError("");
      const { email } = employeeLoginSchema.parse(value);

      try {
        await requestCode(email);
        onCodeRequested(email);
      } catch (failure) {
        setError(
          failure instanceof AuthRequestError
            ? failure.message
            : "Não foi possível enviar o código.",
        );
      }
    },
  });

  const busy = useStore(form.store, (state) => state.isSubmitting);

  return (
    <View style={styles.form}>
      <form.Field name="email">
        {(field) => (
          <Field
            label="E-mail"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="email"
            editable={!busy}
            error={field.state.meta.errors[0]?.message}
            value={field.state.value}
            onChangeText={field.handleChange}
            onBlur={field.handleBlur}
            onSubmitEditing={() => void form.handleSubmit()}
          />
        )}
      </form.Field>
      {error ? <FormError message={error} /> : null}
      <Button
        label="Enviar código"
        icon={ArrowRight01Icon}
        busy={busy}
        onPress={() => void form.handleSubmit()}
      />
    </View>
  );
}

function CodeForm({ email, reset }: { email: string; reset: () => void }) {
  const { signIn, requestCode } = useAuth();
  const [error, setError] = useState("");
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);

  const form = useForm({
    defaultValues: { code: "" },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: employeeCodeSchema },
    onSubmit: async ({ value }) => {
      setError("");

      try {
        await signIn(email, employeeCodeSchema.parse(value).code);
      } catch (failure) {
        setError(
          failure instanceof AuthRequestError ? failure.message : "Não foi possível entrar.",
        );
      }
    },
  });

  const busy = useStore(form.store, (state) => state.isSubmitting);

  async function resend() {
    setError("");
    setSent(false);
    setResending(true);

    try {
      await requestCode(email);
      setSent(true);
    } catch (failure) {
      setError(
        failure instanceof AuthRequestError
          ? failure.message
          : "Não foi possível enviar outro código.",
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <View style={styles.form}>
      <form.Field name="code">
        {(field) => (
          <Field
            label="Código de acesso"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            editable={!busy && !resending}
            error={field.state.meta.errors[0]?.message}
            value={field.state.value}
            onChangeText={field.handleChange}
            onBlur={field.handleBlur}
            onSubmitEditing={() => void form.handleSubmit()}
          />
        )}
      </form.Field>
      {error ? <FormError message={error} /> : null}
      {sent ? (
        <Text accessibilityLiveRegion="polite">Se houver um acesso, enviamos outro código.</Text>
      ) : null}
      <Button
        label="Entrar"
        icon={ArrowRight01Icon}
        busy={busy}
        disabled={resending}
        onPress={() => void form.handleSubmit()}
      />
      <View style={styles.switchAction}>
        <Button
          label="Usar outro e-mail"
          variant="ghost"
          disabled={busy || resending}
          onPress={reset}
        />
        <Button
          label="Enviar outro código"
          variant="ghost"
          disabled={busy}
          busy={resending}
          onPress={() => void resend()}
        />
      </View>
    </View>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <Text
      variant="caption"
      style={styles.error}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  layout: {
    gap: 20,
    paddingBottom: 24,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  noticeCopy: {
    flex: 1,
    gap: 4,
  },
  form: {
    gap: 16,
  },
  switchAction: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: 6,
  },
  error: {
    color: colors.destructive,
  },
});
