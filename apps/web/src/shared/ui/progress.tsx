import { cn } from "../lib/utils";
import { Progress } from "./shadcn/progress";

export function ProgressBar({
  label,
  value,
  max,
  xstyle,
}: {
  label: string;
  value: number;
  max: number;
  xstyle?: string;
}) {
  return (
    <Progress
      aria-label={label}
      aria-valuetext={`${value} de ${max}`}
      value={value}
      max={Math.max(1, max)}
      className={cn("w-full", xstyle)}
    />
  );
}
