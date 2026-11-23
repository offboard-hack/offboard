import type { Database } from "@offboard/db/client";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { offboardingCases, subtasks, tasks } from "@offboard/db/schema";

type TaskStatus = (typeof tasks.$inferSelect)["status"];

type NewOffboarding = Pick<
  typeof offboardingCases.$inferInsert,
  "name" | "role" | "department" | "deadline"
>;

type BulkOffboardingRow = Pick<NewOffboarding, "name" | "department">;

function defaultDeadline() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);

  return date.toISOString().slice(0, 10);
}

export function createOffboardingsRepository(db: Database) {
  async function listOffboardings() {
    const rows = await db
      .select({
        id: offboardingCases.id,
        name: offboardingCases.name,
        role: offboardingCases.role,
        department: offboardingCases.department,
        deadline: offboardingCases.deadline,
        completed: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')::int`,
        total: sql<number>`count(${tasks.id})::int`,
      })
      .from(offboardingCases)
      .leftJoin(tasks, eq(tasks.caseId, offboardingCases.id))
      .groupBy(offboardingCases.id)
      .orderBy(asc(offboardingCases.deadline), asc(offboardingCases.name));

    return rows;
  }

  async function getOffboarding(id: string) {
    const found = await db.query.offboardingCases.findFirst({
      where: eq(offboardingCases.id, id),
      with: {
        tasks: {
          orderBy: asc(tasks.position),
          with: { subtasks: { orderBy: asc(subtasks.position) } },
        },
      },
    });

    if (!found) return null;

    const caseTasks = found.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      team: task.team,
      status: task.status,
      description: task.description,
      dueDate: task.dueDate,
      trackingCode: task.trackingCode,
      subtasks: task.subtasks.map((sub) => ({
        id: sub.id,
        title: sub.title,
        done: sub.done,
      })),
    }));

    return {
      id: found.id,
      name: found.name,
      role: found.role,
      department: found.department,
      deadline: found.deadline,
      completed: caseTasks.filter((task) => task.status === "done").length,
      total: caseTasks.length,
      tasks: caseTasks,
    };
  }

  async function createOffboarding(data: NewOffboarding) {
    const [inserted] = await db
      .insert(offboardingCases)
      .values(data)
      .returning({ id: offboardingCases.id });

    return { id: inserted.id, ...data, completed: 0, total: 0 };
  }

  async function bulkCreateOffboardings(rows: BulkOffboardingRow[]) {
    if (rows.length === 0) return [];
    const deadline = defaultDeadline();

    const values = rows.map((row) => ({
      ...row,
      role: "Não informado",
      deadline,
    }));

    const inserted = await db
      .insert(offboardingCases)
      .values(values)
      .returning({ id: offboardingCases.id });

    return inserted.map((row, i) => ({ id: row.id, ...values[i], completed: 0, total: 0 }));
  }

  async function getTaskPhase(taskId: string) {
    const [row] = await db.select({ phase: tasks.phase }).from(tasks).where(eq(tasks.id, taskId));

    return row?.phase ?? null;
  }

  async function updateTaskStatus(taskId: string, status: TaskStatus) {
    const [updated] = await db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning({
        id: tasks.id,
        title: tasks.title,
        team: tasks.team,
        status: tasks.status,
        description: tasks.description,
        dueDate: tasks.dueDate,
        trackingCode: tasks.trackingCode,
      });

    if (!updated) return null;

    const subs = await db
      .select({ id: subtasks.id, title: subtasks.title, done: subtasks.done })
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId))
      .orderBy(asc(subtasks.position));

    return { ...updated, subtasks: subs };
  }

  async function toggleSubtask(subtaskId: string) {
    const [row] = await db
      .update(subtasks)
      .set({ done: sql`NOT ${subtasks.done}`, updatedAt: new Date() })
      .where(eq(subtasks.id, subtaskId))
      .returning({
        id: subtasks.id,
        title: subtasks.title,
        done: subtasks.done,
      });

    return row ?? null;
  }

  async function getTrackedTasks() {
    return db
      .select({
        id: tasks.id,
        title: tasks.title,
        phase: tasks.phase,
        trackingCode: tasks.trackingCode,
      })
      .from(tasks)
      .where(and(isNotNull(tasks.trackingCode), ne(tasks.status, "done")));
  }

  async function setTrackingCode(taskId: string, code: string) {
    const [row] = await db
      .update(tasks)
      .set({ trackingCode: code, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning({ id: tasks.id, trackingCode: tasks.trackingCode });

    return row ?? null;
  }

  async function getTaskTrackingCode(taskId: string) {
    const [row] = await db
      .select({ id: tasks.id, trackingCode: tasks.trackingCode, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId));

    return row ?? null;
  }

  return {
    listOffboardings,
    getOffboarding,
    createOffboarding,
    bulkCreateOffboardings,
    getTaskPhase,
    updateTaskStatus,
    toggleSubtask,
    getTrackedTasks,
    setTrackingCode,
    getTaskTrackingCode,
  };
}

export type OffboardingsRepository = ReturnType<typeof createOffboardingsRepository>;
