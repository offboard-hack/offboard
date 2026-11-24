CREATE TABLE "talent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"personal_email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"sponsored_until" date NOT NULL,
	"terms_accepted_at" timestamp,
	"first_signed_in_at" timestamp,
	"share_outcome_with_hr" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "talent_profiles_case_id_unique" UNIQUE("case_id")
);
--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "talent_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "talent_profiles" ADD CONSTRAINT "talent_profiles_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_talent_profile_id_talent_profiles_id_fk" FOREIGN KEY ("talent_profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "talent_profiles_email_lower_idx" ON "talent_profiles" USING btree (lower("personal_email"));--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_one_audience" CHECK (num_nonnulls("auth_session"."member_id", "auth_session"."talent_profile_id") = 1);
