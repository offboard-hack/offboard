import { asc } from "drizzle-orm";
import { beneficiaries, teamMembers } from "../schema/index.ts";
import type { AccessRepository } from "./interfaces.ts";
import type { Db } from "./tasks.ts";

export class DrizzleAccessRepository implements AccessRepository {
  constructor(private readonly db: Db) {}

  async listBeneficiaries() {
    const rows = await this.db.select().from(beneficiaries).orderBy(asc(beneficiaries.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      plan: r.plan,
      status: r.status,
      accessUntil: r.accessUntil,
    }));
  }

  async listTeamMembers() {
    const rows = await this.db.select().from(teamMembers).orderBy(asc(teamMembers.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      accessScope: r.accessScope,
      securityStatus: r.securityStatus,
    }));
  }
}
