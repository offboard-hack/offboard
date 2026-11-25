CREATE TYPE "public"."job_feed_provider" AS ENUM('greenhouse', 'lever');--> statement-breakpoint
CREATE TABLE "job_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "job_feed_provider" NOT NULL,
	"board" varchar(100) NOT NULL,
	"company_label" varchar(255),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp,
	"last_error" varchar(100),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "job_feeds_board_format" CHECK ("job_feeds"."board" ~ '^[a-z0-9][a-z0-9_-]{0,99}$')
);
--> statement-breakpoint
CREATE TABLE "recruiter_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"company" varchar(255) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "recruiter_partner_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "last_seen_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "job_feeds_provider_board_idx" ON "job_feeds" USING btree ("provider","board");--> statement-breakpoint
CREATE UNIQUE INDEX "recruiter_partners_token_hash_idx" ON "recruiter_partners" USING btree ("token_hash");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_recruiter_partner_id_recruiter_partners_id_fk" FOREIGN KEY ("recruiter_partner_id") REFERENCES "public"."recruiter_partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_recruiter_partner_id_idx" ON "jobs" USING btree ("recruiter_partner_id");
