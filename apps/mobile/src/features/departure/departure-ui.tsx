import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import { Link, type Href } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { colors, radii } from "../../shared/theme";
import { Button, DiscardAction, Icon, Text } from "../../shared/ui";

type IconName = ComponentProps<typeof Icon>["name"];

export function PageTitle({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();

  return (
    <View style={styles.header}>
      <View style={styles.headerActions}>
        <Link href="/saida" asChild>
          <Pressable accessibilityRole="link" style={styles.back}>
            <Icon name={ArrowLeft01Icon} color={colors.primary} size={17} />
            <Text variant="label" style={styles.brandText}>
              Saída
            </Text>
          </Pressable>
        </Link>
        {aside}
      </View>
      <View style={styles.titleGroup}>
        <Text
          accessibilityRole="header"
          variant="title"
          style={fontScale >= 1.8 && styles.largeTitle}
        >
          {title}
        </Text>
        {description ? <Text variant="muted">{description}</Text> : null}
      </View>
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" aria-level={2} variant="heading">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function IconBadge({
  name,
  muted,
  positive,
}: {
  name: IconName;
  muted?: boolean;
  positive?: boolean;
}) {
  return (
    <View style={[styles.iconBadge, muted && styles.mutedBadge, positive && styles.positiveBadge]}>
      <Icon
        name={name}
        size={20}
        color={positive ? colors.success : muted ? colors.mutedForeground : colors.primary}
      />
    </View>
  );
}

export function StepLink({
  title,
  description,
  href,
  icon,
  complete,
  waiting,
  divider = true,
}: {
  title: string;
  description: string;
  href: Href;
  icon: IconName;
  complete?: boolean;
  waiting?: boolean;
  divider?: boolean;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        style={StyleSheet.flatten([styles.row, divider && styles.divider])}
        android_ripple={{ color: colors.tint }}
      >
        <IconBadge name={complete ? Tick01Icon : icon} muted={waiting} positive={complete} />
        <View style={styles.copy}>
          <Text variant="label">{title}</Text>
          <Text variant="caption">{description}</Text>
        </View>
        <Icon name={ArrowRight01Icon} color={colors.mutedForeground} size={17} />
      </Pressable>
    </Link>
  );
}

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;

  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      variant="caption"
      style={styles.error}
    >
      {error}
    </Text>
  );
}

export function StorageFeedback({
  loading,
  saving,
  error,
  readFailed,
  retry,
  discardFailedWrite,
}: {
  loading: boolean;
  saving: boolean;
  error: string | null;
  readFailed: boolean;
  retry: () => void;
  discardFailedWrite: () => void;
}) {
  if (loading || saving) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.storageFeedback}>
        <ActivityIndicator color={colors.primary} />
        <Text variant="caption">
          {loading ? "Carregando dados…" : "Salvando neste dispositivo…"}
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.storageError}>
        <FieldError error={error} />
        <Button label="Tentar novamente" variant="outline" onPress={retry} />
        {!readFailed ? <DiscardAction onDiscard={discardFailedWrite} /> : null}
      </View>
    );
  }

  return null;
}

export const departureStyles = StyleSheet.create({
  stack: { gap: 24 },
  form: { gap: 20 },
  group: { gap: 8 },
  copy: { flex: 1, gap: 3 },
  thinDivider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  highlightText: { color: colors.primary },
  positiveText: { color: colors.success },
});

const styles = StyleSheet.create({
  header: { gap: 7 },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  back: {
    minHeight: 44,
    alignSelf: "flex-start",
    paddingRight: 12,
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
  },
  titleGroup: { gap: 6 },
  largeTitle: { fontSize: 26, lineHeight: 33, letterSpacing: -0.6 },
  brandText: { color: colors.primary },
  section: { gap: 5 },
  iconBadge: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tint,
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  mutedBadge: { backgroundColor: colors.muted },
  positiveBadge: { backgroundColor: colors.muted },
  row: {
    minHeight: 66,
    paddingVertical: 10,
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  divider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  copy: { flex: 1, gap: 2 },
  error: { color: colors.destructive },
  storageFeedback: { flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 4 },
  storageError: {
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
  },
});
