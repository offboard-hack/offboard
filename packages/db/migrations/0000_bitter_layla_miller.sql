CREATE TYPE "public"."equipment_status" AS ENUM('scheduled', 'received', 'failed', 'inventory', 'transit', 'with_person');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('done', 'in_progress', 'todo');--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"plan" varchar(100) NOT NULL,
	"status" varchar(50) NOT NULL,
	"access_until" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(100) NOT NULL,
	"access_scope" varchar(255) NOT NULL,
	"security_status" varchar(100) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"price_cents" integer NOT NULL,
	"active_licenses" integer DEFAULT 0 NOT NULL,
	"capacity" integer NOT NULL,
	"cost_center" varchar(255) NOT NULL,
	CONSTRAINT "plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "checklist_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text NOT NULL,
	"team" varchar(255) NOT NULL,
	"timing" varchar(255) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item" varchar(255) NOT NULL,
	"tag" varchar(50) NOT NULL,
	"person" varchar(255) NOT NULL,
	"method" varchar(100) NOT NULL,
	"scheduled_date" date,
	"status" "equipment_status" DEFAULT 'with_person' NOT NULL,
	CONSTRAINT "equipment_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"purpose" text NOT NULL,
	"status" "integration_status" NOT NULL,
	"last_activity" varchar(500),
	CONSTRAINT "integrations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "offboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"department" varchar(255) NOT NULL,
	"deadline" date NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"team" varchar(255) NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_case_id_idx" ON "tasks" USING btree ("case_id");