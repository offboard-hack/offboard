import { Calendar03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useState } from "react";
import { Button } from "./shadcn/button";
import { Calendar } from "./shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./shadcn/popover";

export function DatePicker({
  id,
  labelledBy,
  value,
  onChange,
  onBlur,
  invalid,
  describedBy,
}: {
  id: string;
  labelledBy: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className="min-h-11 w-full justify-start"
          />
        }
        aria-labelledby={`${labelledBy} ${id}-value`}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onBlur={onBlur}
      >
        <HugeiconsIcon icon={Calendar03Icon} data-icon="inline-start" aria-hidden="true" />
        <span id={`${id}-value`}>
          {selected ? format(selected, "dd/MM/yyyy") : "Escolha a data"}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="menu-tint w-auto p-1" initialFocus={false}>
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected}
          autoFocus
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
