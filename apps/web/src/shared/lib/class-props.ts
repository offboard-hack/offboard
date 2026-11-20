import { cn } from "./utils";
import type { ClassValue } from "clsx";

export function classProps(...values: ClassValue[]) {
  return { className: cn(values) };
}
