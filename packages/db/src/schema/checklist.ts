import { boolean, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";

export const checklistRules = pgTable("checklist_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").notNull(),
  team: varchar("team", { length: 255 }).notNull(),
  timing: varchar("timing", { length: 255 }).notNull(),
  required: boolean("required").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
});

export type ChecklistRuleRow = typeof checklistRules.$inferSelect;
