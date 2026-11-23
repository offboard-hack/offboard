import { createLocalId } from "@/shared/lib/create-local-id";
import { pointerIntersection } from "@dnd-kit/collision";
import { Accessibility, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from "@dnd-kit/react";
import {
  Add01Icon,
  Calendar03Icon,
  DragDropVerticalIcon,
  FilterHorizontalIcon,
  Tick02Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useHydrated } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import {
  actionConfigsQuery,
  applyActionConfigs,
  syncActionConfigs,
  type ActionConfigRow,
} from "./action-config";
import { cn } from "@/shared/lib/utils";
import { ListBreadcrumb, ListPage } from "@/shared/ui/list-page";
import { Badge } from "@/shared/ui/shadcn/badge";
import { Button } from "@/shared/ui/shadcn/button";
import {
  clearDraftSteps,
  getPhase,
  initialSteps,
  moveStep,
  phases,
  readDraftSteps,
  readSavedModel,
  saveDraftSteps,
  saveModel,
  teams,
  type ChecklistStep,
  type Destination,
  type Placement,
} from "./checklist-draft";
import { DeleteStepDialog, StepDialog } from "./step-dialog";
import { sameStepSettings, type StepSettings } from "./step-settings";

const cardStyles = "min-w-0 rounded-xl border text-sm";

const ruleFieldLabel = { department: "Área", role: "Cargo" };
const ruleOperatorLabel = { equals: "=", notEquals: "≠" };

function formatRuleSummary(rule: {
  field: "department" | "role";
  operator: "equals" | "notEquals";
  value: string;
}) {
  return `${ruleFieldLabel[rule.field]} ${ruleOperatorLabel[rule.operator]} ${rule.value}`;
}

function formatOffset(offset: number) {
  if (offset === 0) return "D";

  return offset > 0 ? `D+${offset}` : `D${offset}`;
}

const teamCardColors = {
  "RH e DP":
    "border-violet-200 bg-violet-50 hover:bg-violet-100/75 dark:border-violet-800/65 dark:bg-violet-950/50 dark:hover:bg-violet-950/75",
  TI: "border-blue-200 bg-blue-50 hover:bg-blue-100/75 dark:border-blue-800/65 dark:bg-blue-950/50 dark:hover:bg-blue-950/75",
  Gestão:
    "border-orange-200 bg-orange-50 hover:bg-orange-100/75 dark:border-orange-800/65 dark:bg-orange-950/50 dark:hover:bg-orange-950/75",
  Financeiro:
    "border-emerald-200 bg-emerald-50 hover:bg-emerald-100/75 dark:border-emerald-800/65 dark:bg-emerald-950/50 dark:hover:bg-emerald-950/75",
  Jurídico:
    "border-rose-200 bg-rose-50 hover:bg-rose-100/75 dark:border-rose-800/65 dark:bg-rose-950/50 dark:hover:bg-rose-950/75",
  Facilities:
    "border-amber-200 bg-amber-50 hover:bg-amber-100/75 dark:border-amber-800/65 dark:bg-amber-950/50 dark:hover:bg-amber-950/75",
  "Pessoa desligada":
    "border-fuchsia-200 bg-fuchsia-50 hover:bg-fuchsia-100/75 dark:border-fuchsia-800/65 dark:bg-fuchsia-950/50 dark:hover:bg-fuchsia-950/75",
} satisfies Record<Placement["team"], string>;

const checklistPointerSensor = PointerSensor.configure({
  preventActivation: () => false,
  activationConstraints: (event) =>
    event.pointerType === "touch"
      ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
      : [new PointerActivationConstraints.Distance({ value: 6 })],
});

const cellId = (team: Placement["team"], phase: Placement["phase"]) => `cell:${team}:${phase}`;

const addStepId = ({ team, phase }: Placement) => `add:${team}:${phase}`;

const cellDestinations = new Map(
  teams.flatMap((team) =>
    phases.map(({ id: phase }) => [cellId(team, phase), { team, phase, beforeId: "" }]),
  ),
);

type ChecklistDialog =
  | { kind: "create"; placement: Placement }
  | { kind: "edit" | "delete"; step: ChecklistStep };

type KeyboardDrag = { stepId: string; destination: Destination };

function StepCard({
  step,
  onEdit,
  onDragKey,
  onDragBlur,
  keyboardSource,
  keyboardTarget,
}: {
  step: ChecklistStep;
  onEdit: () => void;
  onDragKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDragBlur: () => void;
  keyboardSource: boolean;
  keyboardTarget: boolean;
}) {
  const { ref, handleRef, isDragSource } = useDraggable({ id: step.id });

  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `before:${step.id}`,
    collisionDetector: pointerIntersection,
  });

  return (
    <li ref={dropRef} className="relative">
      {((isDropTarget && !isDragSource) || keyboardTarget) && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-1 h-0.5 rounded-full bg-primary"
        />
      )}
      <Button
        ref={ref}
        id={`edit-${step.id}`}
        aria-label={`Editar etapa: ${step.title}`}
        aria-describedby="checklist-keyboard-help"
        variant="ghost"
        className={cn(
          cardStyles,
          teamCardColors[step.team],
          "relative flex h-auto min-h-10 w-full justify-start py-2 pr-3 pl-10 text-left leading-snug wrap-anywhere whitespace-normal pointer-coarse:min-h-12 pointer-coarse:pl-14",
          isDragSource && "opacity-40",
          keyboardSource && "ring-2 ring-primary ring-offset-1",
        )}
        onClick={onEdit}
        onKeyDown={onDragKey}
        onBlur={onDragBlur}
      >
        <span
          ref={handleRef}
          onClick={(event) => event.stopPropagation()}
          aria-hidden="true"
          className="absolute inset-y-0 left-0 grid w-10 touch-none cursor-grab place-items-center text-muted-foreground active:cursor-grabbing pointer-coarse:w-12"
        >
          <HugeiconsIcon icon={DragDropVerticalIcon} />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1">{step.title}</span>
            {step.deadlineOffset != null && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                <HugeiconsIcon icon={Calendar03Icon} className="size-3" aria-hidden="true" />
                {formatOffset(step.deadlineOffset)}
              </span>
            )}
          </span>
          {step.rules && step.rules.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <HugeiconsIcon
                icon={FilterHorizontalIcon}
                className="size-3 shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">
                {step.rules.map((rule) => formatRuleSummary(rule)).join(" · ")}
              </span>
            </span>
          )}
        </span>
      </Button>
    </li>
  );
}

