CREATE TYPE "public"."job_origin" AS ENUM('external', 'hr', 'recruiter');--> statement-breakpoint
CREATE TYPE "public"."job_work_model" AS ENUM('remote', 'hybrid', 'onsite');--> statement-breakpoint
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
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "jobs_salary_range" CHECK ("jobs"."salary_min_cents" is null or "jobs"."salary_max_cents" is null or "jobs"."salary_min_cents" <= "jobs"."salary_max_cents")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_key_idx" ON "jobs" USING btree ("source","source_key");
