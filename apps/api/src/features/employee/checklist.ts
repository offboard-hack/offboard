import type { Departure } from "@offboard/employee/departure";
import type { Database } from "@offboard/db/client";
import { tasks } from "@offboard/db/schema";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { employeeTaskAction, employeeTeam } from "../../shared/task-workflow.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type TaskStatus = (typeof tasks.$inferSelect)["status"];

const actionFields = {
  orgId: tasks.orgId,
  taskId: tasks.id,
  taskTitle: tasks.title,
  phase: tasks.phase,
  stepId: tasks.checklistStepId,
  status: tasks.status,
};

export type ChecklistChange = Awaited<ReturnType<typeof setWorkflowTasks>>[number];

export async function readChecklist(tx: Transaction, orgId: string, caseId: string) {
  const rows = await tx
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      dueDate: tasks.dueDate,
      dueTime: sql<string | null>`to_char(${tasks.dueTime}, 'HH24:MI')`,
      status: tasks.status,
      stepId: tasks.checklistStepId,
    })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.caseId, caseId), eq(tasks.team, employeeTeam)))
    .orderBy(asc(tasks.position));

  return rows.map(({ stepId, ...row }) => ({ ...row, action: employeeTaskAction(stepId) }));
}

export async function setChecklistTask(
  tx: Transaction,
  orgId: string,
  caseId: string,
  taskId: string,
  done: boolean,
) {
  const conditions = and(
    eq(tasks.orgId, orgId),
    eq(tasks.caseId, caseId),
    eq(tasks.team, employeeTeam),
    eq(tasks.id, taskId),
  );

  const [task] = await tx.select(actionFields).from(tasks).where(conditions).for("update");

  if (!task || employeeTaskAction(task.stepId) !== "check") return null;

  const status: "done" | "todo" = done ? "done" : "todo";

  const changes =
    task.status === status
      ? []
      : await tx
          .update(tasks)
          .set({ status, updatedAt: new Date() })
          .where(conditions)
          .returning(actionFields);

  return { id: taskId, status, changes };
}

export function setWorkflowTasks(
  tx: Transaction,
  orgId: string,
  caseId: string,
  stepIds: string[],
  status: TaskStatus,
  employeeOnly = false,
) {
  return tx
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.orgId, orgId),
        eq(tasks.caseId, caseId),
        inArray(tasks.checklistStepId, stepIds),
        ne(tasks.status, status),
        employeeOnly ? eq(tasks.team, employeeTeam) : undefined,
      ),
    )
    .returning(actionFields);
}

const collectStepId = "collect";

export async function readTrackingCode(tx: Transaction, orgId: string, caseId: string) {
  const [row] = await tx
    .select({ trackingCode: tasks.trackingCode })
    .from(tasks)
    .where(
      and(
        eq(tasks.orgId, orgId),
        eq(tasks.caseId, caseId),
        eq(tasks.checklistStepId, collectStepId),
      ),
    );

  return row?.trackingCode ?? null;
}

export async function setTrackingCode(
  tx: Transaction,
  orgId: string,
  caseId: string,
  code: string,
) {
  const [updated] = await tx
    .update(tasks)
    .set({
      trackingCode: code,
      status: sql<TaskStatus>`case when ${tasks.status} = 'done' then 'todo' else ${tasks.status} end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tasks.orgId, orgId),
        eq(tasks.caseId, caseId),
        eq(tasks.checklistStepId, collectStepId),
      ),
    )
    .returning({ id: tasks.id, trackingCode: tasks.trackingCode });

  return updated;
}

export async function syncDepartureTasks(
  tx: Transaction,
  orgId: string,
  caseId: string,
  previous: Departure,
  next: Departure,
) {
  const changes: ChecklistChange[] = [];

  if (Boolean(previous.booking) !== Boolean(next.booking)) {
    const status = next.booking ? "done" : "todo";
    changes.push(...(await setWorkflowTasks(tx, orgId, caseId, ["collect"], status)));
    changes.push(...(await setWorkflowTasks(tx, orgId, caseId, ["confirm"], status, true)));
  }

  if (Boolean(previous.feedback) !== Boolean(next.feedback)) {
    changes.push(
      ...(await setWorkflowTasks(
        tx,
        orgId,
        caseId,
        ["survey"],
        next.feedback ? "done" : "todo",
        true,
      )),
    );
  }

  return changes;
}
