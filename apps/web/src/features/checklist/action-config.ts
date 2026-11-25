import { queryOptions } from "@tanstack/react-query";
import type { ApiClient, Treaty } from "@offboard/api-client";
import type { ChecklistStep } from "./checklist-draft";
import { stepFormSchema, type StepSettings } from "./step-settings";
import { getApiClient } from "@/shared/lib/api-client";

const kinds = ["email", "slack", "webhook"] as const;

export type ActionConfigRow = Treaty.Data<ApiClient["api"]["action-configs"]["get"]>[number];

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

export function checklistActionConfigsQuery(orgId: string) {
  return queryOptions({
    ...actionConfigsQuery,
    queryKey: [...actionConfigsQuery.queryKey, orgId],
  });
}

export function knownActionRowIds(steps: ChecklistStep[], rows: ActionConfigRow[]) {
  const ids = new Set(steps.flatMap((step) => kinds.map((kind) => `${kind}:${step.id}`)));

  return rows.flatMap(({ id, actionId }) => (ids.has(actionId) ? [id] : []));
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
