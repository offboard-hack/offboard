import { employeeGrantHeader } from "@offboard/employee";
import { useQuery } from "@tanstack/react-query";
import Stack from "expo-router/stack";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { getEmployeeApi, useAuth } from "../../features/auth/session";
import { useConsent } from "../../features/privacy/consent";
import { employeeJourneyQueryKey, EmployeeJourneyProvider } from "../../shared/employee-journey";
import { JourneyHeader } from "../../shared/journey-header";
import { LocalDataProvider } from "../../shared/storage";
import { colors } from "../../shared/theme";
import { Button, Text } from "../../shared/ui";

export default function JourneyLayout() {
  const { session } = useAuth();

  if (session.status !== "signed-in") return null;
  const { account } = session;
  const grantId = account.mode === "better-auth" ? account.grantId : undefined;

  const namespace =
    account.mode === "demo"
      ? `demo:${account.id}`
      : `${account.id}:${account.caseId}:${account.grantId}`;

  return (
    <LocalDataProvider namespace={namespace} grantId={grantId}>
      <JourneyNavigator name={account.name} namespace={namespace} grantId={grantId} />
    </LocalDataProvider>
  );
}

function JourneyNavigator({
  name,
  namespace,
  grantId,
}: {
  name: string;
  namespace: string;
  grantId?: string;
}) {
  const [consent, , storage] = useConsent();
  const allowed = consent.accepted && !storage.pending && !storage.error;
  const remote = grantId !== undefined;

  const journey = useQuery({
    queryKey: [...employeeJourneyQueryKey, namespace],
    enabled: remote && allowed,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const result = await getEmployeeApi().api.employee.journey.get({
        headers: { [employeeGrantHeader]: grantId },
        fetch: { signal },
      });

      if (result.error) throw new Error("Não foi possível abrir sua jornada.");

      return result.data;
    },
  });

  return (
    <EmployeeJourneyProvider journey={journey.data ?? null}>
      <JourneyHeader name={name} showProfile={allowed} demo={!remote} />
      {storage.loading || (remote && allowed && journey.isPending) ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Abrindo sua jornada" />
        </View>
      ) : remote && allowed && journey.isError && !journey.data ? (
        <View style={styles.loading}>
          <Text accessibilityRole="alert">Não foi possível abrir sua jornada.</Text>
          <Button
            label="Tentar novamente"
            variant="outline"
            onPress={() => void journey.refetch()}
          />
        </View>
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: styles.stack }}>
          <Stack.Protected guard={allowed}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
          <Stack.Screen name="privacidade" />
        </Stack>
      )}
    </EmployeeJourneyProvider>
  );
}

const styles = StyleSheet.create({
  stack: { backgroundColor: colors.background },
  loading: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
});
