import { z } from "zod";
import { stepFormSchema } from "./step-settings";
import { offboardingTeams } from "@/entities/offboarding";

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
  slack: stepFormSchema.shape.slack.optional(),
  webhook: stepFormSchema.shape.webhook.optional(),
  id: z.string().min(1),
});

export type Destination = Placement & { beforeId: string };

export type Placement = z.infer<typeof placementSchema>;

export type ChecklistStep = z.infer<typeof storedStepSchema>;

const storageKey = (orgId: string) => `offboard:checklist-draft:v4:${orgId}`;

const draftSchema = z
  .array(storedStepSchema)
  .refine((steps) => new Set(steps.map(({ id }) => id)).size === steps.length);

const draftSnapshotSchema = z.object({
  steps: draftSchema,
  knownRowIds: z.array(z.uuid()),
  revision: z.int().min(0).default(0),
});

type DraftSnapshot = z.infer<typeof draftSnapshotSchema>;

export function readDraftSnapshot(orgId: string) {
  try {
    const raw = window.sessionStorage.getItem(storageKey(orgId));

    return raw ? draftSnapshotSchema.safeParse(JSON.parse(raw)).data : undefined;
  } catch {
    return undefined;
  }
}

export function saveDraftSnapshot(orgId: string, snapshot: DraftSnapshot) {
  try {
    window.sessionStorage.setItem(storageKey(orgId), JSON.stringify(snapshot));

    return true;
  } catch {
    return false;
  }
}

export function clearDraftSteps(orgId: string) {
  try {
    window.sessionStorage.removeItem(storageKey(orgId));
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
