CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "organizations" ("id", "name", "slug") VALUES ('00000000-0000-0000-0000-000000000001', 'Default', 'default');--> statement-breakpoint
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_tag_unique";--> statement-breakpoint
ALTER TABLE "action_configs" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_access" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_states" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "exit_surveys" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "subtasks" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "action_configs" ADD CONSTRAINT "action_configs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_access" ADD CONSTRAINT "employee_access_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_states" ADD CONSTRAINT "employee_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_surveys" ADD CONSTRAINT "exit_surveys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_configs_org_action_id_idx" ON "action_configs" USING btree ("org_id","action_id");--> statement-breakpoint
CREATE INDEX "action_configs_org_id_idx" ON "action_configs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "employee_access_org_id_idx" ON "employee_access" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "employee_states_org_id_idx" ON "employee_states" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "equipment_org_id_idx" ON "equipment" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_org_tag_idx" ON "equipment" USING btree ("org_id","tag");--> statement-breakpoint
CREATE INDEX "exit_surveys_org_id_idx" ON "exit_surveys" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_name_idx" ON "integrations" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "integrations_org_id_idx" ON "integrations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invoices_org_id_idx" ON "invoices" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "offboarding_cases_org_id_idx" ON "offboarding_cases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subscriptions_org_id_idx" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "subtasks_org_id_idx" ON "subtasks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tasks_org_id_idx" ON "tasks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "team_members_org_id_idx" ON "team_members" USING btree ("org_id");