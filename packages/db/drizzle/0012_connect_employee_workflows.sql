CREATE TABLE "checklist_models" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"steps" jsonb NOT NULL
);
--> statement-breakpoint
DROP INDEX "action_configs_action_id_idx";--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "tag" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "from_employee_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "checklist_step_id" varchar(90);--> statement-breakpoint
ALTER TABLE "checklist_models" ADD CONSTRAINT "checklist_models_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "equipment" ("org_id", "case_id", "item", "tag", "return_method", "scheduled_date", "status", "from_employee_plan")
SELECT
  access."org_id",
  access."case_id",
  asset->>'title',
  asset->>'code',
  CASE WHEN departure."value"->'booking'->>'method' = 'office'
    THEN 'in_person'::"equipment_return_method" ELSE 'pickup'::"equipment_return_method" END,
  CASE WHEN departure."value"->'booking'->>'day' ~ '^\d{4}-\d{2}-\d{2}$'
    THEN (departure."value"->'booking'->>'day')::date END,
  CASE WHEN departure."value"->'booking'->>'day' ~ '^\d{4}-\d{2}-\d{2}$'
    THEN 'scheduled'::"equipment_status" ELSE 'with_person'::"equipment_status" END,
  true
FROM "employee_access" access
JOIN "offboarding_cases" active_case ON active_case."id" = access."case_id" AND active_case."org_id" = access."org_id"
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(access."plan"->'equipment', '[]'::jsonb)) AS asset
LEFT JOIN "auth_user" employee ON lower(employee."email") = lower(access."email")
LEFT JOIN "employee_states" departure
  ON departure."org_id" = access."org_id" AND departure."case_id" = access."case_id"
  AND departure."user_id" = employee."id" AND departure."key" = 'departure-v1'
WHERE asset->>'code' IS NOT NULL AND asset->>'title' IS NOT NULL
ORDER BY access."case_id"
ON CONFLICT ("org_id", "tag") DO NOTHING;
