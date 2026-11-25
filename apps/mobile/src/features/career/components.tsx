import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii } from "../../shared/theme";
import { Button, DiscardAction, Icon, Text } from "../../shared/ui";

export function Pill({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "accent" | "muted" | "success";
}) {
  const backgroundColor = { accent: colors.tint, muted: colors.muted, success: "#E8F5EF" }[tone];

  const color = { accent: colors.primary, muted: colors.mutedForeground, success: colors.success }[
    tone
  ];

  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

export function StorageNotice({
  saving,
  error,
  retry,
  discard,
}: {
  saving: boolean;
  error: string | null;
  retry: () => void;
  discard?: () => void;
}) {
  if (saving) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.saving}>
        <ActivityIndicator color={colors.primary} />
        <Text variant="muted">Salvando…</Text>
      </View>
    );
  }

  if (!error) return null;

  return (
    <View style={styles.notice}>
      <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
        {error}
      </Text>
      <View style={{ alignSelf: "flex-start" }}>
        <Button label="Tentar novamente" variant="outline" onPress={retry} />
      </View>
      {discard ? <DiscardAction onDiscard={discard} /> : null}
    </View>
  );
}

export function CareerDialog({
  children,
  title,
  close,
  footer,
  saving = false,
  confirmClose = false,
}: {
  children: ReactNode;
  title: string;
  close: () => void;
  footer?: ReactNode;
  saving?: boolean;
  confirmClose?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [closeRequested, setCloseRequested] = useState(false);

  function requestClose() {
    if (confirmClose) setCloseRequested(true);
    else close();
  }

  return (
    <Modal
      aria-label={title}
      accessibilityViewIsModal
      animationType="none"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      visible
      onRequestClose={() => {
        if (!saving) requestClose();
      }}
    >
      <KeyboardAvoidingView
        behavior="padding"
        style={[
          styles.modal,
          {
            paddingTop: Math.max(20, insets.top + 8),
            paddingBottom: Math.max(20, insets.bottom + 8),
            paddingLeft: Math.max(12, insets.left + 8),
            paddingRight: Math.max(12, insets.right + 8),
          },
        ]}
      >
        <View accessibilityViewIsModal style={styles.dialog}>
          <View style={styles.dialogHeader}>
            <Text variant="heading" accessibilityRole="header" style={styles.dialogTitle}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar"
              disabled={saving}
              onPress={requestClose}
              style={({ pressed }) => [styles.close, (pressed || saving) && { opacity: 0.65 }]}
            >
              <Icon name={Cancel01Icon} size={19} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.dialogBody}
            showsVerticalScrollIndicator
          >
            {children}
          </ScrollView>
          {confirmClose && closeRequested ? (
            <View style={styles.dialogFooter}>
              <DiscardAction onDiscard={close} onKeep={() => setCloseRequested(false)} />
            </View>
          ) : footer ? (
            <View style={styles.dialogFooter}>{footer}</View>
          ) : null}
        </View>
        <Pressable
          aria-hidden
          focusable={false}
          tabIndex={-1}
          importantForAccessibility="no"
          disabled={saving}
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radii.control,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  notice: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: 12,
    gap: 8,
  },
  saving: { flexDirection: "row", alignItems: "center", gap: 8 },
  modal: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(25, 12, 43, 0.56)",
  },
  dialog: {
    zIndex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.card + 6,
    maxWidth: 480,
    maxHeight: "100%",
    flexShrink: 1,
    minHeight: 180,
    width: "100%",
    paddingBottom: 4,
  },
  dialogHeader: {
    padding: 14,
    paddingLeft: 18,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dialogTitle: { flex: 1 },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    backgroundColor: colors.muted,
  },
  dialogBody: { padding: 18, gap: 16 },
  dialogFooter: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 8,
  },
});
