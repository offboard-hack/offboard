import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const offboardingCases = pgTable("offboarding_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 255 }).notNull(),
  department: varchar("department", { length: 255 }).notNull(),
  deadline: date("deadline").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const taskStatusEnum = pgEnum("task_status", ["done", "in_progress", "todo"]);

export const tasks = pgTable(
  "tasks",
  {
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
  },
  (t) => [index("tasks_case_id_idx").on(t.caseId)],
);

export type OffboardingCaseRow = typeof offboardingCases.$inferSelect;

export type TaskRow = typeof tasks.$inferSelect;
