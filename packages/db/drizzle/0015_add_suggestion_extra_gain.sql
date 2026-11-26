ALTER TABLE "resume_suggestions" ADD COLUMN "extra_gain_with_facts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_suggestions" DROP CONSTRAINT "resume_suggestions_gain";--> statement-breakpoint
ALTER TABLE "resume_suggestions" ADD CONSTRAINT "resume_suggestions_gain" CHECK ("resume_suggestions"."estimated_gain" between 0 and 20);--> statement-breakpoint
ALTER TABLE "resume_suggestions" ADD CONSTRAINT "resume_suggestions_extra_gain" CHECK ("resume_suggestions"."extra_gain_with_facts" between 0 and 20);
