import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../schema/index.ts";
import { tasks } from "../schema/index.ts";
import type { TaskDto, TaskRepository } from "./interfaces.ts";
import { toDbStatus, toDtoStatus } from "./status.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: Db) {}

  async listByCase(caseId: string) {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, caseId))
      .orderBy(asc(tasks.createdAt), asc(tasks.title));

    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      title: r.title,
      team: r.team,
      status: toDtoStatus(r.status),
    }));
  }

  async create(caseId: string, input: { title: string; team: string; status?: TaskDto["status"] }) {
    const [row] = await this.db
      .insert(tasks)
      .values({
        caseId,
        title: input.title,
        team: input.team,
        status: toDbStatus(input.status ?? "todo"),
      })
      .returning({ id: tasks.id });

    return { id: row!.id };
  }

  async updateStatus(id: string, status: TaskDto["status"]) {
    await this.db
      .update(tasks)
      .set({ status: toDbStatus(status), updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }
}
