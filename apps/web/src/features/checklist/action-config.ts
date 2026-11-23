import { queryOptions } from "@tanstack/react-query";
import type { ApiClient, Treaty } from "@offboard/api-client";
import type { ChecklistStep } from "./checklist-draft";
import { stepFormSchema, type StepSettings } from "./step-settings";
import { getApiClient } from "@/shared/lib/api-client";

const kinds = ["email", "slack", "webhook"] as const;

export type ActionConfigRow = Treaty.Data<ApiClient["api"]["action-configs"]["get"]>[number];

type NewActionConfig = Parameters<ApiClient["api"]["action-configs"]["post"]>[0];

async function listActionConfigs({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["action-configs"].get({ fetch: { signal } });

  if (error) throw new Error("Failed to fetch action configs");

  return data;
}

export const actionConfigsQuery = queryOptions({
  queryKey: ["action-configs"],
  queryFn: listActionConfigs,
  staleTime: 30_000,
});

async function checkWrite(request: Promise<{ error: object | null }>) {
  const { error } = await request;

  if (error) throw new Error("Failed to save action config");
}

function desiredConfigs(steps: ChecklistStep[]) {
  return new Map<string, Pick<NewActionConfig, "phase" | "config">>(
    steps.flatMap((step) =>
      kinds.flatMap((kind) => {
        const config = step[kind];

        return config
          ? [[`${kind}:${step.id}`, { phase: step.phase, config: { ...config } }] as const]
          : [];
      }),
    ),
  );
}

export function knownActionRowIds(steps: ChecklistStep[], rows: ActionConfigRow[]) {
  const actions = desiredConfigs(steps);

  return rows.flatMap(({ id, actionId }) => (actions.has(actionId) ? [id] : []));
}

export async function syncActionConfigs(
  steps: ChecklistStep[],
  existing: ActionConfigRow[],
  knownRowIds: readonly string[],
) {
  const api = getApiClient().api["action-configs"];
  const desired = desiredConfigs(steps);
  const current = new Map(existing.map((row) => [row.actionId, row]));

  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const knownRows = new Set(knownRowIds);

  const removals = existing.flatMap(({ id, actionId }) => {
    const kind = kinds.find((kind) => actionId.startsWith(`${kind}:`));

    if (!kind || !knownRows.has(id)) return [];

    const step = stepsById.get(actionId.slice(kind.length + 1));

    return !step || step[kind] === null
      ? [checkWrite(api({ id: encodeURIComponent(id) }).delete())]
      : [];
  });

  async function createConfig(body: NewActionConfig) {
    const { data, error } = await api.post(body);

    if (error) throw new Error("Failed to save action config");

    return data.id;
  }

  const writes = [...desired].flatMap<Promise<string | void>>(([actionId, { phase, config }]) => {
    const row = current.get(actionId);

    if (!row) return [createConfig({ actionId, phase, enabled: true, config })];

    const unchanged = row.phase === phase && JSON.stringify(row.config) === JSON.stringify(config);

    return unchanged
      ? []
      : [checkWrite(api({ id: encodeURIComponent(row.id) }).put({ phase, config }))];
  });

  const results = await Promise.allSettled([...removals, ...writes]);

  return {
    createdRowIds: results.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    ),
    failed: results.some(({ status }) => status === "rejected"),
  };
}

function editedAction<T>(previous: T | null | undefined, next: T | null) {
  return next === null && previous === undefined ? undefined : next;
}

export function mergeStepSettings(step: ChecklistStep, settings: StepSettings) {
  return {
    ...step,
    ...settings,
    email: editedAction(step.email, settings.email),
    slack: editedAction(step.slack, settings.slack),
    webhook: editedAction(step.webhook, settings.webhook),
  } satisfies ChecklistStep;
}

export function clearSyncedRemovals(steps: ChecklistStep[]) {
  return steps.map<ChecklistStep>((step) => ({
    ...step,
    email: step.email ?? undefined,
    slack: step.slack ?? undefined,
    webhook: step.webhook ?? undefined,
  }));
}

export function applyActionConfigs(steps: ChecklistStep[], rows: ActionConfigRow[]) {
  const byActionId = new Map(rows.map((row) => [row.actionId, row]));

  return steps.map<ChecklistStep>((step) => {
    const email =
      step.email === undefined
        ? stepFormSchema.shape.email.safeParse(byActionId.get(`email:${step.id}`)?.config).data
        : step.email;

    const slack =
      step.slack === undefined
        ? stepFormSchema.shape.slack.safeParse(byActionId.get(`slack:${step.id}`)?.config).data
        : step.slack;

    const webhook =
      step.webhook === undefined
        ? stepFormSchema.shape.webhook.safeParse(byActionId.get(`webhook:${step.id}`)?.config).data
        : step.webhook;

    return { ...step, email, slack, webhook };
  });
}
