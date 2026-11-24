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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export { authAccount, authRateLimit, authSession, authUser, authVerification } from "./auth.ts";

export type ResumeContent = {
  headline: { id: string; text: string };
  summary: { id: string; text: string };
  experiences: {
    id: string;
    company: string;
    role: string;
    start: string;
    end: string | null;
    bullets: { id: string; text: string }[];
  }[];
  education: {
    id: string;
    institution: string;
    degree: string;
    start: string | null;
    end: string | null;
  }[];
  skills: { id: string; name: string }[];
  languages: { id: string; name: string; level: string | null }[];
  contact: {
    email: string | null;
    phone: string | null;
    city: string | null;
    links: string[];
  };
};

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

export const talentProfiles = pgTable(
  "talent_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .unique()
      .references(() => offboardingCases.id, { onDelete: "set null" }),
    personalEmail: varchar("personal_email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sponsoredUntil: date("sponsored_until").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at"),
    firstSignedInAt: timestamp("first_signed_in_at"),
    shareOutcomeWithHr: boolean("share_outcome_with_hr").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("talent_profiles_email_lower_idx").on(sql`lower(${table.personalEmail})`),
  ],
);

export const jobOriginEnum = pgEnum("job_origin", ["external", "hr", "recruiter"]);

export const jobWorkModelEnum = pgEnum("job_work_model", ["remote", "hybrid", "onsite"]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    origin: jobOriginEnum("origin").notNull(),
    source: varchar("source", { length: 50 }).notNull(),
    sourceKey: varchar("source_key", { length: 2048 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    company: varchar("company", { length: 255 }).notNull(),
    workModel: jobWorkModelEnum("work_model"),
    city: varchar("city", { length: 255 }),
    state: varchar("state", { length: 2 }),
    salaryMinCents: integer("salary_min_cents"),
    salaryMaxCents: integer("salary_max_cents"),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    postedAt: timestamp("posted_at"),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("jobs_source_key_idx").on(table.source, table.sourceKey),
    check(
      "jobs_salary_range",
      sql`${table.salaryMinCents} is null or ${table.salaryMaxCents} is null or ${table.salaryMinCents} <= ${table.salaryMaxCents}`,
    ),
  ],
);

export const applicationStatusEnum = pgEnum("application_status", [
  "sent",
  "in_review",
  "interview",
  "offer",
  "closed",
]);

export const applicationClosedReasonEnum = pgEnum("application_closed_reason", [
  "rejected",
  "withdrawn",
  "hired",
]);

export const interviewModeEnum = pgEnum("interview_mode", ["video", "in_person", "phone"]);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    status: applicationStatusEnum("status").notNull().default("sent"),
    furthestStage: applicationStatusEnum("furthest_stage").notNull().default("sent"),
    closedReason: applicationClosedReasonEnum("closed_reason"),
    appliedAt: timestamp("applied_at").notNull().defaultNow(),
    statusChangedAt: timestamp("status_changed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("applications_profile_job_idx").on(table.profileId, table.jobId),
    index("applications_profile_id_idx").on(table.profileId),
    check(
      "applications_closed_reason",
      sql`(${table.status} = 'closed') = (${table.closedReason} is not null)`,
    ),
    check("applications_furthest_stage", sql`${table.furthestStage} <> 'closed'`),
  ],
);

export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    status: applicationStatusEnum("status").notNull(),
    closedReason: applicationClosedReasonEnum("closed_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("application_events_application_id_idx").on(table.applicationId)],
);

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    mode: interviewModeEnum("mode").notNull(),
    withWhom: varchar("with_whom", { length: 255 }).notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("interviews_application_id_idx").on(table.applicationId),
    index("interviews_starts_at_idx").on(table.startsAt),
  ],
);

export const offboardingCasesRelations = relations(offboardingCases, ({ many, one }) => ({
  tasks: many(tasks),
  equipment: many(equipment),
  exitSurvey: one(exitSurveys),
  talentProfile: one(talentProfiles),
}));

export const talentProfilesRelations = relations(talentProfiles, ({ one }) => ({
  case: one(offboardingCases, {
    fields: [talentProfiles.caseId],
    references: [offboardingCases.id],
  }),
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

export const equipmentReturnMethodEnum = pgEnum("equipment_return_method", ["pickup", "in_person"]);

export const equipmentStatusEnum = pgEnum("equipment_status", [
  "with_person",
  "scheduled",
  "transit",
  "received",
  "inventory",
  "failed",
]);

export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => offboardingCases.id, { onDelete: "cascade" }),
    item: varchar("item", { length: 255 }).notNull(),
    tag: varchar("tag", { length: 50 }).notNull().unique(),
    returnMethod: equipmentReturnMethodEnum("return_method").notNull(),
    scheduledDate: date("scheduled_date"),
    status: equipmentStatusEnum("status").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("equipment_case_id_idx").on(table.caseId)],
);

export const equipmentRelations = relations(equipment, ({ one }) => ({
  case: one(offboardingCases, {
    fields: [equipment.caseId],
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

export const resumeKindEnum = pgEnum("resume_kind", ["base", "tailored"]);

export const resumeStatusEnum = pgEnum("resume_status", ["draft", "ready"]);

export const resumes = pgTable(
  "resumes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    kind: resumeKindEnum("kind").notNull(),
    status: resumeStatusEnum("status").notNull().default("ready"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "restrict" }),
    content: jsonb("content").$type<ResumeContent>().notNull(),
    score: integer("score"),
    scoredAt: timestamp("scored_at"),
    sourceFileKey: varchar("source_file_key", { length: 512 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("resumes_one_base_idx")
      .on(table.profileId)
      .where(sql`${table.kind} = 'base'`),
    uniqueIndex("resumes_profile_job_idx")
      .on(table.profileId, table.jobId)
      .where(sql`${table.kind} = 'tailored'`),
    check("resumes_kind_job", sql`(${table.kind} = 'base') = (${table.jobId} is null)`),
    check("resumes_base_ready", sql`${table.kind} <> 'base' or ${table.status} = 'ready'`),
    check("resumes_score_range", sql`${table.score} is null or ${table.score} between 0 and 100`),
  ],
);

export const backgroundJobStatusEnum = pgEnum("background_job_status", [
  "pending",
  "running",
  "done",
  "failed",
]);

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: varchar("kind", { length: 50 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    payload: jsonb("payload").$type<Record<string, ConfigValue>>().notNull().default({}),
    status: backgroundJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after").notNull(),
    lockedUntil: timestamp("locked_until"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("background_jobs_pending_idx")
      .on(table.kind, table.subject)
      .where(sql`${table.status} = 'pending'`),
    index("background_jobs_claim_idx").on(table.status, table.runAfter),
  ],
);

export const resumeSuggestionStatusEnum = pgEnum("resume_suggestion_status", [
  "open",
  "applied",
  "dismissed",
]);

export const resumeSuggestions = pgTable(
  "resume_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resumeId: uuid("resume_id")
      .notNull()
      .references(() => resumes.id, { onDelete: "cascade" }),
    targetNodeId: varchar("target_node_id", { length: 64 }).notNull(),
    originalText: text("original_text").notNull(),
    suggestedText: text("suggested_text").notNull(),
    rationale: text("rationale").notNull(),
    estimatedGain: integer("estimated_gain").notNull(),
    status: resumeSuggestionStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("resume_suggestions_resume_idx").on(table.resumeId),
    check("resume_suggestions_gain", sql`${table.estimatedGain} between 1 and 20`),
  ],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    calls: integer("calls").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.profileId, table.day] })],
);
