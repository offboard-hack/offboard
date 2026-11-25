export type ActionContext = {
  orgId: string;
  taskId: string;
  taskTitle: string;
  status: string;
  phase: string;
};

export type DispatchAction = (
  context: ActionContext,
  checklistStepId?: string | null,
) => Promise<void>;

export async function dispatchTaskAction(
  dispatch: DispatchAction,
  task: Omit<ActionContext, "phase"> & { phase: string | null; stepId: string | null },
) {
  const { phase, stepId, ...context } = task;

  if (phase) await dispatch({ ...context, phase }, stepId);
}
