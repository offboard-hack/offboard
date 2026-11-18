import { Button as BaseButton } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import { portalStyles as s } from "./surface.styles";

const variants = { primary: s.primaryButton, secondary: s.secondaryButton };

export function Button({
  variant = "secondary",
  ...props
}: Omit<BaseButton.Props, "className"> & {
  variant?: keyof typeof variants;
}) {
  return <BaseButton type="button" {...props} {...stylex.props(s.button, variants[variant])} />;
}
