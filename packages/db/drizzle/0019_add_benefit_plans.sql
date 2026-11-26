CREATE TYPE "public"."benefit_assignment_source" AS ENUM('default', 'rule', 'manual');--> statement-breakpoint
CREATE TABLE "benefit_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"profile_id" uuid NOT NULL,
	"assigned_plan_id" uuid NOT NULL,
	"effective_plan_id" uuid NOT NULL,
	"source" "benefit_assignment_source" NOT NULL,
	"valid_until" date NOT NULL,
	"copay_subscription_id" varchar(255),
	"grace_until" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benefit_policies" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"default_plan_id" uuid,
	"benefit_duration_months" integer DEFAULT 6 NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "per_person_price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "ai_apply_daily_limit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "ai_apply_priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "detailed_score" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_assigned_plan_id_plans_id_fk" FOREIGN KEY ("assigned_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_effective_plan_id_plans_id_fk" FOREIGN KEY ("effective_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_policies" ADD CONSTRAINT "benefit_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_policies" ADD CONSTRAINT "benefit_policies_default_plan_id_plans_id_fk" FOREIGN KEY ("default_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_assignments_profile_id_idx" ON "benefit_assignments" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "benefit_assignments_org_id_idx" ON "benefit_assignments" USING btree ("org_id");