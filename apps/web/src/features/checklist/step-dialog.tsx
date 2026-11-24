import { createLocalId } from "@/shared/lib/create-local-id";
import {
  Add01Icon,
  Cancel01Icon,
  Delete02Icon,
  EqualSignIcon,
  FilterHorizontalIcon,
  InformationCircleIcon,
  Link01Icon,
  NotEqualSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useId, useRef, useState } from "react";
import { useOffboardingFilters } from "@/entities/offboarding";
import { PortalFilter } from "@/shared/ui/select";
import { Badge } from "@/shared/ui/shadcn/badge";
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
} from "@/shared/ui/shadcn/dialog";
import { Empty, EmptyMedia } from "@/shared/ui/shadcn/empty";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/shadcn/tooltip";
import { getPhase, type ChecklistStep, type Placement } from "./checklist-draft";
import { stepFormSchema, type StepSettings } from "./step-settings";

type DialogControls = {
  open: boolean;
  onClose: () => void;
  onClosed: () => void;
  focusId: string;
};

const ruleFields = [
  { value: "department", label: "Área" },
  { value: "role", label: "Cargo" },
] as const;

const ruleOperators = [
  { value: "equals", label: "É igual a", icon: EqualSignIcon },
  { value: "notEquals", label: "É diferente de", icon: NotEqualSignIcon },
] as const;

const emptySettings = "gap-2.5 rounded-xl border border-dashed bg-muted/55 px-4 py-4";

