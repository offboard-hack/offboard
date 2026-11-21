import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.ts";
import { offboardingCases, offboardingTasks } from "../schema/index.ts";

export type TaskStatus = "done" | "inProgress" | "todo";

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

export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultDeadline() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14);

  return date.toISOString().slice(0, 10);
}

export function createRepositories(db: Database) {
  function uniqueSlug(name: string, taken: Set<string>) {
    const base = slugify(name) || "desligamento";
    let candidate = base;
    let suffix = 1;

    while (taken.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }

    taken.add(candidate);

    return candidate;
  }

  async function takenSlugs() {
    const rows = await db.select({ slug: offboardingCases.slug }).from(offboardingCases);

    return new Set(rows.map((row) => row.slug));
  }

  async function listOffboardings() {
    const rows = await db
      .select({
        id: offboardingCases.slug,
        name: offboardingCases.name,
        role: offboardingCases.role,
        department: offboardingCases.department,
        deadline: offboardingCases.deadline,
        completed: sql<number>`count(${offboardingTasks.id}) filter (where ${offboardingTasks.status} = 'done')::int`,
        total: sql<number>`count(${offboardingTasks.id})::int`,
      })
      .from(offboardingCases)
      .leftJoin(offboardingTasks, eq(offboardingTasks.caseId, offboardingCases.id))
      .groupBy(offboardingCases.id)
      .orderBy(asc(offboardingCases.deadline), asc(offboardingCases.name));

    return rows;
  }

  async function getOffboarding(slug: string) {
    const found = await db.query.offboardingCases.findFirst({
      where: eq(offboardingCases.slug, slug),
      with: { tasks: { orderBy: asc(offboardingTasks.sortOrder) } },
    });

    if (!found) return null;

    const tasks = found.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      team: task.team,
      status: task.status,
    }));

    return {
      id: found.slug,
      name: found.name,
      role: found.role,
      department: found.department,
      deadline: found.deadline,
      completed: tasks.filter((task) => task.status === "done").length,
      total: tasks.length,
      tasks,
    };
  }

  async function createOffboarding(data: NewOffboarding) {
    const slug = uniqueSlug(data.name, await takenSlugs());
    await db.insert(offboardingCases).values({ ...data, slug });

    return { id: slug, ...data, completed: 0, total: 0 };
  }

  async function bulkCreateOffboardings(rows: BulkOffboardingRow[]) {
    if (rows.length === 0) return [];
    const taken = await takenSlugs();
    const deadline = defaultDeadline();

    const values = rows.map((row) => ({
      ...row,
      role: "Não informado",
      deadline,
      slug: uniqueSlug(row.name, taken),
    }));

    await db.insert(offboardingCases).values(values);

    return values.map(({ slug, ...rest }) => ({ id: slug, ...rest, completed: 0, total: 0 }));
  }

  async function updateTaskStatus(taskId: string, status: TaskStatus) {
    const [updated] = await db
      .update(offboardingTasks)
      .set({ status, updatedAt: new Date() })
      .where(eq(offboardingTasks.id, taskId))
      .returning({
        id: offboardingTasks.id,
        title: offboardingTasks.title,
        team: offboardingTasks.team,
        status: offboardingTasks.status,
      });

    return updated ? { ...updated, status: updated.status } : null;
  }

  return {
    listOffboardings,
    getOffboarding,
    createOffboarding,
    bulkCreateOffboardings,
    updateTaskStatus,
  };
}
