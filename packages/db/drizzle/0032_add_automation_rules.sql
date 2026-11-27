CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL,
	"name" varchar(255) NOT NULL,
	"trigger" varchar(100) NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron_schedule" varchar(50),
	"source_ref" varchar(200),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rules_org_trigger_idx" ON "automation_rules" USING btree ("org_id","trigger");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_rules_org_source_ref_idx" ON "automation_rules" USING btree ("org_id","source_ref") WHERE "automation_rules"."source_ref" IS NOT NULL;--> statement-breakpoint
INSERT INTO "automation_rules" ("org_id", "name", "trigger", "conditions", "actions", "enabled", "cron_schedule")
SELECT o.id, r.name, r.trigger, r.conditions::jsonb, r.actions::jsonb, true, r.cron_schedule
FROM "organizations" o
CROSS JOIN (VALUES
  ('Correios entregue → equipamento recebido', 'correios.delivered', '{}', '[{"type":"update_equipment","set":{"status":"received"}}]', NULL),
  ('Correios entregue → tarefa concluída', 'correios.delivered', '{}', '[{"type":"update_task","set":{"status":"done"}}]', NULL),
  ('Todo equipamento devolvido → notificar RH', 'equipment.status_changed', '{"equipment.status":"received","case.allEquipmentReceived":"true"}', '[{"type":"slack","channel":"#rh","message":"Todos os equipamentos de {{case.name}} foram devolvidos"}]', NULL),
  ('Verificar rastreios Correios', 'schedule.cron', '{}', '[{"type":"correios_check"}]', '0 */4 * * *')
) AS r(name, trigger, conditions, actions, cron_schedule);
