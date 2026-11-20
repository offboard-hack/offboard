import type { TaskDto } from "./interfaces.ts";

export type DbTaskStatus = "done" | "in_progress" | "todo";

const toDb = { done: "done", inProgress: "in_progress", todo: "todo" } as const satisfies Record<
  TaskDto["status"],
  DbTaskStatus
>;

const toDto = { done: "done", in_progress: "inProgress", todo: "todo" } as const satisfies Record<
  DbTaskStatus,
  TaskDto["status"]
>;

export function toDbStatus(status: TaskDto["status"]) {
  return toDb[status];
}

export function toDtoStatus(status: DbTaskStatus) {
  return toDto[status];
}
