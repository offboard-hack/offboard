CREATE TYPE "public"."equipment_return_method" AS ENUM('pickup', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('with_person', 'scheduled', 'transit', 'received', 'inventory', 'failed');--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"item" varchar(255) NOT NULL,
	"tag" varchar(50) NOT NULL,
	"return_method" "equipment_return_method" NOT NULL,
	"scheduled_date" date,
	"status" "equipment_status" NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "equipment_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_case_id_idx" ON "equipment" USING btree ("case_id");