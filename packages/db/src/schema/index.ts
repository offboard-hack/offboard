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
  unique,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { authUser } from "./auth.ts";

export { authAccount, authRateLimit, authSession, authUser, authVerification } from "./auth.ts";

export type BenefitPolicyRule = {
  id: string;
  field: "department" | "role";
  operator: "equals" | "notEquals" | "contains";
  value: string;
  planId: string;
};

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

export type ResumeScoreBreakdown = Record<string, { points: number; max: number; reason: string }>;

export type JobPreferences = {
  workModels?: ("remote" | "hybrid" | "onsite")[];
  locations?: { city: string | null; state: string }[];
  relocate?: boolean;
  salaryFloorCents?: number | null;
  seniorities?: ("intern" | "junior" | "mid" | "senior" | "lead" | "manager" | "director")[];
  excludedCompanies?: string[];
};

export type ProfileField = { value: string | null; share: boolean };

export type Address = {
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
};

export type AddressField = { value: Address | null; share: boolean };

export type ProfileFields = {
  phone?: ProfileField;
  city?: ProfileField;
  linkedin?: ProfileField;
  portfolio?: ProfileField;
  workAuthorization?: ProfileField;
  availability?: ProfileField;
  noticePeriod?: ProfileField;
  salaryExpectation?: ProfileField;
  cpf?: ProfileField;
  birthDate?: ProfileField;
  address?: AddressField;
  gender?: ProfileField;
  race?: ProfileField;
  orientation?: ProfileField;
  disability?: ProfileField;
  pronoun?: ProfileField;
};

export type FormField = {
  name: string;
  type: "text" | "textarea" | "file" | "hidden" | "single_select" | "multi_select";
  options: { label: string; value: string; freeForm?: true }[];
};

export type QuestionKind =
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "resume"
  | "cover_letter"
  | "linkedin"
  | "website"
  | "cpf"
  | "birth_date"
  | "cep"
  | "address"
  | "city"
  | "document"
  | "custom";

export type FormQuestion = {
  id: string;
  label: string;
  required: boolean;
  section: "questions" | "location" | "compliance" | "demographic";
  fields: FormField[];
  kind: QuestionKind;
  sensitive: boolean;
};

export type DraftAnswer = {
  questionId: string;
  value: string | string[] | null;
  source: "account" | "profile" | "library" | "resume" | "cover_letter" | null;
  inferred: boolean;
  status: "filled" | "suggested" | "blank" | "not_shared" | "sensitive";
};

export type ConfirmedAnswer = {
  questionId: string;
  value: string | string[] | null;
};

export type AttemptEvidence = {
  fields: { question: string; value: string | string[] | null }[];
  files: string[];
  finalUrl: string | null;
  failedField?: string;
  formErrors?: string[];
};

export type ConfigValue =
  | boolean
  | number
  | string
  | null
  | ConfigValue[]
  | { [key: string]: ConfigValue };

export const taskStatusEnum = pgEnum("task_status", ["todo", "in_progress", "done"]);

export const defaultOrgId = "00000000-0000-0000-0000-000000000001";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

const orgIdColumn = () =>
  uuid("org_id")
    .notNull()
    .default(defaultOrgId)
    .references(() => organizations.id);

export const offboardingCases = pgTable(
  "offboarding_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    name: varchar("name", { length: 255 }).notNull(),
    role: varchar("role", { length: 255 }).notNull(),
    department: varchar("department", { length: 255 }).notNull(),
    deadline: date("deadline").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("offboarding_cases_org_id_idx").on(table.orgId)],
);

export const employeeAccess = pgTable(
  "employee_access",
  {
    caseId: uuid("case_id")
      .primaryKey()
      .references(() => offboardingCases.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }),
    personalEmail: varchar("personal_email", { length: 255 }),
    plan: jsonb("plan").$type<ConfigValue>().notNull(),
    revision: integer("revision").notNull().default(1),
    grantId: uuid("grant_id").notNull().defaultRandom(),
    orgId: orgIdColumn(),
    careerSponsoredUntil: date("career_sponsored_until"),
  },
  (table) => [
    uniqueIndex("employee_access_email_idx").on(sql`lower(${table.email})`),
    index("employee_access_org_id_idx").on(table.orgId),
  ],
);

