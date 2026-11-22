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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/shadcn/dialog";
import { PortalFilter } from "@/shared/ui/select";

const memberRoles = ["Admin", "RH", "Gestor", "Visualizador"] as const;

const memberSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome."),
  email: z.email({ error: "Informe um e-mail válido." }),
  role: z.enum(memberRoles, { error: "Escolha o papel." }),
});

export type NewMember = z.output<typeof memberSchema>;

const textFields = [
  { name: "name", label: "Nome", type: "text" },
  { name: "email", label: "E-mail", type: "email" },
] as const;

export function AddMemberDialog({ onAdd }: { onAdd: (member: NewMember) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const form = useForm({
    defaultValues: { name: "", email: "", role: "" },
    validators: { onSubmit: memberSchema },
    onSubmit: ({ value }) => {
      const member = memberSchema.parse(value);

      setOpen(false);
      form.reset();
      onAdd(member);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          form.reset();
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
        Adicionar pessoa
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            Adicionar pessoa
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
          <DialogBody className="grid gap-5">
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
            <form.Field name="role">
              {(field) => {
                const error = field.state.meta.errors[0]?.message;
                const errorId = `${id}-role-error`;

                return (
                  <div className="grid content-start gap-2">
                    <span className="text-sm font-medium">Papel</span>
                    <PortalFilter
                      label="Papel"
                      className="w-full"
                      value={field.state.value}
                      items={[
                        { value: "", label: "Escolha o papel" },
                        ...memberRoles.map((role) => ({ value: role, label: role })),
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
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="min-h-11" />}>
              <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" aria-hidden="true" />
              Cancelar
            </DialogClose>
            <Button type="submit" className="min-h-11">
              <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" aria-hidden="true" />
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
