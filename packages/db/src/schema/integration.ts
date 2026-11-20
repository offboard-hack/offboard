import { pgEnum, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";

export const integrationStatusEnum = pgEnum("integration_status", ["connected", "disconnected"]);

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  purpose: text("purpose").notNull(),
  status: integrationStatusEnum("status").notNull(),
  lastActivity: varchar("last_activity", { length: 500 }),
});

export type IntegrationRow = typeof integrations.$inferSelect;