export const checklistModels = pgTable("checklist_models", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  steps: jsonb("steps").$type<ConfigValue[]>().notNull(),
});

export const employeeStateKind = pgEnum("employee_state_kind", [
  "consent",
  "departure-v1",
  "career",
]);

export const employeeStates = pgTable(
  "employee_states",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => offboardingCases.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    key: employeeStateKind("key").notNull(),
    revision: integer("revision").notNull(),
    value: jsonb("value").$type<ConfigValue>().notNull(),
    orgId: orgIdColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.caseId, table.userId, table.key] }),
    index("employee_states_org_id_idx").on(table.orgId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
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
    checklistStepId: varchar("checklist_step_id", { length: 90 }),
    trackingCode: varchar("tracking_code", { length: 30 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("tasks_org_id_idx").on(table.orgId)],
);

export const subtasks = pgTable(
  "subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("subtasks_task_id_idx").on(table.taskId),
    index("subtasks_org_id_idx").on(table.orgId),
  ],
);

export const exitSurveys = pgTable(
  "exit_surveys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
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
    index("exit_surveys_org_id_idx").on(table.orgId),
    check("exit_surveys_nps_score_range", sql`${table.npsScore} between 0 and 10`),
  ],
);

export const talentProfiles = pgTable(
  "talent_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    caseId: uuid("case_id")
      .unique()
      .references(() => offboardingCases.id, { onDelete: "set null" }),
    personalEmail: varchar("personal_email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sponsoredUntil: date("sponsored_until").notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at"),
    firstSignedInAt: timestamp("first_signed_in_at"),
    shareOutcomeWithHr: boolean("share_outcome_with_hr").notNull().default(false),
    aiApplyConsentAt: timestamp("ai_apply_consent_at"),
    aiApplyConsentVersion: varchar("ai_apply_consent_version", { length: 20 }),
    searchableAt: timestamp("searchable_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("talent_profiles_org_id_idx").on(table.orgId),
    uniqueIndex("talent_profiles_email_lower_idx").on(sql`lower(${table.personalEmail})`),
  ],
);

export const talentSubscriptionStatusEnum = pgEnum("talent_subscription_status", [
  "pending",
  "active",
  "past_due",
  "canceled",
]);

