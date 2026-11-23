import { queryOptions } from "@tanstack/react-query";
import type { ApiClient, Treaty } from "@offboard/api-client";
import type { ChecklistStep } from "./checklist-draft";
import { stepFormSchema } from "./step-settings";
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

export async function syncActionConfigs(steps: ChecklistStep[], existing: ActionConfigRow[]) {
  const api = getApiClient().api["action-configs"];
  const desired = desiredConfigs(steps);
  const current = new Map(existing.map((row) => [row.actionId, row]));

  const removals = existing.flatMap((row) =>
    kinds.some((kind) => row.actionId.startsWith(`${kind}:`)) && !desired.has(row.actionId)
      ? [checkWrite(api({ id: encodeURIComponent(row.id) }).delete())]
      : [],
  );

  const writes = [...desired].flatMap(([actionId, { phase, config }]) => {
    const row = current.get(actionId);

    if (!row) return [checkWrite(api.post({ actionId, phase, enabled: true, config }))];

    const unchanged = row.phase === phase && JSON.stringify(row.config) === JSON.stringify(config);

    return unchanged
      ? []
      : [checkWrite(api({ id: encodeURIComponent(row.id) }).put({ phase, config }))];
  });

  await Promise.all([...removals, ...writes]);
}

export function applyActionConfigs(steps: ChecklistStep[], rows: ActionConfigRow[]) {
  const byActionId = new Map(rows.map((row) => [row.actionId, row]));

  return steps.map<ChecklistStep>((step) => {
    const email =
      step.email ??
      stepFormSchema.shape.email.safeParse(byActionId.get(`email:${step.id}`)?.config).data;

    const slack =
      step.slack ??
      stepFormSchema.shape.slack.safeParse(byActionId.get(`slack:${step.id}`)?.config).data;

    const webhook =
      step.webhook ??
      stepFormSchema.shape.webhook.safeParse(byActionId.get(`webhook:${step.id}`)?.config).data;

    return { ...step, email, slack, webhook };
  });
}
