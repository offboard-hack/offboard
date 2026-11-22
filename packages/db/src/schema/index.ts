import { relations } from "drizzle-orm";
import {
  date,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const taskStatusEnum = pgEnum("task_status", ["todo", "in_progress", "done"]);

export const offboardingCases = pgTable("offboarding_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 255 }).notNull(),
  department: varchar("department", { length: 255 }).notNull(),
  deadline: date("deadline").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => offboardingCases.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  team: varchar("team", { length: 255 }).notNull(),
  status: taskStatusEnum("status").notNull().default("todo"),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const offboardingCasesRelations = relations(offboardingCases, ({ many }) => ({
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  case: one(offboardingCases, {
    fields: [tasks.caseId],
    references: [offboardingCases.id],
  }),
}));

export const connectionStatusEnum = pgEnum("connection_status", [
  "connected",
  "disconnected",
  "reconnect",
]);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    status: connectionStatusEnum("status").notNull().default("disconnected"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [uniqueIndex("integrations_name_idx").on(table.name)],
);