export const talentSubscriptions = pgTable("talent_subscriptions", {
  profileId: uuid("profile_id")
    .primaryKey()
    .references(() => talentProfiles.id, { onDelete: "cascade" }),
  plan: varchar("plan", { length: 50 }).notNull().default("carreira-pro"),
  status: talentSubscriptionStatusEnum("status").notNull().default("pending"),
  providerSubscriptionId: varchar("provider_subscription_id", { length: 255 }),
  currentPeriodEnd: date("current_period_end"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const billingWebhookEvents = pgTable("billing_webhook_events", {
  id: varchar("id", { length: 255 }).primaryKey(),
  receivedAt: timestamp("received_at").notNull(),
});

export const jobOriginEnum = pgEnum("job_origin", ["external", "hr", "recruiter"]);

export const jobWorkModelEnum = pgEnum("job_work_model", ["remote", "hybrid", "onsite"]);

export const jobSourceKindEnum = pgEnum("job_source_kind", ["greenhouse", "lever"]);

export const jobSources = pgTable(
  "job_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: jobSourceKindEnum("kind").notNull(),
    target: varchar("target", { length: 100 }).notNull(),
    label: varchar("label", { length: 255 }),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at"),
    lastError: varchar("last_error", { length: 100 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("job_sources_kind_target_idx").on(table.kind, table.target),
    check("job_sources_target_format", sql`${table.target} ~ '^[a-z0-9][a-z0-9_-]{0,99}$'`),
  ],
);

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
    lastSeenAt: timestamp("last_seen_at"),
    embedding: vector("embedding", { dimensions: 1024 }),
    embeddedAt: timestamp("embedded_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("jobs_source_key_idx").on(table.source, table.sourceKey),
    check(
      "jobs_salary_range",
      sql`${table.salaryMinCents} is null or ${table.salaryMaxCents} is null or ${table.salaryMinCents} <= ${table.salaryMaxCents}`,
    ),
    index("jobs_search_idx").using(
      "gin",
      sql`to_tsvector('portuguese', ${table.title} || ' ' || ${table.description})`,
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

export const applicationChannelEnum = pgEnum("application_channel", ["manual", "ai_apply"]);

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
    resumeId: uuid("resume_id").references(() => resumes.id, {
      onDelete: "set null",
    }),
    publicToken: varchar("public_token", { length: 64 }),
    channel: applicationChannelEnum("channel").notNull().default("manual"),
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
    index("applications_resume_id_idx").on(table.resumeId),
    uniqueIndex("applications_public_token_idx").on(table.publicToken),
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
  organization: one(organizations, {
    fields: [offboardingCases.orgId],
    references: [organizations.id],
  }),
  talentProfile: one(talentProfiles),
}));

export const talentProfilesRelations = relations(talentProfiles, ({ one }) => ({
  case: one(offboardingCases, {
    fields: [talentProfiles.caseId],
    references: [offboardingCases.id],
  }),
  organization: one(organizations, {
    fields: [talentProfiles.orgId],
    references: [organizations.id],
  }),
  benefitAssignment: one(benefitAssignments),
}));

export const exitSurveysRelations = relations(exitSurveys, ({ one }) => ({
  organization: one(organizations, {
    fields: [exitSurveys.orgId],
    references: [organizations.id],
  }),
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
  organization: one(organizations, {
    fields: [tasks.orgId],
    references: [organizations.id],
  }),
}));

export const subtasksRelations = relations(subtasks, ({ one }) => ({
  organization: one(organizations, {
    fields: [subtasks.orgId],
    references: [organizations.id],
  }),
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
    orgId: orgIdColumn(),
    caseId: uuid("case_id").references(() => offboardingCases.id, { onDelete: "cascade" }),
    holderEmail: varchar("holder_email", { length: 255 }),
    item: varchar("item", { length: 255 }).notNull(),
    tag: varchar("tag", { length: 255 }).notNull(),
    fromEmployeePlan: boolean("from_employee_plan").notNull().default(false),
    returnMethod: equipmentReturnMethodEnum("return_method").notNull(),
    scheduledDate: date("scheduled_date"),
    status: equipmentStatusEnum("status").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("equipment_case_id_idx").on(table.caseId),
    index("equipment_org_id_idx").on(table.orgId),
    index("equipment_holder_email_idx").on(table.orgId, sql`lower(${table.holderEmail})`),
    uniqueIndex("equipment_org_tag_idx").on(table.orgId, table.tag),
  ],
);

export const equipmentRelations = relations(equipment, ({ one }) => ({
  organization: one(organizations, {
    fields: [equipment.orgId],
    references: [organizations.id],
  }),
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
    orgId: orgIdColumn(),
    name: varchar("name", { length: 255 }).notNull(),
    status: connectionStatusEnum("status").notNull().default("disconnected"),
    config: jsonb("config").$type<Record<string, ConfigValue>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("integrations_org_name_idx").on(table.orgId, table.name),
    index("integrations_org_id_idx").on(table.orgId),
  ],
);

export const memberRoleEnum = pgEnum("member_role", ["admin", "rh", "gestor", "visualizador"]);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    role: memberRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("team_members_email_lower_idx").on(sql`lower(${table.email})`),
    index("team_members_org_id_idx").on(table.orgId),
  ],
);

export const actionConfigs = pgTable(
  "action_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    actionId: varchar("action_id", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, ConfigValue>>().notNull().default({}),
    phase: varchar("phase", { length: 50 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("action_configs_org_action_id_idx").on(table.orgId, table.actionId),
    index("action_configs_org_id_idx").on(table.orgId),
  ],
);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "trialing",
  "pending",
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
  perPersonPriceCents: integer("per_person_price_cents").notNull().default(0),
  aiApplyDailyLimit: integer("ai_apply_daily_limit").notNull().default(0),
  aiApplyPriority: boolean("ai_apply_priority").notNull().default(false),
  detailedScore: boolean("detailed_score").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    currentPeriodStart: date("current_period_start").notNull(),
    currentPeriodEnd: date("current_period_end").notNull(),
    checkoutId: varchar("checkout_id", { length: 255 }),
    checkoutUrl: text("checkout_url"),
    providerSubscriptionId: varchar("provider_subscription_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("subscriptions_org_id_idx").on(table.orgId)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
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
    index("invoices_org_id_idx").on(table.orgId),
    index("invoices_abacatepay_billing_id_idx").on(table.abacatepayBillingId),
  ],
);

export const plansRelations = relations(plans, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  plan: one(plans, {
    fields: [subscriptions.planId],
    references: [plans.id],
  }),
  invoices: many(invoices),
  organization: one(organizations, {
    fields: [subscriptions.orgId],
    references: [organizations.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organizations, {
    fields: [invoices.orgId],
    references: [organizations.id],
  }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const benefitAssignmentSourceEnum = pgEnum("benefit_assignment_source", [
  "default",
  "rule",
  "manual",
]);

export const benefitPolicies = pgTable("benefit_policies", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  defaultPlanId: uuid("default_plan_id").references(() => plans.id),
  benefitDurationMonths: integer("benefit_duration_months").notNull().default(6),
  rules: jsonb("rules").$type<BenefitPolicyRule[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const benefitAssignments = pgTable(
  "benefit_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    assignedPlanId: uuid("assigned_plan_id")
      .notNull()
      .references(() => plans.id),
    effectivePlanId: uuid("effective_plan_id")
      .notNull()
      .references(() => plans.id),
    source: benefitAssignmentSourceEnum("source").notNull(),
    validUntil: date("valid_until").notNull(),
    copaySubscriptionId: varchar("copay_subscription_id", { length: 255 }),
    graceUntil: date("grace_until"),
    copayCheckoutAt: timestamp("copay_checkout_at"),
    copayCheckoutId: varchar("copay_checkout_id", { length: 255 }),
    copayCheckoutUrl: text("copay_checkout_url"),
    copayPriceCents: integer("copay_price_cents"),
    copayPeriodEnd: date("copay_period_end"),
    copayPaymentFailedAt: timestamp("copay_payment_failed_at"),
    copayTargetPlanId: uuid("copay_target_plan_id").references(() => plans.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("benefit_assignments_profile_id_idx").on(table.profileId),
    index("benefit_assignments_org_id_idx").on(table.orgId),
  ],
);

export const benefitInvoiceStatusEnum = pgEnum("benefit_invoice_status", ["draft", "sent"]);

export const copayProducts = pgTable(
  "copay_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromPlanId: uuid("from_plan_id")
      .notNull()
      .references(() => plans.id),
    toPlanId: uuid("to_plan_id")
      .notNull()
      .references(() => plans.id),
    abacatePayProductId: varchar("abacatepay_product_id", { length: 255 }).notNull(),
  },
  (table) => [unique("copay_products_pair_idx").on(table.fromPlanId, table.toPlanId)],
);

export const benefitInvoices = pgTable(
  "benefit_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgIdColumn(),
    period: varchar("period", { length: 7 }).notNull(),
    totalCents: integer("total_cents").notNull().default(0),
    status: benefitInvoiceStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [unique("benefit_invoices_org_period_idx").on(table.orgId, table.period)],
);

export const copayProductsRelations = relations(copayProducts, ({ one }) => ({
  fromPlan: one(plans, { fields: [copayProducts.fromPlanId], references: [plans.id] }),
  toPlan: one(plans, { fields: [copayProducts.toPlanId], references: [plans.id] }),
}));

export const benefitInvoicesRelations = relations(benefitInvoices, ({ one }) => ({
  organization: one(organizations, {
    fields: [benefitInvoices.orgId],
    references: [organizations.id],
  }),
}));

export const benefitPoliciesRelations = relations(benefitPolicies, ({ one }) => ({
  organization: one(organizations, {
    fields: [benefitPolicies.orgId],
    references: [organizations.id],
  }),
  defaultPlan: one(plans, {
    fields: [benefitPolicies.defaultPlanId],
    references: [plans.id],
  }),
}));

export const benefitAssignmentsRelations = relations(benefitAssignments, ({ one }) => ({
  organization: one(organizations, {
    fields: [benefitAssignments.orgId],
    references: [organizations.id],
  }),
  profile: one(talentProfiles, {
    fields: [benefitAssignments.profileId],
    references: [talentProfiles.id],
  }),
  assignedPlan: one(plans, {
    fields: [benefitAssignments.assignedPlanId],
    references: [plans.id],
  }),
  effectivePlan: one(plans, {
    fields: [benefitAssignments.effectivePlanId],
    references: [plans.id],
  }),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  cases: many(offboardingCases),
  tasks: many(tasks),
  subtasks: many(subtasks),
  exitSurveys: many(exitSurveys),
  equipment: many(equipment),
  teamMembers: many(teamMembers),
  integrations: many(integrations),
  actionConfigs: many(actionConfigs),
  subscriptions: many(subscriptions),
  invoices: many(invoices),
  employeeAccess: many(employeeAccess),
  employeeStates: many(employeeStates),
  talentProfiles: many(talentProfiles),
  benefitPolicy: one(benefitPolicies),
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
    scoreBreakdown: jsonb("score_breakdown").$type<ResumeScoreBreakdown>(),
    matchScore: integer("match_score"),
    sourceFileKey: varchar("source_file_key", { length: 512 }),
    embedding: vector("embedding", { dimensions: 1024 }),
    embeddedHash: varchar("embedded_hash", { length: 64 }),
    profileEmbedding: vector("profile_embedding", { dimensions: 1024 }),
    profileEmbeddedHash: varchar("profile_embedded_hash", { length: 64 }),
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
    check(
      "resumes_match_score_range",
      sql`${table.matchScore} is null or ${table.matchScore} between 0 and 100`,
    ),
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
    extraGainWithFacts: integer("extra_gain_with_facts").notNull().default(0),
    criterion: varchar("criterion", { length: 30 }),
    status: resumeSuggestionStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("resume_suggestions_resume_idx").on(table.resumeId),
    check("resume_suggestions_gain", sql`${table.estimatedGain} between 0 and 20`),
    check("resume_suggestions_extra_gain", sql`${table.extraGainWithFacts} between 0 and 20`),
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

export const jobMatches = pgTable(
  "job_matches",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    resumeUpdatedAt: timestamp("resume_updated_at").notNull(),
    computedAt: timestamp("computed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.jobId] }),
    index("job_matches_job_idx").on(table.jobId),
    check("job_matches_score_range", sql`${table.score} between 0 and 100`),
  ],
);

export const publicPages = pgTable(
  "public_pages",
  {
    profileId: uuid("profile_id")
      .primaryKey()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 40 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    resumeId: uuid("resume_id").references(() => resumes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("public_pages_slug_idx").on(table.slug),
    check(
      "public_pages_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) between 3 and 40`,
    ),
  ],
);

export const publicPageDailyViews = pgTable(
  "public_page_daily_views",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    visits: integer("visits").notNull().default(0),
    recruiterVisits: integer("recruiter_visits").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.day] }),
    check(
      "public_page_daily_views_counts",
      sql`${table.visits} >= 0 and ${table.recruiterVisits} >= 0 and ${table.recruiterVisits} <= ${table.visits}`,
    ),
  ],
);

export const applicationModeEnum = pgEnum("application_mode", ["automatic", "hybrid", "review"]);

export const talentPreferences = pgTable(
  "talent_preferences",
  {
    profileId: uuid("profile_id")
      .primaryKey()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    mode: applicationModeEnum("mode").notNull().default("review"),
    hybridThreshold: integer("hybrid_threshold").notNull().default(75),
    targetTitles: jsonb("target_titles").$type<string[]>().notNull().default([]),
    jobPreferences: jsonb("job_preferences").$type<JobPreferences>().notNull().default({}),
    profileFields: jsonb("profile_fields").$type<ProfileFields>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    check("talent_preferences_threshold", sql`${table.hybridThreshold} between 50 and 100`),
  ],
);

export const answerQuestions = pgTable(
  "answer_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    normalized: varchar("normalized", { length: 500 }).notNull(),
    text: varchar("text", { length: 500 }).notNull(),
    common: boolean("common").notNull().default(false),
    sensitive: boolean("sensitive").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [uniqueIndex("answer_questions_normalized_idx").on(table.normalized)],
);

export const talentAnswers = pgTable(
  "talent_answers",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => answerQuestions.id, { onDelete: "cascade" }),
    answer: text("answer").notNull(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.questionId] }),
    index("talent_answers_question_idx").on(table.questionId),
  ],
);

export const rejectionReasonEnum = pgEnum("rejection_reason", [
  "salary",
  "location",
  "company",
  "seniority",
  "work_model",
  "not_interested",
  "other",
]);

export const jobRejections = pgTable(
  "job_rejections",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    reason: rejectionReasonEnum("reason").notNull(),
    note: varchar("note", { length: 500 }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.jobId] }),
    index("job_rejections_job_idx").on(table.jobId),
  ],
);

export const aiApplicationStateEnum = pgEnum("ai_application_state", [
  "draft",
  "queued",
  "running",
  "submitting",
  "submitted",
  "rehearsed",
  "assisted",
  "needs_check",
  "cancelled",
]);

export const aiApplications = pgTable(
  "ai_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    state: aiApplicationStateEnum("state").notNull().default("draft"),
    reason: varchar("reason", { length: 50 }),
    form: jsonb("form").$type<{ questions: FormQuestion[] }>().notNull(),
    draft: jsonb("draft").$type<DraftAnswer[]>().notNull(),
    confirmed: jsonb("confirmed").$type<ConfirmedAnswer[]>(),
    rehearsal: boolean("rehearsal").notNull().default(false),
    resumeId: uuid("resume_id").references(() => resumes.id, {
      onDelete: "set null",
    }),
    evidence: jsonb("evidence").$type<AttemptEvidence>(),
    screenshotKey: varchar("screenshot_key", { length: 512 }),
    liveUrl: varchar("live_url", { length: 2048 }),
    preparedAt: timestamp("prepared_at").notNull(),
    confirmedAt: timestamp("confirmed_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_applications_active_idx")
      .on(table.profileId, table.jobId)
      .where(sql`${table.state} in ('draft', 'queued', 'running', 'submitting', 'needs_check')`),
    index("ai_applications_profile_created_idx").on(table.profileId, table.createdAt),
  ],
);

export const applicationPackages = pgTable(
  "application_packages",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    coverLetter: text("cover_letter").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.jobId] }),
    index("application_packages_job_idx").on(table.jobId),
  ],
);

export const demoProfileEmbeddings = pgTable("demo_profile_embeddings", {
  slug: varchar("slug", { length: 80 }).primaryKey(),
  embeddedHash: varchar("embedded_hash", { length: 64 }).notNull(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
});

export const demoSearchUsage = pgTable(
  "demo_search_usage",
  {
    bucket: varchar("bucket", { length: 80 }).notNull(),
    day: date("day").notNull(),
    searches: integer("searches").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.day] })],
);

export const candidateContactRequests = pgTable("candidate_contact_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  resumeId: uuid("resume_id")
    .notNull()
    .references(() => resumes.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  company: varchar("company", { length: 120 }),
  message: text("message").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at"),
});
