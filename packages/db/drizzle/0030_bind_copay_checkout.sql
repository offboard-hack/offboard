ALTER TABLE "benefit_assignments" ADD COLUMN "copay_checkout_id" varchar(255);--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_checkout_url" text;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_price_cents" integer;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_period_end" date;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_payment_failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_target_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD CONSTRAINT "benefit_assignments_copay_target_plan_id_plans_id_fk" FOREIGN KEY ("copay_target_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "benefit_assignments" SET "copay_checkout_at" = NULL WHERE "copay_subscription_id" IS NOT NULL;
