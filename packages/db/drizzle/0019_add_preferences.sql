CREATE TYPE "public"."application_mode" AS ENUM('automatic', 'hybrid', 'review');
--> statement-breakpoint
CREATE TYPE "public"."rejection_reason" AS ENUM('salary', 'location', 'company', 'seniority', 'work_model', 'not_interested', 'other');
--> statement-breakpoint
CREATE TABLE "answer_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized" varchar(500) NOT NULL,
	"text" varchar(500) NOT NULL,
	"common" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
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
CREATE TABLE "job_rejections" (
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"reason" "rejection_reason" NOT NULL,
	"note" varchar(500),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "job_rejections_profile_id_job_id_pk" PRIMARY KEY("profile_id","job_id")
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
ALTER TABLE "application_packages" ADD CONSTRAINT "application_packages_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "application_packages" ADD CONSTRAINT "application_packages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_rejections" ADD CONSTRAINT "job_rejections_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_rejections" ADD CONSTRAINT "job_rejections_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "talent_answers" ADD CONSTRAINT "talent_answers_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "talent_answers" ADD CONSTRAINT "talent_answers_question_id_answer_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."answer_questions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "talent_preferences" ADD CONSTRAINT "talent_preferences_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "answer_questions_normalized_idx" ON "answer_questions" USING btree ("normalized");
--> statement-breakpoint
CREATE INDEX "application_packages_job_idx" ON "application_packages" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX "job_rejections_job_idx" ON "job_rejections" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX "talent_answers_question_idx" ON "talent_answers" USING btree ("question_id");
