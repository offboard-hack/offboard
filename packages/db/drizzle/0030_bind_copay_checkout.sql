ALTER TABLE "benefit_assignments" ADD COLUMN "copay_checkout_id" varchar(255);--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_checkout_url" text;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_price_cents" integer;--> statement-breakpoint
ALTER TABLE "benefit_assignments" ADD COLUMN "copay_period_end" date;
