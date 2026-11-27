import { useId, useState } from "react";
import {
  useCreateAutomationRule,
  useUpdateAutomationRule,
  type AutomationRuleRow,
} from "@/entities/automation-rule";
import { PortalFilter } from "@/shared/ui/select";
import { Button } from "@/shared/ui/shadcn/button";
import { Checkbox } from "@/shared/ui/shadcn/checkbox";
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
import { defaultActionsJson, parseActions, parseConditions, triggerItems } from "./rule-form";

export function RuleDialog({
  rule,
  onClose,
}: {
  rule: AutomationRuleRow | "new";
  onClose: () => void;
}) {
  const id = useId();
  const existing = rule === "new" ? undefined : rule;
  const [name, setName] = useState(existing?.name ?? "");

  const [trigger, setTrigger] = useState<AutomationRuleRow["trigger"]>(
    existing?.trigger ?? "task.status_changed",
  );

  const [conditions, setConditions] = useState(JSON.stringify(existing?.conditions ?? {}, null, 2));

  const [actions, setActions] = useState(
    existing ? JSON.stringify(existing.actions, null, 2) : defaultActionsJson,
  );

  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const [cronSchedule, setCronSchedule] = useState(existing?.cronSchedule ?? "");

  const [invalid, setInvalid] = useState<string | null>(null);

  const create = useCreateAutomationRule();
  const update = useUpdateAutomationRule();
  const mutation = existing ? update : create;

  function submit() {
    const parsedConditions = parseConditions(conditions);
    const parsedActions = parseActions(actions);

    if (!name.trim()) return setInvalid("Informe um nome.");

    if (!parsedConditions) return setInvalid("Condições devem ser um JSON com valores de texto.");

    if (!parsedActions) return setInvalid("Ações devem ser uma lista JSON com tipos válidos.");

    setInvalid(null);

    const draft = {
      name: name.trim(),
      trigger,
      conditions: parsedConditions,
      actions: parsedActions,
      enabled,
      cronSchedule: trigger === "schedule.cron" ? cronSchedule.trim() || null : null,
    };

    if (existing) update.mutate({ id: existing.id, ...draft }, { onSuccess: onClose });
    else create.mutate(draft, { onSuccess: onClose });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Editar automação" : "Nova automação"}</DialogTitle>
          <DialogDescription>
            Quando o gatilho ocorre e as condições batem, as ações são executadas.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogBody className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>Nome</Label>
              <Input
                id={`${id}-name`}
                className="min-h-11"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-trigger`}>Gatilho</Label>
              <PortalFilter
                id={`${id}-trigger`}
                label="Gatilho"
                className="w-full"
                value={trigger}
                items={triggerItems}
                onChange={(next) => {
                  const item = triggerItems.find(({ value }) => value === next);

                  if (item) setTrigger(item.value);
                }}
              />
            </div>
            {trigger === "schedule.cron" && (
              <div className="grid gap-2">
                <Label htmlFor={`${id}-cron`}>Agendamento (cron)</Label>
                <Input
                  id={`${id}-cron`}
                  className="min-h-11 font-mono"
                  placeholder="0 9 * * 1-5"
                  value={cronSchedule}
                  onChange={(event) => setCronSchedule(event.currentTarget.value)}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor={`${id}-conditions`}>Condições (JSON)</Label>
              <Textarea
                id={`${id}-conditions`}
                className="font-mono"
                spellCheck={false}
                value={conditions}
                onChange={(event) => setConditions(event.currentTarget.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-actions`}>Ações (JSON)</Label>
              <Textarea
                id={`${id}-actions`}
                className="min-h-40 font-mono"
                spellCheck={false}
                value={actions}
                onChange={(event) => setActions(event.currentTarget.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-enabled`}
                checked={enabled}
                onCheckedChange={(next) => setEnabled(next)}
              />
              <Label htmlFor={`${id}-enabled`}>Ativa</Label>
            </div>
            {(invalid || mutation.isError) && (
              <p role="alert" className="text-sm text-destructive">
                {invalid ?? "Não foi possível salvar a automação. Tente novamente."}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11" disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
