ALTER TYPE "public"."subscription_status" ADD VALUE 'pending';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "checkout_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_subscription_id" varchar(255);
