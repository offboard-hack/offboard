CREATE TYPE "public"."resume_kind" AS ENUM('base', 'tailored');--> statement-breakpoint
CREATE TYPE "public"."resume_status" AS ENUM('draft', 'ready');--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "resume_kind" NOT NULL,
	"status" "resume_status" DEFAULT 'ready' NOT NULL,
	"job_id" uuid,
	"content" jsonb NOT NULL,
	"score" integer,
	"scored_at" timestamp,
	"source_file_key" varchar(512),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "resumes_kind_job" CHECK (("resumes"."kind" = 'base') = ("resumes"."job_id" is null)),
	CONSTRAINT "resumes_base_ready" CHECK ("resumes"."kind" <> 'base' or "resumes"."status" = 'ready'),
	CONSTRAINT "resumes_score_range" CHECK ("resumes"."score" is null or "resumes"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_one_base_idx" ON "resumes" USING btree ("profile_id") WHERE "resumes"."kind" = 'base';--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_profile_job_idx" ON "resumes" USING btree ("profile_id","job_id") WHERE "resumes"."kind" = 'tailored';
