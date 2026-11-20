import type { ComponentProps } from "react";
import { Button as ShadcnButton } from "./shadcn/button";

export function Button({
  variant = "secondary",
  ...props
}: Omit<ComponentProps<typeof ShadcnButton>, "variant"> & { variant?: "primary" | "secondary" }) {
  return (
    <ShadcnButton
      type="button"
      size="lg"
      variant={variant === "primary" ? "default" : "outline"}
      className="min-h-11"
      {...props}
    />
  );
}
