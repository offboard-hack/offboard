CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"trigger" varchar(100) NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron_schedule" varchar(50),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "automation_rules_trigger_idx" ON "automation_rules" USING btree ("trigger");
--> statement-breakpoint
INSERT INTO "automation_rules" ("name", "trigger", "conditions", "actions", "enabled", "cron_schedule") VALUES
	('Correios entregue → equipamento recebido', 'correios.delivered', '{}'::jsonb, '[{"type":"update_equipment","set":{"status":"received"}}]'::jsonb, true, NULL),
	('Correios entregue → tarefa concluída', 'correios.delivered', '{}'::jsonb, '[{"type":"update_task","set":{"status":"done"}}]'::jsonb, true, NULL),
	('Todo equipamento devolvido → notificar RH', 'equipment.status_changed', '{"equipment.status":"received","case.allEquipmentReceived":true}'::jsonb, '[{"type":"slack","channel":"#rh","message":"Todos os equipamentos de {{case}} foram devolvidos"}]'::jsonb, true, NULL),
	('Verificar rastreios Correios', 'schedule.cron', '{}'::jsonb, '[{"type":"correios_check"}]'::jsonb, true, '0 */4 * * *');
