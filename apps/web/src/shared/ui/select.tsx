import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./shadcn/select";

type FilterProps = {
  label: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  value: string;
  items: { label: string; value: string; icon?: ComponentProps<typeof HugeiconsIcon>["icon"] }[];
  onChange: (value: string) => void;
};

export function PortalFilter({
  label,
  value,
  items,
  onChange,
  className,
  invalid,
  describedBy,
}: FilterProps) {
  const selectedItem = items.find((item) => item.value === value);

  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cn("min-h-11 max-w-full border-input", className)}
      >
        {selectedItem?.icon ? (
          <SelectValue className="min-w-0">
            <HugeiconsIcon
              icon={selectedItem.icon}
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{selectedItem.label}</span>
          </SelectValue>
        ) : (
          <SelectValue />
        )}
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} aria-label={label}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="min-h-10">
            {item.icon && (
              <HugeiconsIcon
                icon={item.icon}
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