function ChecklistCell({
  team,
  phase,
  steps,
  onEdit,
  onCreate,
  phaseLabel,
  keyboardDrag,
  onDragKey,
  onDragBlur,
}: Placement & {
  steps: ChecklistStep[];
  onEdit: (step: ChecklistStep) => void;
  onCreate: () => void;
  phaseLabel: string;
  keyboardDrag: KeyboardDrag | null;
  onDragKey: (event: KeyboardEvent<HTMLButtonElement>, step: ChecklistStep) => void;
  onDragBlur: () => void;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: cellId(team, phase),
    collisionDetector: pointerIntersection,
    collisionPriority: 0,
  });

  const keyboardDestination = keyboardDrag?.destination;
  const keyboardTarget = keyboardDestination?.team === team && keyboardDestination.phase === phase;

  return (
    <td
      id={cellId(team, phase)}
      ref={ref}
      data-checklist-cell={cellId(team, phase)}
      className={cn(
        "relative border-l px-2 pt-2 pb-3 align-top",
        (isDropTarget || keyboardTarget) && "bg-primary/10 ring-1 ring-primary/50 ring-inset",
      )}
    >
      {steps.length > 0 && (
        <ul className="grid gap-2">
          {steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              onEdit={() => onEdit(step)}
              onDragKey={(event) => onDragKey(event, step)}
              onDragBlur={onDragBlur}
              keyboardSource={keyboardDrag?.stepId === step.id}
              keyboardTarget={keyboardTarget && keyboardDestination?.beforeId === step.id}
            />
          ))}
        </ul>
      )}
      <Button
        id={addStepId({ team, phase })}
        aria-label={`Nova etapa: ${team}, ${phaseLabel}`}
        variant="ghost"
        size="sm"
        className={cn(
          "text-muted-foreground hover:bg-primary/8 hover:text-primary pointer-coarse:min-h-11 dark:hover:bg-primary/20 dark:hover:text-primary-foreground",
          steps.length > 0 && "mt-1",
        )}
        onClick={onCreate}
      >
        <HugeiconsIcon icon={Add01Icon} aria-hidden="true" />
        Nova etapa
      </Button>
      {(isDropTarget || (keyboardTarget && !keyboardDestination?.beforeId)) && steps.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-primary"
        />
      )}
    </td>
  );
}

