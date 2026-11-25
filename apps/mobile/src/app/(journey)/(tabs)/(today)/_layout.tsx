import Stack from "expo-router/stack";
import { colors } from "../../../../shared/theme";

export default function TabLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
