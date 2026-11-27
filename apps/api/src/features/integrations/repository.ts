import type { Database } from "@offboard/db/client";
import { and, asc, eq } from "drizzle-orm";
import { integrations, type ConfigValue } from "@offboard/db/schema";

type ConnectionStatus = (typeof integrations.$inferSelect)["status"];

export function createIntegrationsRepository(db: Database) {
  async function listIntegrations(orgId: string) {
    const rows = await db
      .select({ name: integrations.name, status: integrations.status })
      .from(integrations)
      .where(eq(integrations.orgId, orgId))
      .orderBy(asc(integrations.name));

    return rows;
  }

  async function upsertIntegration(orgId: string, name: string, status: ConnectionStatus) {
    const [row] = await db
      .insert(integrations)
      .values({ orgId, name, status })
      .onConflictDoUpdate({
        target: [integrations.orgId, integrations.name],
        set: { status, updatedAt: new Date() },
      })
      .returning({ name: integrations.name, status: integrations.status });

    return row;
  }

  async function readConfig(orgId: string, name: string) {
    const [row] = await db
      .select({ config: integrations.config })
      .from(integrations)
      .where(and(eq(integrations.orgId, orgId), eq(integrations.name, name)));

    return row?.config ?? {};
  }

  async function saveConfig(
    orgId: string,
    name: string,
    status: ConnectionStatus,
    config: Record<string, ConfigValue>,
  ) {
    await db
      .insert(integrations)
      .values({ orgId, name, status, config })
      .onConflictDoUpdate({
        target: [integrations.orgId, integrations.name],
        set: { status, config, updatedAt: new Date() },
      });
  }

  return {
    listIntegrations,
    upsertIntegration,
    readConfig,
    saveConfig,
  };
}

export type IntegrationsRepository = ReturnType<typeof createIntegrationsRepository>;
