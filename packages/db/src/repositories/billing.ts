import { asc } from "drizzle-orm";
import { plans } from "../schema/index.ts";
import type { BillingRepository } from "./interfaces.ts";
import type { Db } from "./tasks.ts";

export class DrizzleBillingRepository implements BillingRepository {
  constructor(private readonly db: Db) {}

  async listPlans() {
    const rows = await this.db.select().from(plans).orderBy(asc(plans.priceCents), asc(plans.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      priceCents: r.priceCents,
      activeLicenses: r.activeLicenses,
      capacity: r.capacity,
      costCenter: r.costCenter,
    }));
  }
}
