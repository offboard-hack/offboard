import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { ChecklistStep } from "@/features/checklist/checklist-draft";
import { stepFormSchema } from "@/features/checklist/step-settings";
import { apiBase } from "./offboarding";

const kinds = ["email", "slack", "webhook"] as const;

const configValues = z.record(z.string(), z.string());

const actionConfigRowSchema = z.object({
  id: z.string(),
  actionId: z.string(),
  enabled: z.boolean(),
  config: configValues,
  phase: z.string(),
});

export type ActionConfigRow = z.infer<typeof actionConfigRowSchema>;

type ActionConfigPayload = {
  actionId?: string;
  phase?: string;
  enabled?: boolean;
  config?: z.infer<typeof configValues>;
};

async function listActionConfigs() {
  const response = await fetch(`${apiBase()}/api/action-configs`);

  if (!response.ok) {
    throw new Error("Failed to fetch action configs");
  }

  return z.array(actionConfigRowSchema).parse(await response.json());
}

export const actionConfigsQuery = queryOptions({
  queryKey: ["action-configs"],
  queryFn: listActionConfigs,
  staleTime: 30_000,
});

async function send(path: string, method: string, body?: ActionConfigPayload) {
  const response = await fetch(`${apiBase()}/api/action-configs${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("Failed to save action config");
  }
}

function desiredConfigs(steps: ChecklistStep[]) {
  return new Map<string, { phase: string; config: z.infer<typeof configValues> }>(
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
  const desired = desiredConfigs(steps);
  const current = new Map(existing.map((row) => [row.actionId, row]));

  const removals = existing.flatMap((row) =>
    kinds.some((kind) => row.actionId.startsWith(`${kind}:`)) && !desired.has(row.actionId)
      ? [send(`/${row.id}`, "DELETE")]
      : [],
  );

  const writes = [...desired].flatMap(([actionId, { phase, config }]) => {
    const row = current.get(actionId);

    if (!row) return [send("", "POST", { actionId, phase, enabled: true, config })];

    const unchanged = row.phase === phase && JSON.stringify(row.config) === JSON.stringify(config);

    return unchanged ? [] : [send(`/${row.id}`, "PUT", { phase, config })];
  });

  await Promise.all([...removals, ...writes]);
}

export function applyActionConfigs(steps: ChecklistStep[], rows: ActionConfigRow[]) {
  const byActionId = new Map(rows.map((row) => [row.actionId, row]));

  return steps.map((step) => {
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
