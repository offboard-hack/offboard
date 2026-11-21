import { relations } from "drizzle-orm";
import { date, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const offboardingCases = pgTable("offboarding_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 255 }).notNull(),
  department: varchar("department", { length: 100 }).notNull(),
  deadline: date("deadline").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const offboardingTasks = pgTable("offboarding_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => offboardingCases.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  team: varchar("team", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 })
    .$type<"done" | "inProgress" | "todo">()
    .notNull()
    .default("todo"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const offboardingCasesRelations = relations(offboardingCases, ({ many }) => ({
  tasks: many(offboardingTasks),
}));

export const offboardingTasksRelations = relations(offboardingTasks, ({ one }) => ({
  case: one(offboardingCases, {
    fields: [offboardingTasks.caseId],
    references: [offboardingCases.id],
  }),
}));
