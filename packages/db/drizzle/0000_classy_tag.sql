CREATE TABLE "offboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"department" varchar(100) NOT NULL,
	"deadline" date NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "offboarding_cases_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "offboarding_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"team" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'todo' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD CONSTRAINT "offboarding_tasks_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE cascade ON UPDATE no action;