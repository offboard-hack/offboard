import { Select } from "@base-ui/react/select";
import * as stylex from "@stylexjs/stylex";
import { colors, elevation, motion } from "./theme.stylex";

const animate = "@media (prefers-reduced-motion: no-preference)";
const fading = ":is([data-starting-style], [data-ending-style])";

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    maxWidth: "100%",
    minHeight: "2.75rem",
    paddingInline: "0.75rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: colors.controlBorder,
      ":is([data-popup-open])": colors.brand,
    },
    borderRadius: "0.5rem",
    backgroundColor: {
      default: colors.surface,
      ":hover": colors.wash,
      ":is([data-popup-open])": colors.lavenderSoft,
    },
    color: colors.ink,
    fontSize: "0.875rem",
    cursor: "pointer",
  },
  icon: {
    display: "flex",
    color: colors.muted,
    flexShrink: 0,
  },
  positioner: { zIndex: 2 },
  popup: {
    display: "flex",
    flexDirection: "column",
    minWidth: "var(--anchor-width)",
    maxWidth: "var(--available-width)",
    maxHeight: "var(--available-height)",
    padding: "0.25rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: "0.625rem",
    backgroundColor: colors.surface,
    color: colors.ink,
    boxShadow: elevation.popup,
    opacity: { default: 1, [fading]: 0 },
    scale: { default: 1, [animate]: { default: 1, [fading]: 0.985 } },
    transformOrigin: "var(--transform-origin)",
    transitionProperty: { default: null, [animate]: "opacity, scale" },
    transitionDuration: motion.popup,
    transitionTimingFunction: motion.easeOut,
  },
  list: { overflowY: "auto", overscrollBehavior: "contain" },
  item: {
    display: "grid",
    gridTemplateColumns: "1rem minmax(0, 1fr)",
    alignItems: "center",
    gap: "0.5rem",
    minHeight: "2.5rem",
    padding: "0.375rem 0.625rem",
    borderRadius: "0.375rem",
    fontSize: "0.875rem",
    cursor: "pointer",
    color: { default: colors.ink, ":is([data-selected])": colors.brandHover },
    backgroundColor: {
      default: colors.surface,
      ":is([data-highlighted])": colors.lavenderSoft,
    },
  },
  itemText: { gridColumn: 2, overflowWrap: "anywhere" },
  check: { display: "flex", gridColumn: 1 },
});

type FilterProps = {
  label: string;
  value: string;
  items: { label: string; value: string }[];
  onChange: (value: string) => void;
};

export function PortalFilter({ label, value, items, onChange }: FilterProps) {
  return (
    <Select.Root<string>
      value={value}
      items={items}
      onValueChange={(selection) => onChange(selection ?? "")}
      modal={false}
    >
      <Select.Trigger aria-label={label} {...stylex.props(styles.trigger)}>
        <Select.Value />
        <Select.Icon {...stylex.props(styles.icon)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Positioner
        align="start"
        alignItemWithTrigger={false}
        positionMethod="fixed"
        sideOffset={6}
        {...stylex.props(styles.positioner)}
      >
        <Select.Popup {...stylex.props(styles.popup)}>
          <Select.List aria-label={label} {...stylex.props(styles.list)}>
            {items.map((item) => (
              <Select.Item key={item.value} value={item.value} {...stylex.props(styles.item)}>
                <Select.ItemIndicator {...stylex.props(styles.check)}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="m3.5 8 3 3 6-6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Select.ItemIndicator>
                <Select.ItemText {...stylex.props(styles.itemText)}>{item.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
}
