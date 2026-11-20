import { integer, pgTable, uuid, varchar } from "drizzle-orm/pg-core";

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  priceCents: integer("price_cents").notNull(),
  activeLicenses: integer("active_licenses").notNull().default(0),
  capacity: integer("capacity").notNull(),
  costCenter: varchar("cost_center", { length: 255 }).notNull(),
});

export type PlanRow = typeof plans.$inferSelect;
