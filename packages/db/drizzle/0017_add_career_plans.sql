CREATE TYPE "public"."talent_subscription_status" AS ENUM('pending', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TABLE "talent_subscriptions" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"plan" varchar(50) DEFAULT 'carreira-pro' NOT NULL,
	"status" "talent_subscription_status" DEFAULT 'pending' NOT NULL,
	"provider_subscription_id" varchar(255),
	"current_period_end" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "employee_access" ADD COLUMN "career_sponsored_until" date;--> statement-breakpoint
ALTER TABLE "talent_subscriptions" ADD CONSTRAINT "talent_subscriptions_profile_id_talent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."talent_profiles"("id") ON DELETE cascade ON UPDATE no action;