import type { RuleTrigger } from "@offboard/db/schema";

export type RuleContext = {
  orgId: string;
  task?: {
    id: string;
    title: string;
    status: string;
    previousStatus?: string;
    phase?: string;
    stepId?: string;
  };
  equipment?: {
    id: string;
    tag?: string;
    item?: string;
    status: string;
    previousStatus?: string;
  };
  case?: { id: string; name: string };
};

export type FireRules = (trigger: RuleTrigger, context: RuleContext) => Promise<void>;

export async function fireTaskStatusChanged(
  fire: FireRules,
  task: {
    orgId: string;
    taskId: string;
    taskTitle: string;
    status: string;
    phase: string | null;
    stepId: string | null;
  },
) {
  if (!task.phase) return;

  await fire("task.status_changed", {
    orgId: task.orgId,
    task: {
      id: task.taskId,
      title: task.taskTitle,
      status: task.status,
      phase: task.phase,
      stepId: task.stepId ?? undefined,
    },
  });
}
