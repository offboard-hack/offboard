import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { offboardingCases, tasks } from "../schema/index.ts";

export type TaskStatus = "done" | "in_progress" | "todo";

export type CaseSummary = {
  id: string;
  name: string;
  role: string;
  department: string;
  deadline: string;
  completed: number;
  total: number;
};

export type OffboardingTask = {
  id: string;
  title: string;
  team: string;
  status: TaskStatus;
};

export type OffboardingCase = CaseSummary & { tasks: OffboardingTask[] };

export type NewOffboarding = {
  name: string;
  role: string;
  department: string;
  deadline: string;
};

export type BulkOffboardingRow = { name: string; department: string };

function defaultDeadline() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);

  return date.toISOString().slice(0, 10);
}

export function createRepositories(db: Database) {
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
      with: { tasks: { orderBy: asc(tasks.position) } },
    });

    if (!found) return null;

    const caseTasks = found.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      team: task.team,
      status: task.status,
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
      });

    return updated ?? null;
  }

  return {
    listOffboardings,
    getOffboarding,
    createOffboarding,
    bulkCreateOffboardings,
    updateTaskStatus,
  };
}
