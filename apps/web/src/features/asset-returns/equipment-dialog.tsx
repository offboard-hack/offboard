import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useId, useState } from "react";
import {
  EquipmentChangeError,
  useAssignEquipment,
  useRemoveEquipment,
  useSaveEquipment,
  type EquipmentReturn,
} from "@/entities/equipment-returns";
import { PortalFilter } from "@/shared/ui/select";
import { Button } from "@/shared/ui/shadcn/button";
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
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import {
  assignFormSchema,
  equipmentDefaults,
  equipmentErrorMessage,
  equipmentFormSchema,
  equipmentPayload,
  returnMethods,
} from "./equipment-form";

type CaseOption = { id: string; name: string };

const textFields = [
  { name: "item", label: "Item", placeholder: "Notebook Dell Latitude 5440" },
  { name: "tag", label: "Patrimônio", placeholder: "AUR-0412" },
] as const;

export function EquipmentDialog({ cases, item }: { cases: CaseOption[]; item?: EquipmentReturn }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const save = useSaveEquipment(item?.id);

  const form = useForm({
    defaultValues: equipmentDefaults(item),
    validators: { onSubmit: equipmentFormSchema },
    onSubmit: ({ value }) =>
      save.mutate(equipmentPayload(equipmentFormSchema.parse(value)), {
        onSuccess: () => {
          setOpen(false);
          form.reset();
        },
      }),
  });

  const failure = save.error instanceof EquipmentChangeError ? save.error.code : undefined;
  const title = item ? "Editar bem" : "Adicionar bem";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          form.reset();
          save.reset();
        }
      }}
    >
      <DialogTrigger
        render={
          item ? (
            <Button variant="ghost" size="sm" aria-label={`Editar ${item.code}`} />
          ) : (
            <Button />
          )
        }
      >
        {item ? (
          "Editar"
        ) : (
          <>
            <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
            Adicionar bem
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            {title}
          </DialogTitle>
          <DialogDescription>
            O bem aparece para a pessoa na área do colaborador, onde ela agenda a devolução. Sem
            desligamento, ele fica no estoque até ser vinculado.
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
            <form.Field name="caseId">
              {(field) => (
                <div className="grid content-start gap-2">
                  <span className="text-sm font-medium">Desligamento</span>
                  <PortalFilter
                    label="Desligamento"
                    className="w-full"
                    disabled={Boolean(item)}
                    value={field.state.value}
                    items={[
                      { value: "", label: "Sem desligamento (estoque)" },
                      ...cases.map(({ id: value, name }) => ({ value, label: name })),
                    ]}
                    onChange={field.handleChange}
                  />
                </div>
              )}
            </form.Field>
            {!item && (
              <form.Subscribe selector={(state) => state.values.caseId}>
                {(caseId) =>
                  caseId ? null : (
                    <form.Field name="email">
                      {(field) => {
                        const inputId = `${id}-email`;
                        const error = field.state.meta.errors[0]?.message;

                        return (
                          <div className="grid content-start gap-2">
                            <Label htmlFor={inputId}>E-mail da pessoa (opcional)</Label>
                            <Input
                              id={inputId}
                              name={field.name}
                              type="email"
                              placeholder="nome@empresa.com"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.currentTarget.value)}
                              aria-invalid={Boolean(error)}
                              aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
                              className="min-h-11"
                            />
                            <p id={`${inputId}-hint`} className="text-sm text-muted-foreground">
                              E-mail corporativo ou pessoal. O bem entra no desligamento que usa
                              este e-mail, agora ou quando ele for criado.
                            </p>
                            {error && (
                              <p
                                id={`${inputId}-error`}
                                role="alert"
                                className="text-sm text-destructive"
                              >
                                {error}
                              </p>
                            )}
                          </div>
                        );
                      }}
                    </form.Field>
                  )
                }
              </form.Subscribe>
            )}
            {textFields.map(({ name, label, placeholder }) => (
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
                        placeholder={placeholder}
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
                          role="alert"
                          className="text-sm text-destructive"
                        >
                          {error}
                        </p>
                      )}
                    </div>
                  );
                }}
              </form.Field>
            ))}
            <form.Field name="returnMethod">
              {(field) => (
                <div className="grid content-start gap-2">
                  <span className="text-sm font-medium">Como volta</span>
                  <PortalFilter
                    label="Como volta"
                    className="w-full"
                    value={field.state.value}
                    items={[...returnMethods]}
                    onChange={field.handleChange}
                  />
                </div>
              )}
            </form.Field>
            {save.isError && (
              <p role="alert" className="text-sm text-destructive">
                {equipmentErrorMessage(failure)}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-11" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" className="min-h-11" disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssignEquipmentDialog({ item }: { item: EquipmentReturn }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const assign = useAssignEquipment(item.id);
  const failure = assign.error instanceof EquipmentChangeError ? assign.error.code : undefined;

  const form = useForm({
    defaultValues: { email: item.holderEmail ?? "" },
    validators: { onSubmit: assignFormSchema },
    onSubmit: ({ value }) =>
      assign.mutate(assignFormSchema.parse(value).email, {
        onSuccess: () => {
          setOpen(false);
          form.reset();
        },
      }),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          form.reset();
          assign.reset();
        }
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="sm" aria-label={`Vincular ${item.code}`} />}
      >
        Vincular
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular {item.code}</DialogTitle>
          <DialogDescription>
            Informe o e-mail corporativo ou pessoal de quem vai devolver {item.title}. O bem entra
            no desligamento dessa pessoa.
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
          <DialogBody className="grid gap-3">
            <form.Field name="email">
              {(field) => {
                const inputId = `${id}-email`;
                const error = field.state.meta.errors[0]?.message;

                return (
                  <div className="grid content-start gap-2">
                    <Label htmlFor={inputId}>E-mail da pessoa</Label>
                    <Input
                      id={inputId}
                      name={field.name}
                      type="email"
                      placeholder="nome@empresa.com"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${inputId}-error` : undefined}
                      className="min-h-11"
                      required
                    />
                    {error && (
                      <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            {assign.isError && (
              <p role="alert" className="text-sm text-destructive">
                {equipmentErrorMessage(failure)}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-11" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" className="min-h-11" disabled={assign.isPending}>
              {assign.isPending ? "Vinculando…" : "Vincular"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveEquipmentDialog({ item }: { item: EquipmentReturn }) {
  const [open, setOpen] = useState(false);
  const remove = useRemoveEquipment(item.id);
  const failure = remove.error instanceof EquipmentChangeError ? remove.error.code : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) remove.reset();
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            aria-label={`Remover ${item.code}`}
          />
        }
      >
        Remover
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remover {item.code}?</DialogTitle>
          <DialogDescription>
            {item.person
              ? `${item.title} deixa de aparecer para ${item.person} e sai do inventário.`
              : `${item.title} sai do inventário.`}
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <DialogBody>
            <p role="alert" className="text-sm text-destructive">
              {equipmentErrorMessage(failure)}
            </p>
          </DialogBody>
        )}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="min-h-11" />}>
            Cancelar
          </DialogClose>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => setOpen(false) })}
          >
            {remove.isPending ? "Removendo…" : "Remover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
