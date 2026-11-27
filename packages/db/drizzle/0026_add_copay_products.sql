CREATE TYPE "public"."benefit_invoice_status" AS ENUM('draft', 'sent');--> statement-breakpoint
CREATE TABLE "benefit_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"period" varchar(7) NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"status" "benefit_invoice_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "benefit_invoices_org_period_idx" UNIQUE("org_id","period")
);
--> statement-breakpoint
CREATE TABLE "copay_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_plan_id" uuid NOT NULL,
	"to_plan_id" uuid NOT NULL,
	"abacatepay_product_id" varchar(255) NOT NULL,
	CONSTRAINT "copay_products_pair_idx" UNIQUE("from_plan_id","to_plan_id")
);
--> statement-breakpoint
ALTER TABLE "benefit_invoices" ADD CONSTRAINT "benefit_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copay_products" ADD CONSTRAINT "copay_products_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copay_products" ADD CONSTRAINT "copay_products_to_plan_id_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;