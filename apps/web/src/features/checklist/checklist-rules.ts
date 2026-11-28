import { queryOptions } from "@tanstack/react-query";
import type { AutomationRuleRow } from "@/entities/automation-rule";
import type { ChecklistStep } from "./checklist-draft";
import { stepFormSchema, type StepSettings } from "./step-settings";
import { getApiClient } from "@/shared/lib/api-client";

const kinds = ["email", "slack", "webhook"] as const;

type RuleAction = AutomationRuleRow["actions"][number];

export type ChecklistRuleRow = {
  id: string;
  actionId: string;
  config: Omit<RuleAction, "type">;
};

function extractConfig(action: RuleAction) {
  return Object.fromEntries(
    Object.entries(action).filter(([key]) => key !== "type"),
  ) satisfies ChecklistRuleRow["config"];
}

async function listChecklistRules({ signal }: { signal: AbortSignal }) {
  const { data, error } = await getApiClient().api["automation-rules"].get({
    fetch: { signal },
  });

  if (error) throw new Error("Failed to fetch checklist rules");

  return (data ?? []).flatMap((rule) => {
    if (!rule.sourceRef) return [];

    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    const first = actions[0];
    const config = first ? extractConfig(first) : {};

    return [{ id: rule.id, actionId: rule.sourceRef, config }];
  });
}

export const checklistRulesQuery = queryOptions({
  queryKey: ["checklist-rules"],
  queryFn: listChecklistRules,
  staleTime: 30_000,
});

export function checklistRulesQueryByOrg(orgId: string) {
  return queryOptions({
    ...checklistRulesQuery,
    queryKey: [...checklistRulesQuery.queryKey, orgId],
  });
}

export function knownRuleIds(steps: ChecklistStep[], rows: ChecklistRuleRow[]) {
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

export function applyChecklistRules(steps: ChecklistStep[], rows: ChecklistRuleRow[]) {
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
