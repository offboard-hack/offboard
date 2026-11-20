import { asc, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "../schema/index.ts";
import { tasks } from "../schema/index.ts";
import type { TaskDto, TaskRepository } from "./interfaces.ts";
import { toDbStatus, toDtoStatus } from "./status.ts";
import { isUuid } from "./uuid.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: Db) {}

  async listByCase(caseId: string) {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, caseId))
      .orderBy(asc(tasks.position));

    return rows.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      title: r.title,
      team: r.team,
      status: toDtoStatus(r.status),
      position: r.position,
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
        position: sql`(select coalesce(max(${tasks.position}) + 1, 0) from ${tasks} where ${tasks.caseId} = ${caseId})`,
      })
      .returning({ id: tasks.id });

    return { id: row!.id };
  }

  async updateStatus(id: string, status: TaskDto["status"]) {
    if (!isUuid(id)) return;

    await this.db
      .update(tasks)
      .set({ status: toDbStatus(status), updatedAt: new Date() })
      .where(eq(tasks.id, id));
  }
}
