import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export { authAccount, authRateLimit, authSession, authUser, authVerification } from "./auth.ts";

export type ConfigValue =
  | boolean
  | number
  | string
  | null
  | ConfigValue[]
  | { [key: string]: ConfigValue };

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
  description: text("description"),
  dueDate: date("due_date"),
  position: integer("position").notNull(),
  phase: varchar("phase", { length: 50 }),
  trackingCode: varchar("tracking_code", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const subtasks = pgTable(
  "subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("subtasks_task_id_idx").on(table.taskId)],
);

export const exitSurveys = pgTable(
  "exit_surveys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => offboardingCases.id, { onDelete: "cascade" }),
    npsScore: integer("nps_score").notNull(),
    responses: jsonb("responses").$type<Record<string, ConfigValue>>().notNull().default({}),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("exit_surveys_case_id_idx").on(table.caseId),
    check("exit_surveys_nps_score_range", sql`${table.npsScore} between 0 and 10`),
  ],
);

export const offboardingCasesRelations = relations(offboardingCases, ({ many, one }) => ({
  tasks: many(tasks),
  equipment: many(equipment),
  exitSurvey: one(exitSurveys),
}));

export const exitSurveysRelations = relations(exitSurveys, ({ one }) => ({
  case: one(offboardingCases, {
    fields: [exitSurveys.caseId],
    references: [offboardingCases.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  case: one(offboardingCases, {
    fields: [tasks.caseId],
    references: [offboardingCases.id],
  }),
  subtasks: many(subtasks),
}));

export const subtasksRelations = relations(subtasks, ({ one }) => ({
  task: one(tasks, {
    fields: [subtasks.taskId],
    references: [tasks.id],
  }),
}));

export const equipmentReturnMethodEnum = pgEnum("equipment_return_method", [
  "pickup",
  "in_person",
  "correios",
]);

export const equipmentStatusEnum = pgEnum("equipment_status", [
  "in_use",
  "pending_return",
  "in_transit",
  "received",
  "in_inventory",
  "decommissioned",
]);

export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    item: varchar("item", { length: 255 }).notNull(),
    tag: varchar("tag", { length: 50 }).notNull().unique(),
    serialNumber: varchar("serial_number", { length: 100 }),
    assignedTo: varchar("assigned_to", { length: 255 }),
    assignedEmail: varchar("assigned_email", { length: 255 }),
    status: equipmentStatusEnum("status").notNull().default("in_inventory"),
    returnMethod: equipmentReturnMethodEnum("return_method"),
    trackingCode: varchar("tracking_code", { length: 100 }),
    scheduledDate: date("scheduled_date"),
    caseId: uuid("case_id").references(() => offboardingCases.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("equipment_case_id_idx").on(table.caseId),
    index("equipment_task_id_idx").on(table.taskId),
    index("equipment_status_idx").on(table.status),
  ],
);

export const equipmentRelations = relations(equipment, ({ one }) => ({
  case: one(offboardingCases, {
    fields: [equipment.caseId],
    references: [offboardingCases.id],
  }),
  task: one(tasks, {
    fields: [equipment.taskId],
    references: [tasks.id],
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

export const memberRoleEnum = pgEnum("member_role", ["admin", "rh", "gestor", "visualizador"]);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    role: memberRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [uniqueIndex("team_members_email_lower_idx").on(sql`lower(${table.email})`)],
);

export const actionConfigs = pgTable(
  "action_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionId: varchar("action_id", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, ConfigValue>>().notNull().default({}),
    phase: varchar("phase", { length: 50 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [uniqueIndex("action_configs_action_id_idx").on(table.actionId)],
);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "trialing",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
]);

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  monthlyPriceCents: integer("monthly_price_cents").notNull(),
  maxEmployees: integer("max_employees").notNull(),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  currentPeriodStart: date("current_period_start").notNull(),
  currentPeriodEnd: date("current_period_end").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    status: invoiceStatusEnum("status").notNull().default("pending"),
    abacatepayBillingId: varchar("abacatepay_billing_id", { length: 255 }),
    paidAt: timestamp("paid_at"),
    dueDate: date("due_date").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("invoices_subscription_id_idx").on(table.subscriptionId),
    index("invoices_abacatepay_billing_id_idx").on(table.abacatepayBillingId),
  ],
);

export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
  invoices: many(invoices),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
}));
