CREATE TYPE "public"."ai_application_state" AS ENUM('draft', 'queued', 'running', 'submitting', 'submitted', 'rehearsed', 'assisted', 'needs_check', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."application_channel" AS ENUM('manual', 'ai_apply');--> statement-breakpoint
CREATE TYPE "public"."application_closed_reason" AS ENUM('rejected', 'withdrawn', 'hired');--> statement-breakpoint
CREATE TYPE "public"."application_mode" AS ENUM('automatic', 'hybrid', 'review');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('sent', 'in_review', 'interview', 'offer', 'closed');--> statement-breakpoint
CREATE TYPE "public"."background_job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('video', 'in_person', 'phone');--> statement-breakpoint
CREATE TYPE "public"."job_origin" AS ENUM('external', 'hr', 'recruiter');--> statement-breakpoint
CREATE TYPE "public"."job_source_kind" AS ENUM('greenhouse', 'lever');--> statement-breakpoint
CREATE TYPE "public"."job_work_model" AS ENUM('remote', 'hybrid', 'onsite');--> statement-breakpoint
CREATE TYPE "public"."rejection_reason" AS ENUM('salary', 'location', 'company', 'seniority', 'work_model', 'not_interested', 'other');--> statement-breakpoint
CREATE TYPE "public"."resume_kind" AS ENUM('base', 'tailored');--> statement-breakpoint
CREATE TYPE "public"."resume_status" AS ENUM('draft', 'ready');--> statement-breakpoint
CREATE TYPE "public"."resume_suggestion_status" AS ENUM('open', 'applied', 'dismissed');--> statement-breakpoint
CREATE TABLE "ai_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"state" "ai_application_state" DEFAULT 'draft' NOT NULL,
	"reason" varchar(50),
	"form" jsonb NOT NULL,
	"draft" jsonb NOT NULL,
	"confirmed" jsonb,
	"rehearsal" boolean DEFAULT false NOT NULL,
	"resume_id" uuid,
	"evidence" jsonb,
	"screenshot_key" varchar(512),
	"prepared_at" timestamp NOT NULL,
	"confirmed_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "answer_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized" varchar(500) NOT NULL,
	"text" varchar(500) NOT NULL,
	"common" boolean DEFAULT false NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"status" "application_status" NOT NULL,
	"closed_reason" "application_closed_reason",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_packages" (
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"cover_letter" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "application_packages_profile_id_job_id_pk" PRIMARY KEY("profile_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"resume_id" uuid,
	"public_token" varchar(64),
	"channel" "application_channel" DEFAULT 'manual' NOT NULL,
	"status" "application_status" DEFAULT 'sent' NOT NULL,
	"furthest_stage" "application_status" DEFAULT 'sent' NOT NULL,
	"closed_reason" "application_closed_reason",
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"status_changed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "applications_closed_reason" CHECK (("applications"."status" = 'closed') = ("applications"."closed_reason" is not null)),
	CONSTRAINT "applications_furthest_stage" CHECK ("applications"."furthest_stage" <> 'closed')
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(50) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "background_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp NOT NULL,
	"locked_until" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"mode" "interview_mode" NOT NULL,
	"with_whom" varchar(255) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_matches" (
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_updated_at" timestamp NOT NULL,
	"computed_at" timestamp NOT NULL,
	CONSTRAINT "job_matches_profile_id_job_id_pk" PRIMARY KEY("profile_id","job_id"),
	CONSTRAINT "job_matches_score_range" CHECK ("job_matches"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "job_rejections" (
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"reason" "rejection_reason" NOT NULL,
	"note" varchar(500),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "job_rejections_profile_id_job_id_pk" PRIMARY KEY("profile_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "job_source_kind" NOT NULL,
	"target" varchar(100) NOT NULL,
	"label" varchar(255),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"last_error" varchar(100),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "job_sources_target_format" CHECK ("job_sources"."target" ~ '^[a-z0-9][a-z0-9_-]{0,99}$')
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" "job_origin" NOT NULL,
	"source" varchar(50) NOT NULL,
	"source_key" varchar(2048) NOT NULL,
	"title" varchar(255) NOT NULL,
	"company" varchar(255) NOT NULL,
	"work_model" "job_work_model",
	"city" varchar(255),
	"state" varchar(2),
	"salary_min_cents" integer,
	"salary_max_cents" integer,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"posted_at" timestamp,
	"closed_at" timestamp,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "jobs_salary_range" CHECK ("jobs"."salary_min_cents" is null or "jobs"."salary_max_cents" is null or "jobs"."salary_min_cents" <= "jobs"."salary_max_cents")
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"profile_id" uuid NOT NULL,
	"day" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "llm_usage_profile_id_day_pk" PRIMARY KEY("profile_id","day")
);
--> statement-breakpoint
CREATE TABLE "public_page_daily_views" (
	"profile_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"recruiter_visits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "public_page_daily_views_profile_id_day_pk" PRIMARY KEY("profile_id","day"),
	CONSTRAINT "public_page_daily_views_counts" CHECK ("public_page_daily_views"."visits" >= 0 and "public_page_daily_views"."recruiter_visits" >= 0 and "public_page_daily_views"."recruiter_visits" <= "public_page_daily_views"."visits")
);
--> statement-breakpoint
CREATE TABLE "public_pages" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"resume_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "public_pages_slug_format" CHECK ("public_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("public_pages"."slug") between 3 and 40)
);
--> statement-breakpoint
CREATE TABLE "resume_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"target_node_id" varchar(64) NOT NULL,
	"original_text" text NOT NULL,
	"suggested_text" text NOT NULL,
	"rationale" text NOT NULL,
	"estimated_gain" integer NOT NULL,
	"status" "resume_suggestion_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "resume_suggestions_gain" CHECK ("resume_suggestions"."estimated_gain" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "resume_kind" NOT NULL,
	"status" "resume_status" DEFAULT 'ready' NOT NULL,
	"job_id" uuid,
	"content" jsonb NOT NULL,
	"score" integer,
	"scored_at" timestamp,
	"match_score" integer,
	"source_file_key" varchar(512),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "resumes_kind_job" CHECK (("resumes"."kind" = 'base') = ("resumes"."job_id" is null)),
	CONSTRAINT "resumes_base_ready" CHECK ("resumes"."kind" <> 'base' or "resumes"."status" = 'ready'),
	CONSTRAINT "resumes_score_range" CHECK ("resumes"."score" is null or "resumes"."score" between 0 and 100),
	CONSTRAINT "resumes_match_score_range" CHECK ("resumes"."match_score" is null or "resumes"."match_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "talent_answers" (
	"profile_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "talent_answers_profile_id_question_id_pk" PRIMARY KEY("profile_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "talent_preferences" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"mode" "application_mode" DEFAULT 'review' NOT NULL,
	"hybrid_threshold" integer DEFAULT 75 NOT NULL,
	"target_titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"profile_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "talent_preferences_threshold" CHECK ("talent_preferences"."hybrid_threshold" between 50 and 100)
);
--> statement-breakpoint
CREATE TABLE "talent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid,
	"personal_email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"sponsored_until" date NOT NULL,
	"terms_accepted_at" timestamp,
	"first_signed_in_at" timestamp,
	"share_outcome_with_hr" boolean DEFAULT false NOT NULL,
	"ai_apply_consent_at" timestamp,
	"ai_apply_consent_version" varchar(20),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "talent_profiles_case_id_unique" UNIQUE("case_id")
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "talent_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_session" DROP CONSTRAINT IF EXISTS "auth_session_one_audience";--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_applications" ADD CONSTRAINT "ai_applications_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_applications" ADD CONSTRAINT "ai_applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_applications" ADD CONSTRAINT "ai_applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_packages" ADD CONSTRAINT "application_packages_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_packages" ADD CONSTRAINT "application_packages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_rejections" ADD CONSTRAINT "job_rejections_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_rejections" ADD CONSTRAINT "job_rejections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_page_daily_views" ADD CONSTRAINT "public_page_daily_views_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_pages" ADD CONSTRAINT "public_pages_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_suggestions" ADD CONSTRAINT "resume_suggestions_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_answers" ADD CONSTRAINT "talent_answers_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_answers" ADD CONSTRAINT "talent_answers_question_id_answer_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."answer_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_preferences" ADD CONSTRAINT "talent_preferences_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_applications_active_idx" ON "ai_applications" USING btree ("profile_id","job_id") WHERE "ai_applications"."state" in ('draft', 'queued', 'running', 'submitting', 'needs_check');--> statement-breakpoint
CREATE INDEX "ai_applications_profile_created_idx" ON "ai_applications" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_questions_normalized_idx" ON "answer_questions" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "application_events_application_id_idx" ON "application_events" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_packages_job_idx" ON "application_packages" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_profile_job_idx" ON "applications" USING btree ("profile_id","job_id");--> statement-breakpoint
CREATE INDEX "applications_profile_id_idx" ON "applications" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "applications_resume_id_idx" ON "applications" USING btree ("resume_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_public_token_idx" ON "applications" USING btree ("public_token");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_pending_idx" ON "background_jobs" USING btree ("kind","subject") WHERE "background_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "interviews_application_id_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "interviews_starts_at_idx" ON "interviews" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "job_matches_job_idx" ON "job_matches" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_rejections_job_idx" ON "job_rejections" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_kind_target_idx" ON "job_sources" USING btree ("kind","target");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_key_idx" ON "jobs" USING btree ("source","source_key");--> statement-breakpoint
CREATE INDEX "jobs_search_idx" ON "jobs" USING gin (to_tsvector('portuguese', "title" || ' ' || "description"));--> statement-breakpoint
CREATE UNIQUE INDEX "public_pages_slug_idx" ON "public_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "resume_suggestions_resume_idx" ON "resume_suggestions" USING btree ("resume_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_one_base_idx" ON "resumes" USING btree ("profile_id") WHERE "resumes"."kind" = 'base';--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_profile_job_idx" ON "resumes" USING btree ("profile_id","job_id") WHERE "resumes"."kind" = 'tailored';--> statement-breakpoint
CREATE INDEX "talent_answers_question_idx" ON "talent_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "talent_profiles_org_id_idx" ON "talent_profiles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_profiles_email_lower_idx" ON "talent_profiles" USING btree (lower("personal_email"));--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_one_audience" CHECK (num_nonnulls("auth_session"."member_id", "auth_session"."employee_case_id", "auth_session"."talent_profile_id") = 1);--> statement-breakpoint
INSERT INTO "answer_questions" ("normalized", "text", "common", "sensitive") VALUES
	('qual a sua pretensao salarial', 'Qual a sua pretensão salarial?', true, false),
	('qual a sua disponibilidade para inicio', 'Qual a sua disponibilidade para início?', true, false),
	('qual o seu aviso previo', 'Qual o seu aviso prévio?', true, false),
	('voce se autodeclara pessoa com deficiencia (pcd)', 'Você se autodeclara pessoa com deficiência (PcD)?', true, true),
	('como voce soube da vaga', 'Como você soube da vaga?', true, false),
	('voce tem disponibilidade para viagens', 'Você tem disponibilidade para viagens?', true, false),
	('voce aceita trabalhar no modelo presencial', 'Você aceita trabalhar no modelo presencial?', true, false),
	('voce possui cnh', 'Você possui CNH?', true, false),
	('qual o seu nivel de ingles', 'Qual o seu nível de inglês?', true, false),
	('qual o link do seu linkedin', 'Qual o link do seu LinkedIn?', true, false)
ON CONFLICT ("normalized") DO NOTHING;
