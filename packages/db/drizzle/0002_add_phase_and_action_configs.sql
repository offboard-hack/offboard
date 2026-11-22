ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "phase" varchar(50);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"phase" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "action_configs_action_id_idx" ON "action_configs" ("action_id");
