CREATE TYPE "public"."job_source_kind" AS ENUM('greenhouse', 'lever');--> statement-breakpoint
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
ALTER TABLE "jobs" ADD COLUMN "last_seen_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_kind_target_idx" ON "job_sources" USING btree ("kind","target");--> statement-breakpoint
UPDATE "jobs" SET "closed_at" = now(), "updated_at" = now() WHERE "origin" IN ('hr', 'recruiter') AND "closed_at" IS NULL;
