export type ActionContext = {
  taskId: string;
  taskTitle: string;
  status: string;
  phase: string;
};

export type DispatchAction = (context: ActionContext) => Promise<void>;
