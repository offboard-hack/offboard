import { asc, eq, sql } from "drizzle-orm";
import { offboardingCases, tasks } from "../schema/index.ts";
import type { OffboardingRepository } from "./interfaces.ts";
import { toDtoStatus } from "./status.ts";
import type { Db } from "./tasks.ts";

type CaseInput = { name: string; role: string; department: string; deadline: string };

export class DrizzleOffboardingRepository implements OffboardingRepository {
  constructor(private readonly db: Db) {}

  private summaries() {
    return this.db
      .select({
        id: offboardingCases.id,
        name: offboardingCases.name,
        role: offboardingCases.role,
        department: offboardingCases.department,
        deadline: offboardingCases.deadline,
        completed: sql<number>`count(${tasks.id}) filter (where ${tasks.status} = 'done')`.mapWith(
          Number,
        ),
        total: sql<number>`count(${tasks.id})`.mapWith(Number),
      })
      .from(offboardingCases)
      .leftJoin(tasks, eq(tasks.caseId, offboardingCases.id))
      .groupBy(offboardingCases.id);
  }

  async list() {
    return this.summaries().orderBy(asc(offboardingCases.deadline), asc(offboardingCases.name));
  }

  async get(id: string) {
    const [summary] = await this.summaries().where(eq(offboardingCases.id, id));

    if (!summary) return null;

    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.caseId, id))
      .orderBy(asc(tasks.createdAt), asc(tasks.title));

    return {
      ...summary,
      tasks: rows.map((r) => ({
        id: r.id,
        caseId: r.caseId,
        title: r.title,
        team: r.team,
        status: toDtoStatus(r.status),
      })),
    };
  }

  async create(input: CaseInput) {
    const [created] = await this.createMany([input]);

    return created!;
  }

  async createMany(inputs: CaseInput[]) {
    if (inputs.length === 0) return [];

    return this.db.insert(offboardingCases).values(inputs).returning({ id: offboardingCases.id });
  }

  async delete(id: string) {
    await this.db.delete(offboardingCases).where(eq(offboardingCases.id, id));
  }
}
