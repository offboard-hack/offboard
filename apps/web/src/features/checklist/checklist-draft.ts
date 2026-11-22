import { z } from "zod";
import { matchesStepRules, stepFormSchema } from "./step-settings";
import { offboardingTeams } from "@/entities/offboarding";
import type { CaseSummary, Task } from "@/entities/offboarding";

export const teams = offboardingTeams;

const phaseIds = ["pre", "d0", "first-week", "second-week", "follow-up"] as const;

export const phases = [
  { id: "pre", label: "Pré-desligamento" },
  { id: "d0", label: "Dia do desligamento" },
  { id: "first-week", label: "Primeira semana" },
  { id: "second-week", label: "Segunda semana" },
  { id: "follow-up", label: "Terceira e quarta semanas" },
] satisfies { id: (typeof phaseIds)[number]; label: string }[];

export function getPhase(id: (typeof phaseIds)[number]) {
  return phases.find((phase) => phase.id === id) ?? phases[0];
}

const placementSchema = z.object({
  team: z.enum(teams),
  phase: z.enum(phaseIds),
});

const storedStepSchema = placementSchema.extend({
  ...stepFormSchema.shape,
  deadlineOffset: stepFormSchema.shape.deadlineOffset.optional(),
  rules: stepFormSchema.shape.rules.optional(),
  email: stepFormSchema.shape.email.optional(),
  id: z.string().min(1),
});

export type Destination = Placement & { beforeId: string };

export type Placement = z.infer<typeof placementSchema>;

export type ChecklistStep = z.infer<typeof storedStepSchema>;

export const initialSteps: ChecklistStep[] = [
  { id: "point", title: "Fechar ponto e banco de horas", team: "RH e DP", phase: "d0" },
  {
    id: "invite",
    title: "Enviar convite do app Offboard",
    team: "RH e DP",
    phase: "d0",
  },
  {
    id: "exam",
    title: "Agendar exame demissional",
    team: "RH e DP",
    phase: "first-week",
  },
  {
    id: "documents",
    title: "Conferir a entrega dos documentos",
    team: "RH e DP",
    phase: "second-week",
  },
  {
    id: "review",
    title: "Revisar pendências do desligamento",
    team: "RH e DP",
    phase: "follow-up",
  },
  { id: "access", title: "Bloquear acessos", team: "TI", phase: "d0" },
  {
    id: "files",
    title: "Transferir arquivos e e-mail",
    team: "TI",
    phase: "first-week",
  },
  {
    id: "collect",
    title: "Agendar a coleta de equipamentos",
    team: "TI",
    phase: "first-week",
  },
  {
    id: "inventory",
    title: "Conferir os bens devolvidos",
    team: "TI",
    phase: "second-week",
  },
  {
    id: "handoff",
    title: "Confirmar a passagem de trabalho",
    team: "Gestão",
    phase: "first-week",
  },
  {
    id: "crm",
    title: "Transferir negócios e contatos no CRM",
    team: "Gestão",
    phase: "first-week",
  },
  {
    id: "card",
    title: "Conciliar despesas e cancelar o cartão",
    team: "Financeiro",
    phase: "first-week",
  },
  {
    id: "refunds",
    title: "Revisar reembolsos pendentes",
    team: "Financeiro",
    phase: "second-week",
  },
  {
    id: "certificates",
    title: "Revisar procurações e certificados",
    team: "Jurídico",
    phase: "first-week",
  },
  { id: "badge", title: "Desativar crachá e acesso", team: "Facilities", phase: "d0" },
  {
    id: "confirm",
    title: "Confirmar os itens para devolução",
    team: "Pessoa desligada",
    phase: "first-week",
  },
  {
    id: "survey",
    title: "Responder à pesquisa de desligamento",
    team: "Pessoa desligada",
    phase: "follow-up",
  },
];

const modelStorageKey = "offboard:checklist-model:v1";

const storageKey = "offboard:checklist-draft:v2";
const legacyStorageKey = "offboard:checklist-draft:v1";
const placementsSchema = z.array(placementSchema.extend({ id: z.string() }));

const draftSchema = z
  .array(storedStepSchema)
  .refine((steps) => new Set(steps.map(({ id }) => id)).size === steps.length);

export function readSavedModel() {
  try {
    const raw = window.localStorage.getItem(modelStorageKey);

    return raw ? draftSchema.safeParse(JSON.parse(raw)).data : undefined;
  } catch {
    return undefined;
  }
}

export function createTasksFromChecklist(person: Pick<CaseSummary, "role" | "department">) {
  const model = readSavedModel() ?? initialSteps;

  return phases.flatMap(({ id: phase }) =>
    model.flatMap((step) =>
      step.phase === phase && matchesStepRules(step.rules ?? [], person)
        ? [
            {
              id: step.id,
              title: step.title,
              team: step.team,
              status: "todo",
              description: null,
              dueDate: null,
              subtasks: [],
            } satisfies Task,
          ]
        : [],
    ),
  );
}

export function saveModel(steps: ChecklistStep[]) {
  try {
    window.localStorage.setItem(modelStorageKey, JSON.stringify(steps));

    return true;
  } catch {
    return false;
  }
}

export function readDraftSteps(fallback: ChecklistStep[]) {
  try {
    const raw = window.sessionStorage.getItem(storageKey);

    if (raw) {
      const draft = draftSchema.safeParse(JSON.parse(raw));

      return draft.success ? draft.data : fallback;
    }

    const legacyRaw = window.sessionStorage.getItem(legacyStorageKey);

    if (!legacyRaw) return fallback;

    const result = placementsSchema.safeParse(JSON.parse(legacyRaw));

    if (!result.success || new Set(result.data.map(({ id }) => id)).size !== result.data.length) {
      return fallback;
    }

    const steps = result.data.flatMap(({ id, team, phase }) => {
      const initial = initialSteps.find((step) => step.id === id);

      return initial ? [{ ...initial, team, phase }] : [];
    });

    return steps.length === initialSteps.length ? steps : fallback;
  } catch {
    return fallback;
  }
}

export function saveDraftSteps(steps: ChecklistStep[]) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(steps));
  } catch {
    return;
  }
}

export function clearDraftSteps() {
  try {
    window.sessionStorage.removeItem(legacyStorageKey);
    window.sessionStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

export function moveStep(steps: ChecklistStep[], id: string, destination: Destination) {
  const step = steps.find((item) => item.id === id);

  if (!step || id === destination.beforeId) return steps;

  const { team, phase, beforeId } = destination;
  const remaining = steps.filter((item) => item.id !== id);
  const belongsToDestination = (item: ChecklistStep) => item.team === team && item.phase === phase;
  const destinationSteps = remaining.filter(belongsToDestination);
  const before = destinationSteps.find((item) => item.id === beforeId);
  const last = destinationSteps.at(-1);

  const index = before
    ? remaining.indexOf(before)
    : last
      ? remaining.indexOf(last) + 1
      : remaining.length;

  const next = [...remaining.slice(0, index), { ...step, team, phase }, ...remaining.slice(index)];

  if (step.team === team && step.phase === phase) {
    const originalOrder = steps.filter(belongsToDestination);
    const nextOrder = next.filter(belongsToDestination);

    if (originalOrder.every((item, position) => item.id === nextOrder[position]?.id)) return steps;
  }

  return next;
}