type Draft = {
  steps: ChecklistStep[];
  history: { steps: ChecklistStep[]; undoMessage: string }[];
  message: string;
};

function keyboardDropTarget(
  key: string,
  destination: Destination,
  stepId: string,
  steps: ChecklistStep[],
) {
  const { team, phase, beforeId } = destination;
  const teamIndex = teams.indexOf(team);
  const phaseIndex = phases.findIndex(({ id }) => id === phase);

  switch (key) {
    case "ArrowUp":
    case "ArrowDown": {
      const nextTeam = teams[teamIndex + (key === "ArrowUp" ? -1 : 1)];

      return nextTeam ? { team: nextTeam, phase, beforeId: "" } : destination;
    }

    case "ArrowLeft":
    case "ArrowRight": {
      const nextPhase = phases[phaseIndex + (key === "ArrowLeft" ? -1 : 1)];

      return nextPhase ? { team, phase: nextPhase.id, beforeId: "" } : destination;
    }

    case "PageUp":
    case "PageDown": {
      const lane = steps.filter(
        (step) => step.id !== stepId && step.team === team && step.phase === phase,
      );

      const index = beforeId ? lane.findIndex(({ id }) => id === beforeId) : lane.length;
      const next = Math.max(0, index + (key === "PageUp" ? -1 : 1));

      return { team, phase, beforeId: lane[next]?.id ?? "" };
    }

    default:
      return undefined;
  }
}

function completeStepSettings(step: ChecklistStep) {
  return {
    title: step.title,
    deadlineOffset: step.deadlineOffset ?? null,
    rules: step.rules ?? [],
    email: step.email ?? null,
    slack: step.slack ?? null,
    webhook: step.webhook ?? null,
  };
}

export function ChecklistRulesPage() {
  const hydrated = useHydrated();

  const actionConfigs = useQuery({ ...actionConfigsQuery, enabled: hydrated });

  return (
    <ChecklistEditor
      key={`${hydrated ? "browser" : "server"}:${actionConfigs.data ? "actions" : "local"}`}
      restored={hydrated}
      actionRows={actionConfigs.data ?? []}
    />
  );
}

