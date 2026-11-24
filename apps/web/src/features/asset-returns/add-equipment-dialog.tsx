import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useState } from "react";
import { Button } from "@/shared/ui/shadcn/button";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/shadcn/dialog";

const equipmentSchema = z.object({
  item: z.string().trim().min(1, "Informe o item."),
  tag: z.string().trim().min(1, "Informe o patrimônio."),
  serialNumber: z.string().trim(),
});

export type NewEquipmentInput = z.output<typeof equipmentSchema>;

const fields = [
  { name: "item", label: "Item", placeholder: "Notebook Dell Latitude 5540" },
  { name: "tag", label: "Patrimônio", placeholder: "PAT-0412" },
  { name: "serialNumber", label: "Número de série", placeholder: "Opcional" },
] as const;

export function AddEquipmentDialog({
  onAdd,
}: {
  onAdd: (item: NewEquipmentInput) => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const form = useForm({
    defaultValues: { item: "", tag: "", serialNumber: "" },
    validators: { onSubmit: equipmentSchema },
    onSubmit: async ({ value }) => {
      setSubmitError(false);

      try {
        await onAdd(equipmentSchema.parse(value));
        setOpen(false);
        form.reset();
      } catch {
        setSubmitError(true);
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          setSubmitError(false);
          form.reset();
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
        Adicionar item
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            Adicionar item
          </DialogTitle>
          <DialogDescription>
            O item entra no inventário e fica disponível no estoque.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogBody className="grid gap-5">
            {fields.map(({ name, label, placeholder }) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const inputId = `${id}-${name}`;
                  const error = field.state.meta.errors[0]?.message;

                  return (
                    <div className="grid content-start gap-2">
                      <Label htmlFor={inputId}>{label}</Label>
                      <Input
                        id={inputId}
                        name={field.name}
                        type="text"
                        placeholder={placeholder}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.currentTarget.value)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${inputId}-error` : undefined}
                        className="min-h-11"
                      />
                      {error && (
                        <p
                          id={`${inputId}-error`}
                          className="text-sm text-destructive"
                          role="alert"
                        >
                          {error}
                        </p>
                      )}
                    </div>
                  );
                }}
              </form.Field>
            ))}
          </DialogBody>
          {submitError && (
            <p role="alert" className="px-5 py-2 text-sm text-destructive">
              Não foi possível adicionar o item. Confira se o patrimônio já foi cadastrado.
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="min-h-11" />}>
              <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" aria-hidden="true" />
              Cancelar
            </DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <Button type="submit" className="min-h-11" disabled={submitting}>
                  <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" aria-hidden="true" />
                  {submitting ? "Adicionando…" : "Adicionar"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
