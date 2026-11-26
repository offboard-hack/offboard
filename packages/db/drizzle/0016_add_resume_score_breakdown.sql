ALTER TABLE "resumes" ADD COLUMN "score_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "resume_suggestions" ADD COLUMN "criterion" varchar(30);
