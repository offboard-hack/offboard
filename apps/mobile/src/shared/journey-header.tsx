import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Brand } from "./brand";
import { colors, fonts } from "./theme";
import { screenWidth, Text } from "./ui";

export function JourneyHeader({
  name,
  showProfile,
  demo,
}: {
  name: string;
  showProfile: boolean;
  demo: boolean;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <View style={styles.header}>
      <View style={styles.content}>
        <View style={styles.identity}>
          <Brand />

          {demo ? (
            <Text variant="caption" style={styles.demo}>
              Dados de exemplo
            </Text>
          ) : null}
        </View>
        {showProfile ? (
          <Link href="/perfil" asChild>
            <Pressable accessibilityLabel="Abrir perfil" style={styles.profile}>
              <Text aria-hidden maxFontSizeMultiplier={1.4} style={styles.initials}>
                {initials || "P"}
              </Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  content: {
    width: "100%",
    maxWidth: screenWidth,
    minHeight: 64,
    paddingHorizontal: 22,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  identity: {
    flexShrink: 1,
    paddingVertical: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  demo: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    color: colors.dark,
    backgroundColor: colors.tint,
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  profile: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 999,
    padding: 8,
    backgroundColor: colors.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { color: colors.dark, fontSize: 14, fontFamily: fonts.extrabold },
});
