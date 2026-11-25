import type { Database } from "@offboard/db/client";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { employeeAccess, offboardingCases, subtasks, tasks } from "@offboard/db/schema";
import { emptyEmployeePlan } from "@offboard/employee";

type TaskStatus = (typeof tasks.$inferSelect)["status"];

type NewOffboarding = Pick<
  typeof offboardingCases.$inferInsert,
  "name" | "role" | "department" | "deadline"
> & { email: string };

type BulkOffboardingRow = Pick<NewOffboarding, "name" | "department">;

function defaultDeadline() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);

  return date.toISOString().slice(0, 10);
}

export function createOffboardingsRepository(db: Database) {
  async function listOffboardings(orgId: string) {
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
      .where(eq(offboardingCases.orgId, orgId))
      .groupBy(offboardingCases.id)
      .orderBy(asc(offboardingCases.deadline), asc(offboardingCases.name));

    return rows;
  }

  function fetchOffboarding(orgId: string, id: string) {
    return db.query.offboardingCases.findFirst({
      where: and(eq(offboardingCases.id, id), eq(offboardingCases.orgId, orgId)),
      with: {
        tasks: {
          orderBy: asc(tasks.position),
          with: { subtasks: { orderBy: asc(subtasks.position) } },
        },
      },
    });
  }

  async function getOffboarding(orgId: string, id: string) {
    const found = await fetchOffboarding(orgId, id);

    if (!found) return null;

    return serializeOffboarding(found);
  }

  function serializeOffboarding(found: NonNullable<Awaited<ReturnType<typeof fetchOffboarding>>>) {
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

  async function listOffboardingsWithTasks(orgId: string) {
    const rows = await db.query.offboardingCases.findMany({
      where: eq(offboardingCases.orgId, orgId),
      orderBy: [asc(offboardingCases.deadline), asc(offboardingCases.name)],
      with: {
        tasks: {
          orderBy: asc(tasks.position),
          with: { subtasks: { orderBy: asc(subtasks.position) } },
        },
      },
    });

    return rows.map(serializeOffboarding);
  }

  async function createOffboarding(orgId: string, data: NewOffboarding) {
    const { email, ...caseData } = data;
    const normalizedEmail = email.trim().toLowerCase();

    return db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(offboardingCases)
        .values({ ...caseData, orgId })
        .returning({ id: offboardingCases.id });

      await tx.insert(employeeAccess).values({
        caseId: inserted.id,
        orgId,
        email: normalizedEmail,
        plan: emptyEmployeePlan,
      });

      return { id: inserted.id, ...caseData, completed: 0, total: 0 };
    });
  }

  async function bulkCreateOffboardings(orgId: string, rows: BulkOffboardingRow[]) {
    if (rows.length === 0) return [];
    const deadline = defaultDeadline();

    const values = rows.map((row) => ({
      ...row,
      role: "Não informado",
      deadline,
    }));

    const inserted = await db
      .insert(offboardingCases)
      .values(values.map((value) => ({ ...value, orgId })))
      .returning({ id: offboardingCases.id });

    return inserted.map((row, i) => ({ id: row.id, ...values[i], completed: 0, total: 0 }));
  }

  async function getTaskPhase(orgId: string, taskId: string) {
    const [row] = await db
      .select({ phase: tasks.phase })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));

    return row?.phase ?? null;
  }

  async function updateTaskStatus(orgId: string, taskId: string, status: TaskStatus) {
    const [updated] = await db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
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

  async function toggleSubtask(orgId: string, subtaskId: string) {
    const [row] = await db
      .update(subtasks)
      .set({ done: sql`NOT ${subtasks.done}`, updatedAt: new Date() })
      .where(and(eq(subtasks.id, subtaskId), eq(subtasks.orgId, orgId)))
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
        orgId: tasks.orgId,
        title: tasks.title,
        phase: tasks.phase,
        trackingCode: tasks.trackingCode,
      })
      .from(tasks)
      .where(and(isNotNull(tasks.trackingCode), ne(tasks.status, "done")));
  }

  async function setTrackingCode(orgId: string, taskId: string, code: string) {
    const [row] = await db
      .update(tasks)
      .set({ trackingCode: code, updatedAt: new Date() })
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)))
      .returning({ id: tasks.id, trackingCode: tasks.trackingCode });

    return row ?? null;
  }

  async function getTaskTrackingCode(orgId: string, taskId: string) {
    const [row] = await db
      .select({ id: tasks.id, trackingCode: tasks.trackingCode, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.orgId, orgId)));

    return row ?? null;
  }

  async function getTaskOrgId(taskId: string) {
    const [row] = await db.select({ orgId: tasks.orgId }).from(tasks).where(eq(tasks.id, taskId));

    return row?.orgId ?? null;
  }

  return {
    listOffboardings,
    listOffboardingsWithTasks,
    getOffboarding,
    createOffboarding,
    bulkCreateOffboardings,
    getTaskPhase,
    updateTaskStatus,
    toggleSubtask,
    getTrackedTasks,
    setTrackingCode,
    getTaskTrackingCode,
    getTaskOrgId,
  };
}

export type OffboardingsRepository = ReturnType<typeof createOffboardingsRepository>;
