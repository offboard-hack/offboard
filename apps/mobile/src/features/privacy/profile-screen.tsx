import Door01Icon from "@hugeicons/core-free-icons/Door01Icon";
import SecurityCheckIcon from "@hugeicons/core-free-icons/SecurityCheckIcon";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";
import { colors } from "../../shared/theme";
import { Button, Card, Screen, Text } from "../../shared/ui";

export function ProfileScreen({
  account,
  signOut,
}: {
  account: { name: string; email: string; mode: "demo" | "better-auth" };
  signOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function leave() {
    setBusy(true);
    setError(false);

    try {
      await signOut();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text variant="title">Seu perfil</Text>
      <Card>
        <Text variant="heading">{account.name}</Text>
        {account.mode === "demo" ? (
          <Text variant="muted">Conta de demonstração</Text>
        ) : (
          <Text variant="muted">{account.email}</Text>
        )}
      </Card>
      <Button
        label="Privacidade e consentimento"
        variant="outline"
        icon={SecurityCheckIcon}
        onPress={() => router.push("/privacidade")}
      />
      <Button
        label="Sair da conta"
        variant="outline"
        icon={Door01Icon}
        busy={busy}
        onPress={() => void leave()}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Não foi possível sair. Tente novamente.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.destructive },
});
