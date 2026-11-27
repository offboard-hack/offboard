ALTER TABLE "action_configs" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "employee_access" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "employee_states" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "exit_surveys" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "integrations" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "subtasks" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "team_members" ALTER COLUMN "org_id" DROP DEFAULT;--> statement-breakpoint
DROP INDEX IF EXISTS "integrations_name_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "action_configs_action_id_idx";--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_email_unique";
