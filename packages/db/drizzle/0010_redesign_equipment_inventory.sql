ALTER TYPE "public"."equipment_return_method" ADD VALUE IF NOT EXISTS 'correios';--> statement-breakpoint
ALTER TYPE "public"."equipment_status" RENAME TO "equipment_status_old";--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('in_use', 'pending_return', 'in_transit', 'received', 'in_inventory', 'decommissioned');--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "status" TYPE "public"."equipment_status" USING (
	CASE "status"::text
		WHEN 'with_person' THEN 'in_use'
		WHEN 'scheduled' THEN 'pending_return'
		WHEN 'transit' THEN 'in_transit'
		WHEN 'received' THEN 'received'
		WHEN 'inventory' THEN 'in_inventory'
		WHEN 'failed' THEN 'pending_return'
	END
)::"public"."equipment_status";--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "status" SET DEFAULT 'in_inventory';--> statement-breakpoint
DROP TYPE "public"."equipment_status_old";--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "serial_number" varchar(100);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "assigned_to" varchar(255);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "assigned_email" varchar(255);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "tracking_code" varchar(100);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "notes" text;--> statement-breakpoint
UPDATE "equipment" SET "assigned_to" = "offboarding_cases"."name" FROM "offboarding_cases" WHERE "offboarding_cases"."id" = "equipment"."case_id";--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "return_method" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_case_id_offboarding_cases_id_fk";--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_task_id_idx" ON "equipment" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "equipment_status_idx" ON "equipment" USING btree ("status");
