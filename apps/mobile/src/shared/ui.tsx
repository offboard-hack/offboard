import { Button as NativeButton } from "@offboard/ui/native/button";
import { HugeiconsIcon } from "@hugeicons/react-native";
import {
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
  type Ref,
  useId,
  useState,
} from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { colors, fonts, radii } from "./theme";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

export function Button({
  icon,
  ...props
}: Omit<ComponentProps<typeof NativeButton>, "icon"> & { icon?: IconData }) {
  const iconColor =
    props.variant === "outline"
      ? colors.foreground
      : props.variant && props.variant !== "primary"
        ? colors.primary
        : colors.primaryForeground;

  return (
    <NativeButton
      {...props}
      icon={icon ? <Icon name={icon} size={18} color={iconColor} /> : null}
    />
  );
}

export function DiscardAction({
  onDiscard,
  onKeep,
}: {
  onDiscard: () => void;
  onKeep?: () => void;
}) {
  const [requested, setRequested] = useState(false);
  const confirming = Boolean(onKeep) || requested;

  return (
    <View style={styles.discardActions}>
      {confirming ? (
        <Text variant="label" accessibilityRole="alert">
          Descartar esta tentativa?
        </Text>
      ) : null}
      <Button
        label={confirming ? "Confirmar descarte" : "Descartar alteração"}
        variant="ghost"
        onPress={confirming ? onDiscard : () => setRequested(true)}
      />
      {confirming ? (
        <Button
          label="Manter alteração"
          variant="outline"
          onPress={onKeep ?? (() => setRequested(false))}
        />
      ) : null}
    </View>
  );
}

export const screenWidth = 560;

export function Screen({
  children,
  scrollRef,
}: {
  children: ReactNode;
  scrollRef?: Ref<ComponentRef<typeof ScrollView>>;
}) {
  return (
    <ScrollView
      ref={scrollRef}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {children}
    </ScrollView>
  );
}

type TextVariant = "title" | "heading" | "body" | "muted" | "label" | "caption";

export function Text({
  variant = "body",
  style,
  accessibilityRole = variant === "title" || variant === "heading" ? "header" : undefined,
  ...props
}: TextProps & { variant?: TextVariant }) {
  const level = accessibilityRole === "header" ? (variant === "title" ? 1 : 2) : undefined;

  return (
    <NativeText
      accessibilityRole={accessibilityRole}
      aria-level={level}
      style={[styles.text, styles[variant], style]}
      {...props}
    />
  );
}

export function Card({
  children,
  tone = "default",
  style,
}: {
  children: ReactNode;
  tone?: "default" | "subtle" | "brand";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.card,
        tone === "subtle" && styles.subtle,
        tone === "brand" && styles.brand,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Field({
  label,
  error,
  style,
  onFocus,
  onBlur,
  ...props
}: ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const errorId = useId();
  const errorAccessibility = error ? { "aria-describedby": errorId, "aria-invalid": true } : {};

  return (
    <View style={styles.field}>
      <Text variant="label">{label}</Text>
      <TextInput
        {...props}
        {...errorAccessibility}
        accessibilityLabel={label}
        accessibilityHint={Platform.OS !== "web" && error ? error : props.accessibilityHint}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          props.multiline && styles.multiline,
          focused && styles.focused,
          error && styles.invalid,
          style,
        ]}
      />
      {error ? (
        <Text
          nativeID={errorId}
          variant="caption"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Icon({
  name,
  size = 20,
  color = colors.primary,
}: {
  name: IconData;
  size?: number;
  color?: string;
}) {
  return <HugeiconsIcon icon={name} size={size} color={color} strokeWidth={1.8} />;
}

const styles = StyleSheet.create({
  discardActions: { gap: 6 },
  scroll: { flex: 1, backgroundColor: colors.background },
  content: {
    width: "100%",
    maxWidth: screenWidth,
    alignSelf: "center",
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 20,
  },
  text: { fontFamily: fonts.regular, color: colors.foreground },
  title: { fontFamily: fonts.extrabold, fontSize: 33, lineHeight: 37, letterSpacing: -1.2 },
  heading: { fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 25, letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 21 },
  muted: { fontSize: 15, lineHeight: 21, color: colors.mutedForeground },
  label: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  caption: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
  card: {
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.background,
  },
  subtle: { backgroundColor: colors.tint, borderColor: colors.tint },
  brand: { backgroundColor: colors.dark, borderColor: colors.dark },
  field: { gap: 6 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.control,
    backgroundColor: colors.background,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.foreground,
  },
  multiline: { borderRadius: radii.card, minHeight: 100, textAlignVertical: "top" },
  focused: {
    borderColor: colors.primary,
    outlineColor: colors.accent,
    outlineStyle: "solid",
    outlineWidth: 3,
  },
  invalid: { borderColor: colors.destructive },
  error: { color: colors.destructive },
});
