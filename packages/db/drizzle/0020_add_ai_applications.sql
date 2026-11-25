CREATE TYPE "public"."ai_application_state" AS ENUM('draft', 'queued', 'running', 'submitting', 'submitted', 'rehearsed', 'assisted', 'needs_check', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."application_channel" AS ENUM('manual', 'ai_apply');
--> statement-breakpoint
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
ALTER TABLE "applications" ADD COLUMN "channel" "application_channel" DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "ai_apply_consent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD COLUMN "ai_apply_consent_version" varchar(20);
--> statement-breakpoint
ALTER TABLE "ai_applications" ADD CONSTRAINT "ai_applications_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_applications" ADD CONSTRAINT "ai_applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_applications" ADD CONSTRAINT "ai_applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_applications_active_idx" ON "ai_applications" USING btree ("profile_id","job_id") WHERE "ai_applications"."state" in ('draft', 'queued', 'running', 'submitting', 'needs_check');
--> statement-breakpoint
CREATE INDEX "ai_applications_profile_created_idx" ON "ai_applications" USING btree ("profile_id","created_at");
