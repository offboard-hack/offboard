import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import type { ConfigValue } from "../schema/index.ts";
import { actionConfigs, integrations, offboardingCases, subtasks, tasks } from "../schema/index.ts";

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

export type SubtaskRow = {
  id: string;
  title: string;
  done: boolean;
};

export type OffboardingTask = {
  id: string;
  title: string;
  team: string;
  status: TaskStatus;
  description: string | null;
  dueDate: string | null;
  subtasks: SubtaskRow[];
};

export type OffboardingCase = CaseSummary & { tasks: OffboardingTask[] };

export type NewOffboarding = {
  name: string;
  role: string;
  department: string;
  deadline: string;
};

export type BulkOffboardingRow = { name: string; department: string };

export type ConnectionStatus = "connected" | "disconnected" | "reconnect";

export type IntegrationRow = { name: string; status: ConnectionStatus };

export type ActionConfigRow = {
  id: string;
  actionId: string;
  enabled: boolean;
  config: Record<string, ConfigValue>;
  phase: string;
};

export type NewActionConfig = {
  actionId: string;
  enabled?: boolean;
  config?: Record<string, ConfigValue>;
  phase: string;
};

const actionConfigColumns = {
  id: actionConfigs.id,
  actionId: actionConfigs.actionId,
  enabled: actionConfigs.enabled,
  config: actionConfigs.config,
  phase: actionConfigs.phase,
};

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
      with: {
        tasks: {
          orderBy: asc(tasks.position),
          with: { subtasks: { orderBy: asc(subtasks.position) } },
        },
      },
    });

    if (!found) return null;

    const caseTasks: OffboardingTask[] = found.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      team: task.team,
      status: task.status,
      description: task.description,
      dueDate: task.dueDate,
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

  async function listIntegrations() {
    const rows = await db
      .select({ name: integrations.name, status: integrations.status })
      .from(integrations)
      .orderBy(asc(integrations.name));

    return rows;
  }

  async function upsertIntegration(name: string, status: ConnectionStatus) {
    const [row] = await db
      .insert(integrations)
      .values({ name, status })
      .onConflictDoUpdate({
        target: integrations.name,
        set: { status, updatedAt: new Date() },
      })
      .returning({ name: integrations.name, status: integrations.status });

    return row;
  }

  async function listActionConfigs() {
    return db.select(actionConfigColumns).from(actionConfigs).orderBy(asc(actionConfigs.actionId));
  }

  async function getActionConfig(id: string) {
    const [row] = await db
      .select(actionConfigColumns)
      .from(actionConfigs)
      .where(eq(actionConfigs.id, id));

    return row ?? null;
  }

  async function createActionConfig(data: NewActionConfig) {
    const [row] = await db.insert(actionConfigs).values(data).returning(actionConfigColumns);

    return row;
  }

  async function updateActionConfig(id: string, data: Partial<NewActionConfig>) {
    const [row] = await db
      .update(actionConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(actionConfigs.id, id))
      .returning(actionConfigColumns);

    return row ?? null;
  }

  async function deleteActionConfig(id: string) {
    const rows = await db
      .delete(actionConfigs)
      .where(eq(actionConfigs.id, id))
      .returning({ id: actionConfigs.id });

    return rows.length > 0;
  }

  return {
    listOffboardings,
    getOffboarding,
    createOffboarding,
    bulkCreateOffboardings,
    updateTaskStatus,
    toggleSubtask,
    listIntegrations,
    upsertIntegration,
    listActionConfigs,
    getActionConfig,
    createActionConfig,
    updateActionConfig,
    deleteActionConfig,
  };
}
