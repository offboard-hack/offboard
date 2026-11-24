import { NunitoSans_400Regular } from "@expo-google-fonts/nunito-sans/400Regular";
import { NunitoSans_600SemiBold } from "@expo-google-fonts/nunito-sans/600SemiBold";
import { NunitoSans_700Bold } from "@expo-google-fonts/nunito-sans/700Bold";
import { NunitoSans_800ExtraBold } from "@expo-google-fonts/nunito-sans/800ExtraBold";
import { useFonts } from "expo-font";
import Stack from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../features/auth/session";
import { Brand } from "../shared/brand";
import { colors } from "../shared/theme";
import { Button, Text } from "../shared/ui";

export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    NunitoSans_800ExtraBold,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "left"]}>
        <AuthProvider>{fontsReady || fontError ? <RootNavigator /> : <Startup />}</AuthProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, retry } = useAuth();

  if (session.status === "loading") return <Startup />;

  if (session.status === "error")
    return <Startup error={session.message} retry={() => void retry()} />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: styles.stack }}>
      <Stack.Protected guard={session.status === "signed-out"}>
        <Stack.Screen name="entrar" />
      </Stack.Protected>
      <Stack.Protected guard={session.status === "signed-in"}>
        <Stack.Screen name="(journey)" />
      </Stack.Protected>
    </Stack>
  );
}

function Startup({ error, retry }: { error?: string; retry?: () => void }) {
  return (
    <View style={styles.startup}>
      <Brand />
      {error ? (
        <Text accessibilityRole="alert" variant="muted">
          {error}
        </Text>
      ) : (
        <ActivityIndicator color={colors.primary} accessibilityLabel="Carregando Offboard" />
      )}
      {retry ? <Button label="Tentar novamente" variant="outline" onPress={retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  stack: { backgroundColor: colors.background },
  startup: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
    backgroundColor: colors.background,
  },
});
