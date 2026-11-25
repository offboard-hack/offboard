export type ActionContext = {
  orgId: string;
  taskId: string;
  taskTitle: string;
  status: string;
  phase: string;
};

export type DispatchAction = (context: ActionContext) => Promise<void>;