function ChecklistEditor({
  restored,
  actionRows,
}: {
  restored: boolean;
  actionRows: ActionConfigRow[];
}) {
  const client = useQueryClient();

  const [saved, setSaved] = useState(() => {
    const model = restored ? readSavedModel() : undefined;

    return restored ? applyActionConfigs(model ?? initialSteps, actionRows) : model;
  });

  const [{ steps, history, message }, setDraft] = useState<Draft>(() => ({
    steps: restored
      ? applyActionConfigs(readDraftSteps(saved ?? initialSteps), actionRows)
      : initialSteps,
    history: [],
    message: "",
  }));

  const [dialog, setDialog] = useState<ChecklistDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keyboardDrag, setKeyboardDrag] = useState<KeyboardDrag | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [syncError, setSyncError] = useState(false);

  const baseline = saved ?? initialSteps;

  const isSaved =
    baseline.length === steps.length &&
    steps.every((step, index) => {
      const original = baseline[index];

      return (
        original?.id === step.id &&
        sameStepSettings(completeStepSettings(original), completeStepSettings(step)) &&
        original.team === step.team &&
        original.phase === step.phase
      );
    });

  const dialogControls = {
    open: dialogOpen,
    onClose: () => setDialogOpen(false),
    onClosed: () => setDialog(null),
  };

  function openDialog(next: ChecklistDialog) {
    setDialog(next);
    setDialogOpen(true);
  }

  function commit(next: ChecklistStep[], message: string, undoMessage: string) {
    saveDraftSteps(next);
    setDraft({ steps: next, history: [...history, { steps, undoMessage }], message });
  }

  function commitMove(id: string, destination: Destination) {
    const next = moveStep(steps, id, destination);
    const movedStep = next.find((step) => step.id === id);

    if (next === steps || !movedStep) return;

    const phase = getPhase(destination.phase);
    commit(
      next,
      `“${movedStep.title}” movida para ${destination.team} · ${phase.label}.`,
      `Movimento de “${movedStep.title}” desfeito.`,
    );
  }

  function cancelKeyboardDrag() {
    if (!keyboardDrag) return;

    setKeyboardDrag(null);
    setDraft({ steps, history, message: "Movimentação cancelada." });
  }

  function dragWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, step: ChecklistStep) {
    const { key } = event;

    if (!keyboardDrag) {
      if (key !== " ") return;

      event.preventDefault();

      if (event.repeat) return;

      const lane = steps.filter((item) => item.team === step.team && item.phase === step.phase);
      const beforeId = lane[lane.indexOf(step) + 1]?.id ?? "";

      setKeyboardDrag({
        stepId: step.id,
        destination: { team: step.team, phase: step.phase, beforeId },
      });

      return;
    }

    if (keyboardDrag.stepId !== step.id) return;

    const { destination } = keyboardDrag;

    if (key === "Escape") {
      event.preventDefault();
      cancelKeyboardDrag();

      return;
    }

    if (key === " " || key === "Enter") {
      event.preventDefault();

      if (event.repeat) return;

      setKeyboardDrag(null);
      commitMove(step.id, destination);
      requestAnimationFrame(() => document.getElementById(`edit-${step.id}`)?.focus());

      return;
    }

    const next = keyboardDropTarget(key, destination, step.id, steps);

    if (!next) return;

    event.preventDefault();
    setKeyboardDrag({ stepId: step.id, destination: next });
    document
      .getElementById(cellId(next.team, next.phase))
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function createStep(settings: StepSettings, placement: Placement) {
    const step = {
      ...placement,
      id: createLocalId(),
      ...settings,
    };

    commit(
      [...steps, step],
      `“${settings.title}” adicionada ao rascunho.`,
      `Criação de “${settings.title}” desfeita.`,
    );
    setDialogOpen(false);
  }

  function editStep(settings: StepSettings, step: ChecklistStep) {
    if (!sameStepSettings(completeStepSettings(step), settings)) {
      const next = steps.map((item) => (item.id === step.id ? { ...item, ...settings } : item));

      commit(next, `“${settings.title}” atualizada.`, `Alterações em “${step.title}” desfeitas.`);
    }

    setDialogOpen(false);
  }

  async function commitModel() {
    if (!saveModel(steps)) {
      setSaveError(true);

      return;
    }

    try {
      const existing = await client.fetchQuery({ ...actionConfigsQuery, staleTime: 0 });

      await syncActionConfigs(steps, existing);
      await client.invalidateQueries(actionConfigsQuery);
      setSyncError(false);
    } catch {
      setSyncError(true);
    }

    clearDraftSteps();
    setSaved(steps);
    setSaveError(false);
    setDraft({ steps, history, message: "Modelo salvo neste navegador." });
  }

  function deleteStep(step: ChecklistStep) {
    commit(
      steps.filter(({ id }) => id !== step.id),
      `“${step.title}” excluída do rascunho.`,
      `“${step.title}” restaurada.`,
    );
    setDialogOpen(false);
  }

  function undoChange() {
    const previous = history.at(-1);

    if (!previous) return;

    saveDraftSteps(previous.steps);
    setDraft({
      steps: previous.steps,
      history: history.slice(0, -1),
      message: previous.undoMessage,
    });
  }

  return (
    <ListPage
      title="Checklist automático"
      breadcrumb={<ListBreadcrumb title="Checklist automático" />}
    >
      <section
        aria-labelledby="checklist-template-title"
        className="min-w-0 rounded-2xl border bg-card"
      >
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="checklist-template-title" className="text-base font-semibold">
                Modelo padrão
              </h2>
              <Badge
                variant="secondary"
                className={cn(
                  !isSaved &&
                    "bg-primary/10 text-primary dark:bg-primary/25 dark:text-primary-foreground",
                )}
              >
                {isSaved ? "Salvo" : "Rascunho"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Clique na etapa para editar ou use a alça para mover entre equipes e fases.
              <span className="block lg:hidden">Deslize a matriz para ver as outras fases.</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={undoChange} disabled={history.length === 0}>
              <HugeiconsIcon icon={Undo02Icon} aria-hidden="true" />
              Desfazer
            </Button>
            <Button onClick={commitModel} disabled={isSaved}>
              <HugeiconsIcon icon={Tick02Icon} aria-hidden="true" />
              Salvar modelo
            </Button>
          </div>
          {syncError && (
            <p role="alert" className="basis-full text-sm text-destructive">
              Não foi possível salvar as ações no servidor. Tente novamente.
            </p>
          )}
          {saveError && (
            <p role="alert" className="basis-full text-sm text-destructive">
              O navegador não conseguiu salvar o modelo. Tente novamente.
            </p>
          )}
        </header>
        <DragDropProvider
          sensors={[checklistPointerSensor]}
          onDragStart={cancelKeyboardDrag}
          plugins={(defaults) => defaults.filter((plugin) => plugin !== Accessibility)}
          onDragEnd={({ canceled, operation }) => {
            const { source, target } = operation;

            if (canceled || !source || !target) return;

            const targetStep = steps.find((step) => `before:${step.id}` === target.id);

            const destination = targetStep
              ? { team: targetStep.team, phase: targetStep.phase, beforeId: targetStep.id }
              : cellDestinations.get(String(target.id));

            if (destination) commitMove(String(source.id), destination);
          }}
        >
          <div
            role="region"
            aria-label="Matriz de etapas por equipe e fase"
            tabIndex={0}
            className="min-w-0 overflow-x-auto overscroll-x-contain rounded-b-2xl border-t outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <table className="w-full min-w-[67rem] table-fixed border-separate border-spacing-0 text-left">
              <thead className="bg-primary/8 dark:bg-primary/18">
                <tr>
                  <th
                    scope="col"
                    className="w-24 bg-muted/65 px-3 py-3 text-sm font-semibold sm:w-36 sm:px-4"
                  >
                    Equipe
                  </th>
                  {phases.map(({ id, label }) => (
                    <th
                      key={id}
                      scope="col"
                      className="border-l border-primary/12 px-3 py-3 text-sm font-semibold"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr+tr>td]:border-t [&_tr+tr>th]:border-t">
                {teams.map((team) => (
                  <tr key={team}>
                    <th
                      scope="row"
                      className="bg-muted/30 px-3 py-4 align-top text-sm font-semibold sm:px-4"
                    >
                      {team}
                    </th>
                    {phases.map(({ id, label }) => (
                      <ChecklistCell
                        key={id}
                        team={team}
                        phase={id}
                        steps={steps.filter((step) => step.team === team && step.phase === id)}
                        onEdit={(step) => openDialog({ kind: "edit", step })}
                        onCreate={() =>
                          openDialog({ kind: "create", placement: { team, phase: id } })
                        }
                        phaseLabel={label}
                        keyboardDrag={keyboardDrag}
                        onDragKey={dragWithKeyboard}
                        onDragBlur={cancelKeyboardDrag}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DragOverlay dropAnimation={null} className="pointer-events-none">
            {(source) => {
              const step = steps.find((item) => item.id === source.id);

              return (
                step && (
                  <div
                    aria-hidden="true"
                    className={cn(
                      cardStyles,
                      teamCardColors[step.team],
                      "px-3 py-2 font-medium shadow-md",
                    )}
                  >
                    {step.title}
                  </div>
                )
              );
            }}
          </DragOverlay>
        </DragDropProvider>
        <p id="checklist-keyboard-help" className="sr-only">
          Pressione Enter para editar ou Espaço para pegar a etapa. Use as setas para mudar de
          equipe ou fase, Page Up e Page Down para ajustar a posição, Espaço para soltar e Escape
          para cancelar.
        </p>
        <p role="status" className="sr-only">
          {keyboardDrag
            ? `${keyboardDrag.destination.team} · ${getPhase(keyboardDrag.destination.phase).label}. ${keyboardDrag.destination.beforeId ? `Antes de ${steps.find(({ id }) => id === keyboardDrag.destination.beforeId)?.title}.` : "Fim da célula."}`
            : message}
        </p>
      </section>
      {dialog?.kind === "create" && (
        <StepDialog
          {...dialogControls}
          placement={dialog.placement}
          focusId={addStepId(dialog.placement)}
          onSave={(settings) => createStep(settings, dialog.placement)}
        />
      )}
      {dialog?.kind === "edit" && (
        <StepDialog
          key={dialog.step.id}
          {...dialogControls}
          step={dialog.step}
          placement={dialog.step}
          focusId={`edit-${dialog.step.id}`}
          onSave={(settings) => editStep(settings, dialog.step)}
          onRequestDelete={() => openDialog({ kind: "delete", step: dialog.step })}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteStepDialog
          key={dialog.step.id}
          {...dialogControls}
          step={dialog.step}
          focusId={addStepId(dialog.step)}
          onDelete={() => deleteStep(dialog.step)}
        />
      )}
    </ListPage>
  );
}
