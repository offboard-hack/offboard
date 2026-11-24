import type { ComponentProps } from "react";
import { Platform, Pressable, type PressableProps } from "react-native";

type SelectionControlProps = Omit<
  ComponentProps<typeof Pressable>,
  "role" | "onKeyDown" | "onPress"
> & {
  role: "checkbox" | "radio" | "tab";
  selected: boolean;
  onPress: () => void;
};

export function SelectionControl({
  role,
  selected,
  onPress,
  tabIndex,
  ...props
}: SelectionControlProps) {
  const keyboard: Pick<PressableProps, "onKeyDown"> | undefined =
    Platform.OS === "web"
      ? {
          onKeyDown(event) {
            const { key, repeat } = event.nativeEvent;

            if (key === " " || key === "Spacebar") {
              event.preventDefault();

              if (!repeat) onPress();

              return;
            }

            if (role === "checkbox") return;

            const direction =
              key === "ArrowRight" || (role === "radio" && key === "ArrowDown")
                ? 1
                : key === "ArrowLeft" || (role === "radio" && key === "ArrowUp")
                  ? -1
                  : 0;

            if (!direction && key !== "Home" && key !== "End") return;

            const current = document.activeElement;
            const groupRole = role === "radio" ? "radiogroup" : "tablist";
            const group = current?.closest(`[role="${groupRole}"]`);

            if (!group) return;

            const items = Array.from(group.querySelectorAll<HTMLElement>(`[role="${role}"]`));
            const index = items.findIndex((item) => item === current);

            if (index < 0) return;

            const next =
              key === "Home"
                ? items[0]
                : key === "End"
                  ? items.at(-1)
                  : items[(index + direction + items.length) % items.length];

            event.preventDefault();
            next?.focus();
            next?.click();
          },
        }
      : undefined;

  return (
    <Pressable
      {...props}
      {...keyboard}
      tabIndex={Platform.OS === "web" ? tabIndex : undefined}
      accessibilityRole={role}
      aria-checked={role === "tab" ? undefined : selected}
      aria-selected={role === "tab" ? selected : undefined}
      onPress={onPress}
    />
  );
}
