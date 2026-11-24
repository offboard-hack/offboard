CREATE TABLE "job_matches" (
	"profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_updated_at" timestamp NOT NULL,
	"computed_at" timestamp NOT NULL,
	CONSTRAINT "job_matches_profile_id_job_id_pk" PRIMARY KEY("profile_id","job_id"),
	CONSTRAINT "job_matches_score_range" CHECK ("job_matches"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_matches_job_idx" ON "job_matches" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_search_idx" ON "jobs" USING gin (to_tsvector('portuguese', "title" || ' ' || "description"));
