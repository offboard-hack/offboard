DO $$
BEGIN
	IF to_regclass('public.employee_access') IS NULL THEN
		CREATE TYPE "public"."employee_state_kind" AS ENUM('consent', 'departure-v1', 'career');
		CREATE TABLE "employee_access" (
			"case_id" uuid PRIMARY KEY NOT NULL,
			"email" varchar(255),
			"plan" jsonb NOT NULL
		);

		CREATE TABLE "employee_states" (
			"case_id" uuid NOT NULL,
			"user_id" text NOT NULL,
			"key" "employee_state_kind" NOT NULL,
			"revision" integer NOT NULL,
			"value" jsonb NOT NULL,
			CONSTRAINT "employee_states_case_id_user_id_key_pk" PRIMARY KEY("case_id","user_id","key")
		);

		ALTER TABLE "auth_session" ALTER COLUMN "member_id" DROP NOT NULL;
		ALTER TABLE "auth_session" ADD COLUMN "employee_case_id" uuid;
		ALTER TABLE "employee_access" ADD CONSTRAINT "employee_access_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE cascade ON UPDATE no action;
		ALTER TABLE "employee_states" ADD CONSTRAINT "employee_states_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE cascade ON UPDATE no action;
		ALTER TABLE "employee_states" ADD CONSTRAINT "employee_states_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;
		CREATE UNIQUE INDEX "employee_access_email_idx" ON "employee_access" USING btree (lower("email"));
		ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_one_audience" CHECK (num_nonnulls("auth_session"."member_id", "auth_session"."employee_case_id") = 1);
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "employee_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_access" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_access" ADD COLUMN "grant_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_session_employee_case_id_idx" ON "auth_session" USING btree ("employee_case_id");--> statement-breakpoint
DELETE FROM "auth_session" WHERE "employee_case_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_employee_grant" CHECK (("auth_session"."employee_case_id" is null) = ("auth_session"."employee_grant_id" is null));
