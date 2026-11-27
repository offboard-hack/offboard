import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
  SlackSettingsError,
  slackSettingsQuery,
  useRemoveSlack,
  useSaveSlack,
} from "@/entities/integration";
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
import { slackErrorMessage, slackTokenSchema } from "./slack-settings";

const setupSteps = [
  <>
    Acesse{" "}
    <a
      href="https://api.slack.com/apps"
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline underline-offset-2"
    >
      api.slack.com/apps
    </a>
    , clique em <b>Create New App → From scratch</b> e escolha o workspace da empresa.
  </>,
  <>
    Em <b>OAuth &amp; Permissions</b>, adicione os Bot Token Scopes <code>chat:write</code> e{" "}
    <code>chat:write.public</code>.
  </>,
  <>
    Clique em <b>Install to Workspace</b> e autorize.
  </>,
  <>
    Copie o <b>Bot User OAuth Token</b> (começa com <code>xoxb-</code>) e cole abaixo.
  </>,
  <>
    Para canais privados, convide o bot no canal com <code>/invite @nome-do-app</code>.
  </>,
];

export function SlackDialog({ connected }: { connected: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const settings = useQuery({ ...slackSettingsQuery, enabled: open });
  const save = useSaveSlack();
  const remove = useRemoveSlack();
  const current = settings.data?.configured ? settings.data : undefined;

  const form = useForm({
    defaultValues: { botToken: "" },
    onSubmit: ({ value }) =>
      save.mutate(slackTokenSchema.parse(value.botToken), { onSuccess: () => form.reset() }),
  });

  const error = save.error ?? remove.error;
  const failure = error instanceof SlackSettingsError ? error.code : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          form.reset();
          save.reset();
          remove.reset();
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" className="min-h-10" />}>
        {connected ? "Gerenciar" : "Configurar"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            Configurar Slack
          </DialogTitle>
          <DialogDescription>
            O Offboard avisa as áreas em canais do Slack quando uma etapa do checklist muda de
            status. Ele usa um app criado no workspace da sua empresa.
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
            {current && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm"
              >
                <span>
                  Conectado
                  {current.team ? (
                    <>
                      {" "}
                      a <b>{current.team}</b>
                    </>
                  ) : null}
                  {current.tokenHint ? ` · token terminado em ${current.tokenHint}` : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 text-destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? "Removendo…" : "Remover conexão"}
                </Button>
              </div>
            )}
            <ol className="grid list-decimal gap-2 pl-5 text-sm text-muted-foreground marker:text-foreground">
              {setupSteps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
            <form.Field name="botToken" validators={{ onSubmit: slackTokenSchema }}>
              {(field) => {
                const inputId = `${id}-token`;
                const fieldError = field.state.meta.errors[0]?.message;
                const message = fieldError ?? (error ? slackErrorMessage(failure) : undefined);

                return (
                  <div className="grid content-start gap-2">
                    <Label htmlFor={inputId}>
                      {current ? "Trocar token" : "Bot User OAuth Token"}
                    </Label>
                    <Input
                      id={inputId}
                      name={field.name}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="xoxb-…"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      aria-invalid={Boolean(message)}
                      aria-describedby={message ? `${inputId}-error` : `${inputId}-hint`}
                      className="min-h-11 font-mono"
                    />
                    {message ? (
                      <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                        {message}
                      </p>
                    ) : (
                      <p id={`${inputId}-hint`} className="text-sm text-muted-foreground">
                        Testamos o token no Slack antes de salvar. Depois, escolha o canal em cada
                        etapa do checklist, em “Notificar no Slack”.
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" className="min-h-11" />}>
              Fechar
            </DialogClose>
            <Button type="submit" className="min-h-11" disabled={save.isPending}>
              {save.isPending ? "Testando…" : "Salvar e testar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
