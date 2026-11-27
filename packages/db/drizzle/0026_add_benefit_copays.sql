CREATE TYPE "public"."benefit_copay_status" AS ENUM('pending', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TABLE "benefit_copays" (
	"assignment_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"target_plan_id" uuid NOT NULL,
	"status" "benefit_copay_status" DEFAULT 'pending' NOT NULL,
	"checkout_id" varchar(255),
	"checkout_url" text,
	"provider_subscription_id" varchar(255),
	"current_period_end" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "benefit_copays" ADD CONSTRAINT "benefit_copays_assignment_id_benefit_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."benefit_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_copays" ADD CONSTRAINT "benefit_copays_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_copays" ADD CONSTRAINT "benefit_copays_target_plan_id_plans_id_fk" FOREIGN KEY ("target_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benefit_copays_org_id_idx" ON "benefit_copays" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "benefit_copays_provider_subscription_id_idx" ON "benefit_copays" USING btree ("provider_subscription_id");