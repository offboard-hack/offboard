import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { colors, fonts, radii } from "../theme";

type Variant = "primary" | "outline" | "secondary" | "ghost";

type ButtonProps = Pick<PressableProps, "onPress" | "accessibilityLabel" | "disabled"> & {
  label: string;
  variant?: Variant;
  icon?: ReactNode;
  busy?: boolean;
};

const variants = {
  primary: {
    backgroundColor: colors.primary,
    color: colors.primaryForeground,
    borderColor: colors.primary,
  },
  outline: {
    backgroundColor: colors.background,
    color: colors.foreground,
    borderColor: colors.border,
  },
  secondary: { backgroundColor: colors.tint, color: colors.primary, borderColor: colors.tint },
  ghost: { backgroundColor: "transparent", color: colors.primary, borderColor: "transparent" },
};

export function Button({
  label,
  variant = "primary",
  icon,
  busy,
  disabled,
  ...props
}: ButtonProps) {
  const { color, backgroundColor, borderColor } = variants[variant];
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy }}
      disabled={disabled || busy}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderColor: focused ? colors.primary : borderColor },
        focused && styles.focused,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator color={color} size="small" /> : icon}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: radii.control,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  label: { fontFamily: fonts.bold, fontSize: 15, textAlign: "center", flexShrink: 1 },
  focused: { outlineWidth: 3, outlineColor: colors.accent, outlineStyle: "solid" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
});
