CREATE TYPE "public"."application_closed_reason" AS ENUM('rejected', 'withdrawn', 'hired');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('sent', 'in_review', 'interview', 'offer', 'closed');--> statement-breakpoint
CREATE TYPE "public"."interview_mode" AS ENUM('video', 'in_person', 'phone');--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"status" "application_status" NOT NULL,
	"closed_reason" "application_closed_reason",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
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
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_application_id_idx" ON "application_events" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_profile_job_idx" ON "applications" USING btree ("profile_id","job_id");--> statement-breakpoint
CREATE INDEX "applications_profile_id_idx" ON "applications" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "interviews_application_id_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "interviews_starts_at_idx" ON "interviews" USING btree ("starts_at");