function SettingsHeading({ id, title, help }: { id: string; title: string; help: string }) {
  const [open, setOpen] = useState(false);
  const triggerId = `${id}-help`;
  const tooltipId = `${id}-tooltip`;

  return (
    <div className="flex items-center gap-1">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      <TooltipProvider delay={250}>
        <Tooltip open={open} onOpenChange={setOpen} triggerId={triggerId}>
          <TooltipTrigger
            id={triggerId}
            aria-label={`Sobre ${title.toLocaleLowerCase("pt-BR")}`}
            aria-describedby={open ? tooltipId : undefined}
            closeOnClick={false}
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground pointer-coarse:size-10"
              />
            }
            onClick={() => setOpen(true)}
          >
            <HugeiconsIcon icon={InformationCircleIcon} aria-hidden="true" className="size-4" />
          </TooltipTrigger>
          <TooltipContent
            id={tooltipId}
            role="tooltip"
            side="right"
            sideOffset={8}
            className="max-w-56"
          >
            <p>{help}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function StepDialog({
  step,
  placement,
  focusId,
  open,
  onClose,
  onClosed,
  onSave,
  onRequestDelete,
}: DialogControls & {
  step?: ChecklistStep;
  placement: Placement;
  onSave: (settings: StepSettings) => void;
  onRequestDelete?: () => void;
}) {
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const { departments } = useOffboardingFilters();

  const departmentOptions = [
    { value: "", label: "Escolha uma área" },
    ...departments.map((department) => ({ value: department, label: department })),
  ];

  const form = useForm({
    defaultValues: {
      title: step?.title ?? "",
      deadlineOffset: step?.deadlineOffset ?? null,
      rules: step?.rules ?? [],
      email: step?.email ?? null,
      slack: step?.slack ?? null,
      webhook: step?.webhook ?? null,
    } satisfies StepSettings,
    validators: { onSubmit: stepFormSchema },
    onSubmit: ({ value }) => onSave(stepFormSchema.parse(value)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed();
      }}
    >
      <DialogContent
        initialFocus={nameInput}
        finalFocus={() => document.getElementById(focusId)}
        className="sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold">
            {step ? "Editar etapa" : "Nova etapa"}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Badge variant="secondary">{placement.team}</Badge>
            <span>{getPhase(placement.phase).label}</span>
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
            <form.Field name="title">
              {(field) => {
                const error = field.state.meta.errors[0]?.message;

                return (
                  <div className="grid gap-2">
                    <Input
                      ref={nameInput}
                      id={`${id}-title`}
                      aria-label="Nome da etapa"
                      placeholder="Nome da etapa"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      required
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${id}-title-error` : undefined}
                      className="h-11 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20"
                    />
                    {error && (
                      <p id={`${id}-title-error`} role="alert" className="text-destructive">
                        {error}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="deadlineOffset">
              {(field) => (
                <div className="grid content-start gap-2">
                  <Label htmlFor={`${id}-offset`}>Prazo relativo ao desligamento (dias)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${id}-offset`}
                      type="number"
                      min={-90}
                      max={90}
                      placeholder="Ex: -3, 0, 7"
                      value={field.state.value ?? ""}
                      onChange={(event) => {
                        const raw = event.currentTarget.value;
                        field.handleChange(raw === "" ? null : Number(raw));
                      }}
                      className="h-11 max-w-40"
                    />
                    <span className="text-sm text-muted-foreground">
                      {field.state.value == null
                        ? "Sem prazo definido"
                        : field.state.value === 0
                          ? "No dia do desligamento"
                          : field.state.value > 0
                            ? `${field.state.value} dia${field.state.value !== 1 ? "s" : ""} depois`
                            : `${Math.abs(field.state.value)} dia${Math.abs(field.state.value) !== 1 ? "s" : ""} antes`}
                    </span>
                  </div>
                </div>
              )}
            </form.Field>
            <section aria-labelledby={`${id}-rules`} className="grid gap-3">
              <form.Field name="rules">
                {(field) => {
                  const heading = (
                    <SettingsHeading
                      id={`${id}-rules`}
                      title="Regras"
                      help="Todas as condições precisam ser atendidas. Sem regras, a etapa vale para todos."
                    />
                  );

                  const addCondition = (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        form.pushFieldValue("rules", {
                          id: createLocalId(),
                          field: "department",
                          operator: "equals",
                          value: "",
                        })
                      }
                    >
                      <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
                      Adicionar condição
                    </Button>
                  );

                  if (field.state.value.length === 0) {
                    return (
                      <>
                        {heading}
                        <Empty className={emptySettings}>
                          <EmptyMedia className="mb-0 text-muted-foreground">
                            <HugeiconsIcon
                              icon={FilterHorizontalIcon}
                              className="size-5"
                              aria-hidden="true"
                            />
                          </EmptyMedia>
                          {addCondition}
                        </Empty>
                      </>
                    );
                  }

                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {heading}
                        {addCondition}
                      </div>
                      {field.state.value.map((rule, index) => (
                        <div
                          key={rule.id}
                          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-xl border bg-muted/25 p-2"
                        >
                          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
                            <form.Field name={`rules[${index}].field`}>
                              {(attribute) => (
                                <PortalFilter
                                  label={`Campo da condição ${index + 1}`}
                                  className="w-full"
                                  value={attribute.state.value}
                                  items={[...ruleFields]}
                                  onChange={(value) => {
                                    const next = ruleFields.find((item) => item.value === value);

                                    if (next && next.value !== attribute.state.value) {
                                      attribute.handleChange(next.value);
                                      form.setFieldValue(`rules[${index}].value`, "");
                                    }
                                  }}
                                />
                              )}
                            </form.Field>
                            <form.Field name={`rules[${index}].operator`}>
                              {(operator) => (
                                <PortalFilter
                                  label={`Comparação da condição ${index + 1}`}
                                  className="w-full"
                                  value={operator.state.value}
                                  items={[...ruleOperators]}
                                  onChange={(value) => {
                                    const next = ruleOperators.find((item) => item.value === value);

                                    if (next) operator.handleChange(next.value);
                                  }}
                                />
                              )}
                            </form.Field>
                            <form.Field name={`rules[${index}].value`}>
                              {(value) => {
                                const error = value.state.meta.errors[0]?.message;
                                const errorId = `${id}-rule-${rule.id}-error`;

                                return (
                                  <div className="grid min-w-0 gap-1">
                                    {rule.field === "department" ? (
                                      <PortalFilter
                                        label={`Área da condição ${index + 1}`}
                                        className="w-full"
                                        value={value.state.value}
                                        items={departmentOptions}
                                        onChange={value.handleChange}
                                        invalid={Boolean(error)}
                                        describedBy={error ? errorId : undefined}
                                      />
                                    ) : (
                                      <Input
                                        className="h-11"
                                        aria-label={`Cargo da condição ${index + 1}`}
                                        placeholder="Nome do cargo"
                                        value={value.state.value}
                                        onChange={(event) =>
                                          value.handleChange(event.currentTarget.value)
                                        }
                                        aria-invalid={Boolean(error)}
                                        aria-describedby={error ? errorId : undefined}
                                      />
                                    )}
                                    {error && (
                                      <p id={errorId} role="alert" className="text-destructive">
                                        {error}
                                      </p>
                                    )}
                                  </div>
                                );
                              }}
                            </form.Field>
                          </div>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon-sm"
                            className="mt-1.5"
                            aria-label={`Remover condição ${index + 1}`}
                            onClick={() => form.removeFieldValue("rules", index)}
                          >
                            <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </>
                  );
                }}
              </form.Field>
            </section>
            <section aria-labelledby={`${id}-actions`} className="grid gap-3 border-t pt-5">
              <SettingsHeading
                id={`${id}-actions`}
                title="Ações"
                help="Configure notificações automáticas disparadas quando a etapa mudar de status."
              />
              <form.Field name="email">
                {(field) =>
                  field.state.value === null ? (
                    <Empty className={emptySettings}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => field.handleChange({ subject: "", body: "" })}
                      >
                        <img
                          src="/brands/gmail.png"
                          alt=""
                          width={16}
                          height={16}
                          className="shrink-0"
                        />
                        Enviar e-mail
                      </Button>
                    </Empty>
                  ) : (
                    <div className="grid gap-3 rounded-xl border bg-muted/25 p-3 sm:p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-semibold">
                          <img
                            src="/brands/gmail.png"
                            alt=""
                            width={16}
                            height={16}
                            className="shrink-0"
                          />
                          Enviar e-mail
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          aria-label="Remover ação de e-mail"
                          onClick={() => field.handleChange(null)}
                        >
                          <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                        </Button>
                      </div>
                      <form.Field name="email.subject">
                        {(input) => {
                          const error = input.state.meta.errors[0]?.message;

                          return (
                            <div className="grid gap-1.5">
                              <Label htmlFor={`${id}-subject`}>Assunto</Label>
                              <Input
                                id={`${id}-subject`}
                                className="h-10"
                                value={input.state.value ?? ""}
                                onChange={(event) => input.handleChange(event.currentTarget.value)}
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? `${id}-subject-error` : undefined}
                              />
                              {error && (
                                <p
                                  id={`${id}-subject-error`}
                                  role="alert"
                                  className="text-destructive"
                                >
                                  {error}
                                </p>
                              )}
                            </div>
                          );
                        }}
                      </form.Field>
                      <form.Field name="email.body">
                        {(input) => {
                          const error = input.state.meta.errors[0]?.message;

                          return (
                            <div className="grid gap-1.5">
                              <Label htmlFor={`${id}-email-body`}>Mensagem</Label>
                              <textarea
                                id={`${id}-email-body`}
                                rows={3}
                                className="w-full min-w-0 resize-y rounded-xl border border-input bg-input/30 px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
                                value={input.state.value ?? ""}
                                onChange={(event) => input.handleChange(event.currentTarget.value)}
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? `${id}-email-body-error` : undefined}
                              />
                              {error && (
                                <p
                                  id={`${id}-email-body-error`}
                                  role="alert"
                                  className="text-destructive"
                                >
                                  {error}
                                </p>
                              )}
                            </div>
                          );
                        }}
                      </form.Field>
                    </div>
                  )
                }
              </form.Field>
              <form.Field name="slack">
                {(field) =>
                  field.state.value === null ? (
                    <Empty className={emptySettings}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => field.handleChange({ channel: "", message: "" })}
                      >
                        <img
                          src="/brands/slack.svg"
                          alt=""
                          width={16}
                          height={16}
                          className="shrink-0"
                        />
                        Notificar no Slack
                      </Button>
                    </Empty>
                  ) : (
                    <div className="grid gap-3 rounded-xl border bg-muted/25 p-3 sm:p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-semibold">
                          <img
                            src="/brands/slack.svg"
                            alt=""
                            width={16}
                            height={16}
                            className="shrink-0"
                          />
                          Notificar no Slack
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          aria-label="Remover ação do Slack"
                          onClick={() => field.handleChange(null)}
                        >
                          <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                        </Button>
                      </div>
                      <form.Field name="slack.channel">
                        {(input) => {
                          const error = input.state.meta.errors[0]?.message;

                          return (
                            <div className="grid gap-1.5">
                              <Label htmlFor={`${id}-slack-channel`}>Canal</Label>
                              <Input
                                id={`${id}-slack-channel`}
                                className="h-10"
                                placeholder="#geral"
                                value={input.state.value ?? ""}
                                onChange={(event) => input.handleChange(event.currentTarget.value)}
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? `${id}-slack-channel-error` : undefined}
                              />
                              {error && (
                                <p
                                  id={`${id}-slack-channel-error`}
                                  role="alert"
                                  className="text-destructive"
                                >
                                  {error}
                                </p>
                              )}
                            </div>
                          );
                        }}
                      </form.Field>
                      <form.Field name="slack.message">
                        {(input) => {
                          const error = input.state.meta.errors[0]?.message;

                          return (
                            <div className="grid gap-1.5">
                              <Label htmlFor={`${id}-slack-message`}>Mensagem</Label>
                              <textarea
                                id={`${id}-slack-message`}
                                rows={3}
                                className="w-full min-w-0 resize-y rounded-xl border border-input bg-input/30 px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
                                value={input.state.value ?? ""}
                                onChange={(event) => input.handleChange(event.currentTarget.value)}
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? `${id}-slack-message-error` : undefined}
                              />
                              {error && (
                                <p
                                  id={`${id}-slack-message-error`}
                                  role="alert"
                                  className="text-destructive"
                                >
                                  {error}
                                </p>
                              )}
                            </div>
                          );
                        }}
                      </form.Field>
                    </div>
                  )
                }
              </form.Field>
              <form.Field name="webhook">
                {(field) =>
                  field.state.value === null ? (
                    <Empty className={emptySettings}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => field.handleChange({ url: "", method: "POST" })}
                      >
                        <HugeiconsIcon
                          icon={Link01Icon}
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                        Chamar webhook
                      </Button>
                    </Empty>
                  ) : (
                    <div className="grid gap-3 rounded-xl border bg-muted/25 p-3 sm:p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-semibold">
                          <HugeiconsIcon
                            icon={Link01Icon}
                            className="size-4 shrink-0"
                            aria-hidden="true"
                          />
                          Chamar webhook
                        </div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          aria-label="Remover ação de webhook"
                          onClick={() => field.handleChange(null)}
                        >
                          <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                        <form.Field name="webhook.method">
                          {(input) => (
                            <PortalFilter
                              label="Método HTTP"
                              className="w-full"
                              value={input.state.value ?? "POST"}
                              items={[
                                { value: "POST", label: "POST" },
                                { value: "PUT", label: "PUT" },
                              ]}
                              onChange={(value) => {
                                if (value === "POST" || value === "PUT") input.handleChange(value);
                              }}
                            />
                          )}
                        </form.Field>
                        <form.Field name="webhook.url">
                          {(input) => {
                            const error = input.state.meta.errors[0]?.message;

                            return (
                              <div className="grid gap-1.5">
                                <Input
                                  id={`${id}-webhook-url`}
                                  className="h-11"
                                  aria-label="URL do webhook"
                                  placeholder="https://example.com/webhook"
                                  value={input.state.value ?? ""}
                                  onChange={(event) =>
                                    input.handleChange(event.currentTarget.value)
                                  }
                                  aria-invalid={Boolean(error)}
                                  aria-describedby={error ? `${id}-webhook-url-error` : undefined}
                                />
                                {error && (
                                  <p
                                    id={`${id}-webhook-url-error`}
                                    role="alert"
                                    className="text-destructive"
                                  >
                                    {error}
                                  </p>
                                )}
                              </div>
                            );
                          }}
                        </form.Field>
                      </div>
                    </div>
                  )
                }
              </form.Field>
            </section>
          </DialogBody>
          <DialogFooter className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {onRequestDelete && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onRequestDelete}
              >
                <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                Excluir
              </Button>
            )}
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <DialogClose render={<Button variant="ghost" />}>
                <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
                Cancelar
              </DialogClose>
              <Button type="submit">
                <HugeiconsIcon icon={step ? Tick02Icon : Add01Icon} aria-hidden="true" />
                {step ? "Salvar" : "Criar etapa"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteStepDialog({
  step,
  focusId,
  open,
  onClose,
  onClosed,
  onDelete,
}: DialogControls & {
  step: ChecklistStep;
  onDelete: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed();
      }}
    >
      <DialogContent
        initialFocus={cancelButton}
        finalFocus={() => document.getElementById(focusId)}
      >
        <DialogHeader>
          <DialogTitle>Excluir etapa?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription>“{step.title}” será removida deste rascunho.</DialogDescription>
        </DialogBody>
        <DialogFooter>
          <DialogClose ref={cancelButton} render={<Button variant="outline" />}>
            <HugeiconsIcon icon={Cancel01Icon} aria-hidden="true" />
            Cancelar
          </DialogClose>
          <Button variant="destructive" onClick={onDelete}>
            <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
            Excluir etapa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
