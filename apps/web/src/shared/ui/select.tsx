import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./shadcn/select";

type FilterProps = {
  label: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
  value: string;
  items: { label: string; value: string; icon?: ComponentProps<typeof HugeiconsIcon>["icon"] }[];
  onChange: (value: string) => void;
};

export function PortalFilter({
  label,
  id,
  disabled,
  value,
  items,
  onChange,
  className,
  invalid,
  describedBy,
  placeholder,
}: FilterProps) {
  const selectedItem = items.find((item) => item.value === value);
  const unselected = placeholder !== undefined && !selectedItem;

  return (
    <Select
      value={unselected ? null : value}
      disabled={disabled}
      items={items}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger
        id={id}
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
          <SelectValue placeholder={placeholder} />
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
