import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";

import { SelectionControl } from "../../shared/selection-control";
import { colors, fonts, radii } from "../../shared/theme";
import { Text } from "../../shared/ui";

export function Choice({
  label,
  detail,
  checked,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  layout,
  ref,
  tabStop,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  layout?: "equal" | "twoColumns";
  ref?: ComponentProps<typeof SelectionControl>["ref"];
  tabStop: boolean;
}) {
  return (
    <SelectionControl
      role="radio"
      selected={checked}
      tabIndex={tabStop ? 0 : -1}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      ref={ref}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        layout === "equal" && styles.grow,
        layout === "twoColumns" && styles.twoColumns,
        checked && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      {detail ? (
        <Text variant="caption" style={checked && styles.light}>
          {detail}
        </Text>
      ) : null}
      <Text
        variant={detail ? "caption" : "label"}
        style={[styles.label, detail && styles.dateLabel, checked && styles.light]}
      >
        {label}
      </Text>
    </SelectionControl>
  );
}

const styles = StyleSheet.create({
  choice: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.control,
    borderColor: colors.border,
    borderWidth: 1,
  },
  grow: { flexGrow: 1, flexBasis: 44, paddingHorizontal: 7 },
  twoColumns: { flexGrow: 1, flexBasis: "44%" },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.72 },
  label: { textAlign: "center" },
  dateLabel: { color: colors.foreground, fontFamily: fonts.bold },
  light: { color: colors.primaryForeground },
});
