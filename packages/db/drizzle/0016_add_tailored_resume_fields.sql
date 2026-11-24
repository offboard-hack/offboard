ALTER TABLE "applications" ADD COLUMN "resume_id" uuid;--> statement-breakpoint
ALTER TABLE "resumes" ADD COLUMN "match_score" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_resume_id_idx" ON "applications" USING btree ("resume_id");--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_match_score_range" CHECK ("resumes"."match_score" is null or "resumes"."match_score" between 0 and 100);
