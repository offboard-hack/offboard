import type { Database } from "@offboard/db/client";
import { asc } from "drizzle-orm";
import { integrations } from "@offboard/db/schema";

type ConnectionStatus = (typeof integrations.$inferSelect)["status"];

export function createIntegrationsRepository(db: Database) {
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

  return {
    listIntegrations,
    upsertIntegration,
  };
}

export type IntegrationsRepository = ReturnType<typeof createIntegrationsRepository>;
