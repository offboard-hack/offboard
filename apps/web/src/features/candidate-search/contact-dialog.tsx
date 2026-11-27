import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { getApiClient } from "@/shared/lib/api-client";
import { Button } from "@/shared/ui/shadcn/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/shadcn/dialog";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Textarea } from "@/shared/ui/shadcn/textarea";
import {
  type ContactDraft,
  type ContactField,
  contactBody,
  contactFailure,
  contactProblems,
  emptyContact,
  firstName,
} from "./contact-form";

class ContactFailed extends Error {}

const fields: { key: Exclude<ContactField, "message">; label: string; type: string }[] = [
  { key: "name", label: "Seu nome", type: "text" },
  { key: "email", label: "Seu e-mail", type: "email" },
  { key: "company", label: "Empresa (opcional)", type: "text" },
];

export function ContactDialog({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ContactDraft>(emptyContact);
  const [checked, setChecked] = useState(false);
  const formId = useId();
  const problems = contactProblems(draft);
  const person = firstName(name);

  const send = useMutation({
    mutationFn: async () => {
      const result = await getApiClient().api.candidates({ id }).contact.post(contactBody(draft));

      if (result.error !== null) throw new ContactFailed(contactFailure(result.status));
    },
  });

  const error = (key: ContactField) => (checked ? problems[key] : undefined);

  return (
    <>
      <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <HugeiconsIcon icon={Mail01Icon} aria-hidden="true" /> Entrar em contato
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);

          if (!next && send.isSuccess) {
            setDraft(emptyContact);
            setChecked(false);
            send.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Falar com {person}</DialogTitle>
            <DialogDescription>
              Para confirmar que o e-mail é seu, mandamos um link para ele. A mensagem só chega a{" "}
              {person} depois que você abrir o link. O e-mail de {person} não é mostrado.
            </DialogDescription>
          </DialogHeader>
          {send.isSuccess ? (
            <DialogBody>
              <p role="status" className="text-sm">
                Confira seu e-mail. Abra o link que mandamos para {draft.email.trim()} em até 24
                horas para enviar a mensagem a {person}.
              </p>
            </DialogBody>
          ) : (
            <DialogBody>
              <form
                id={formId}
                noValidate
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  setChecked(true);

                  if (Object.keys(problems).length === 0) send.mutate();
                }}
              >
                {fields.map((field) => (
                  <div key={field.key} className="grid gap-1.5">
                    <Label htmlFor={`${formId}-${field.key}`}>{field.label}</Label>
                    <Input
                      id={`${formId}-${field.key}`}
                      type={field.type}
                      value={draft[field.key]}
                      aria-invalid={error(field.key) ? true : undefined}
                      aria-describedby={
                        error(field.key) ? `${formId}-${field.key}-error` : undefined
                      }
                      onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                    />
                    {error(field.key) ? (
                      <p id={`${formId}-${field.key}-error`} className="text-sm text-destructive">
                        {error(field.key)}
                      </p>
                    ) : null}
                  </div>
                ))}
                <div className="grid gap-1.5">
                  <Label htmlFor={`${formId}-message`}>Mensagem</Label>
                  <Textarea
                    id={`${formId}-message`}
                    rows={5}
                    value={draft.message}
                    placeholder="Conte sobre a vaga e por que o perfil chamou sua atenção."
                    aria-invalid={error("message") ? true : undefined}
                    aria-describedby={error("message") ? `${formId}-message-error` : undefined}
                    onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                  />
                  {error("message") ? (
                    <p id={`${formId}-message-error`} className="text-sm text-destructive">
                      {error("message")}
                    </p>
                  ) : null}
                </div>
                {send.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {send.error.message}
                  </p>
                ) : null}
              </form>
            </DialogBody>
          )}
          <DialogFooter>
            {send.isSuccess ? (
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" form={formId} disabled={send.isPending}>
                  {send.isPending ? "Enviando…" : "Enviar mensagem"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
