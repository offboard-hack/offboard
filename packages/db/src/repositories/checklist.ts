import { asc, eq } from "drizzle-orm";
import { checklistRules } from "../schema/index.ts";
import type { ChecklistRepository } from "./interfaces.ts";
import type { Db } from "./tasks.ts";
import { isUuid } from "./uuid.ts";

export class DrizzleChecklistRepository implements ChecklistRepository {
  constructor(private readonly db: Db) {}

  async list() {
    const rows = await this.db.select().from(checklistRules).orderBy(asc(checklistRules.title));

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      team: r.team,
      timing: r.timing,
      required: r.required,
      enabled: r.enabled,
    }));
  }

  async setEnabled(id: string, enabled: boolean) {
    if (!isUuid(id)) return;

    await this.db.update(checklistRules).set({ enabled }).where(eq(checklistRules.id, id));
  }
}
