import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useState } from "react";
import type { AutomationRule, NewAutomationRule } from "@/entities/automation-rule";
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
} from "@/shared/ui/shadcn/dialog";
import { Input } from "@/shared/ui/shadcn/input";
import { Label } from "@/shared/ui/shadcn/label";
import { Switch } from "@/shared/ui/shadcn/switch";
import {
  defaultActionsJson,
  parseActions,
  parseConditions,
  ruleTriggerSchema,
  triggerItems,
} from "./rule-form";

const textareaClass =
  "min-h-32 w-full rounded-2xl border border-input bg-input/30 px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive";

type Errors = Partial<
  Record<"name" | "trigger" | "cronSchedule" | "conditions" | "actions" | "submit", string>
>;

export function RuleDialog({
  rule,
  onClose,
  onSubmit,
}: {
  rule: AutomationRule | null;
  onClose: () => void;
  onSubmit: (rule: NewAutomationRule) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<string>(rule?.trigger ?? "");
  const [cronSchedule, setCronSchedule] = useState(rule?.cronSchedule ?? "");

  const [conditions, setConditions] = useState(() =>
    JSON.stringify(rule?.conditions ?? {}, null, 2),
  );

  const [actions, setActions] = useState(() =>
    rule ? JSON.stringify(rule.actions, null, 2) : defaultActionsJson,
  );

  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const parsedConditions = parseConditions(conditions);
    const parsedActions = parseActions(actions);
    const parsedTrigger = ruleTriggerSchema.safeParse(trigger);
    const next: Errors = {};

    if (!name.trim()) next.name = "Informe o nome.";

    if (!parsedTrigger.success) next.trigger = "Escolha o gatilho.";

    if (trigger === "schedule.cron" && !cronSchedule.trim()) {
      next.cronSchedule = "Informe a agenda, por exemplo 0 */4 * * *.";
    }

    if (!parsedConditions) next.conditions = "Use um objeto JSON válido.";

    if (!parsedActions) next.actions = "Use uma lista JSON de ações com tipos válidos.";

    setErrors(next);

    if (!parsedTrigger.success || !parsedConditions || !parsedActions) return;

    if (Object.keys(next).length > 0) return;

    setSubmitting(true);

    try {
      await onSubmit({
        name: name.trim(),
        trigger: parsedTrigger.data,
        conditions: parsedConditions,
        actions: parsedActions,
        enabled,
        cronSchedule: trigger === "schedule.cron" ? cronSchedule.trim() : null,
      });
      onClose();
    } catch {
      setErrors({ submit: "Não foi possível salvar a automação." });
    } finally {
      setSubmitting(false);
    }
  }

  function fieldError(key: keyof Errors) {
    const message = errors[key];

    return message ? (
      <p id={`${id}-${key}-error`} className="text-sm text-destructive" role="alert">
        {message}
      </p>
    ) : null;
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold sm:text-2xl">
            {rule ? "Editar automação" : "Nova automação"}
          </DialogTitle>
          <DialogDescription>
            Defina o gatilho, as condições e as ações executadas quando ele ocorrer.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="grid gap-5">
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-name`}>Nome</Label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? `${id}-name-error` : undefined}
                className="min-h-11"
              />
              {fieldError("name")}
            </div>
            <div className="grid content-start gap-2">
              <span className="text-sm font-medium">Gatilho</span>
              <PortalFilter
                label="Gatilho"
                className="w-full"
                value={trigger}
                items={[{ value: "", label: "Escolha o gatilho" }, ...triggerItems]}
                onChange={setTrigger}
                invalid={Boolean(errors.trigger)}
                describedBy={errors.trigger ? `${id}-trigger-error` : undefined}
              />
              {fieldError("trigger")}
            </div>
            {trigger === "schedule.cron" && (
              <div className="grid content-start gap-2">
                <Label htmlFor={`${id}-cron`}>Agenda (cron)</Label>
                <Input
                  id={`${id}-cron`}
                  value={cronSchedule}
                  placeholder="0 */4 * * *"
                  onChange={(event) => setCronSchedule(event.currentTarget.value)}
                  aria-invalid={Boolean(errors.cronSchedule)}
                  aria-describedby={errors.cronSchedule ? `${id}-cronSchedule-error` : undefined}
                  className="min-h-11 font-mono"
                />
                {fieldError("cronSchedule")}
              </div>
            )}
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-conditions`}>Condições (JSON)</Label>
              <textarea
                id={`${id}-conditions`}
                value={conditions}
                spellCheck={false}
                onChange={(event) => setConditions(event.currentTarget.value)}
                aria-invalid={Boolean(errors.conditions)}
                aria-describedby={errors.conditions ? `${id}-conditions-error` : undefined}
                className={textareaClass}
              />
              {fieldError("conditions")}
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor={`${id}-actions`}>Ações (JSON)</Label>
              <textarea
                id={`${id}-actions`}
                value={actions}
                spellCheck={false}
                onChange={(event) => setActions(event.currentTarget.value)}
                aria-invalid={Boolean(errors.actions)}
                aria-describedby={errors.actions ? `${id}-actions-error` : undefined}
                className={`${textareaClass} min-h-40`}
              />
              {fieldError("actions")}
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id={`${id}-enabled`}
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Automação ativa"
              />
              <Label htmlFor={`${id}-enabled`}>Automação ativa</Label>
            </div>
          </DialogBody>
          {errors.submit && (
            <p role="alert" className="px-5 py-2 text-sm text-destructive">
              {errors.submit}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="min-h-11" />}>
              <HugeiconsIcon icon={Cancel01Icon} data-icon="inline-start" aria-hidden="true" />
              Cancelar
            </DialogClose>
            <Button type="submit" className="min-h-11" disabled={submitting}>
              <HugeiconsIcon icon={Tick02Icon} data-icon="inline-start" aria-hidden="true" />
              {submitting ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
