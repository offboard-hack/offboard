import { DatePicker } from "@/shared/ui/date-picker";
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
  DialogContent,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/shadcn/dialog";
import { PortalFilter } from "@/shared/ui/select";
import { useOffboardingFilters } from "../../entities/offboarding";

const newCaseSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome."),
  role: z.string().trim().min(1, "Informe o cargo."),
  department: z.string().trim().min(1, "Escolha a área."),
  deadline: z.iso.date({ error: "Informe uma data válida." }),
});

export type NewCase = z.output<typeof newCaseSchema>;

const textFields = [
  { name: "name", label: "Nome", type: "text" },
  { name: "role", label: "Cargo", type: "text" },
] as const;

export function NewCaseDialog({ onCreate }: { onCreate: (record: NewCase) => Promise<void> }) {
  const id = useId();
  const { departments } = useOffboardingFilters();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const form = useForm({
    defaultValues: { name: "", role: "", department: "", deadline: "" },
    validators: { onSubmit: newCaseSchema },
    onSubmit: async ({ value }) => {
      setSubmitError(false);

      try {
        await onCreate(newCaseSchema.parse(value));
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
        Desligamento
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            Novo desligamento
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogBody className="grid gap-5 sm:grid-cols-2">
            {textFields.map(({ name, label, type }) => (
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
                        type={type}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.currentTarget.value)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${inputId}-error` : undefined}
                        className="min-h-11"
                        required
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
            <form.Field name="department">
              {(field) => {
                const error = field.state.meta.errors[0]?.message;
                const errorId = `${id}-department-error`;

                return (
                  <div className="grid content-start gap-2">
                    <span className="text-sm font-medium">Área</span>
                    <PortalFilter
                      label="Área"
                      className="w-full"
                      value={field.state.value}
                      items={[
                        { value: "", label: "Escolha a área" },
                        ...departments.map((area) => ({ value: area, label: area })),
                      ]}
                      onChange={field.handleChange}
                      invalid={Boolean(error)}
                      describedBy={error ? errorId : undefined}
                    />
                    {error && (
                      <p id={errorId} className="text-sm text-destructive" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="deadline">
              {(field) => {
                const error = field.state.meta.errors[0]?.message;

                return (
                  <div className="grid content-start gap-2">
                    <Label id={id + "-deadline-label"} htmlFor={id + "-deadline"}>
                      Data de encerramento
                    </Label>
                    <DatePicker
                      id={id + "-deadline"}
                      labelledBy={id + "-deadline-label"}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={field.handleChange}
                      invalid={Boolean(error)}
                      describedBy={error ? id + "-deadline-error" : undefined}
                    />
                    {error && (
                      <p
                        id={id + "-deadline-error"}
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
          </DialogBody>
          {submitError && (
            <p role="alert" className="px-5 py-2 text-sm text-destructive">
              Não foi possível criar o desligamento. Tente novamente.
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
                  {submitting ? "Criando desligamento…" : "Criar desligamento"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
