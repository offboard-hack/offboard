CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "embedded_at" timestamp;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "embedded_hash" varchar(64);