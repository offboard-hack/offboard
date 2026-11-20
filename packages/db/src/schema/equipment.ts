import { date, pgEnum, pgTable, uuid, varchar } from "drizzle-orm/pg-core";

export const equipmentStatusEnum = pgEnum("equipment_status", [
  "scheduled",
  "received",
  "failed",
  "inventory",
  "transit",
  "with_person",
]);

export const equipment = pgTable("equipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  item: varchar("item", { length: 255 }).notNull(),
  tag: varchar("tag", { length: 50 }).notNull().unique(),
  person: varchar("person", { length: 255 }).notNull(),
  method: varchar("method", { length: 100 }).notNull(),
  scheduledDate: date("scheduled_date"),
  status: equipmentStatusEnum("status").notNull().default("with_person"),
});

export type EquipmentRow = typeof equipment.$inferSelect;
