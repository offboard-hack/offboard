DROP INDEX "integrations_name_idx";--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;