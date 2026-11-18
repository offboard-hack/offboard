import { Progress } from "@base-ui/react/progress";
import * as stylex from "@stylexjs/stylex";
import { colors, motion } from "./theme.stylex";

const styles = stylex.create({
  track: {
    height: "0.375rem",
    overflow: "hidden",
    borderRadius: "1rem",
    backgroundColor: colors.lavender,
  },
  fill: {
    backgroundColor: colors.brand,
    borderRadius: "inherit",
    transitionProperty: {
      default: null,
      "@media (prefers-reduced-motion: no-preference)": "width",
    },
    transitionDuration: motion.popup,
    transitionTimingFunction: motion.easeOut,
  },
});

export function ProgressBar({
  label,
  value,
  max,
  xstyle,
}: {
  label: string;
  value: number;
  max: number;
  xstyle?: stylex.StyleXStyles;
}) {
  return (
    <Progress.Root aria-label={label} value={value} max={max} {...stylex.props(xstyle)}>
      <Progress.Track {...stylex.props(styles.track)}>
        <Progress.Indicator {...stylex.props(styles.fill)} />
      </Progress.Track>
    </Progress.Root>
  );
}
