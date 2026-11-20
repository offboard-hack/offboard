import { asc, eq } from "drizzle-orm";
import { integrations } from "../schema/index.ts";
import type { IntegrationDto, IntegrationRepository } from "./interfaces.ts";
import type { Db } from "./tasks.ts";

export class DrizzleIntegrationRepository implements IntegrationRepository {
  constructor(private readonly db: Db) {}

  async list(status?: IntegrationDto["status"]) {
    const query = this.db.select().from(integrations);

    const rows = await (status ? query.where(eq(integrations.status, status)) : query).orderBy(
      asc(integrations.name),
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      purpose: r.purpose,
      status: r.status,
      lastActivity: r.lastActivity,
    }));
  }
}
