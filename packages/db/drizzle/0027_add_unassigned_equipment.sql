ALTER TABLE "equipment" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_access" ADD COLUMN "personal_email" varchar(255);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "holder_email" varchar(255);--> statement-breakpoint
CREATE INDEX "equipment_holder_email_idx" ON "equipment" USING btree ("org_id",lower("holder_email"));