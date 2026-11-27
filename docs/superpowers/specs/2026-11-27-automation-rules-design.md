# Automation Rules Engine — Design

## Intent

Replace the existing `action_configs` system with a unified automation rules engine. Currently, task status changes fire per-org Slack/email/webhook actions via `action_configs` + `fireActions`. The automation rules engine extends this to arbitrary triggers (Correios delivery, equipment status changes, scheduled tasks), conditional matching, action chaining (depth 3), and an admin CRUD UI.

**Why:** HR admins need configurable reactions to events beyond task status changes — particularly Correios delivery confirmations, equipment status transitions, and scheduled checks. The current `action_configs` system only handles task phase-based dispatch and has no conditions or chaining.

## Goals

- Org-scoped automation rules with trigger/conditions/actions model
- Triggers: `task.status_changed`, `equipment.status_changed`, `correios.delivered`, `schedule.cron`
- Actions: `update_task`, `update_equipment`, `slack`, `email`, `webhook`, `correios_check`
- Conditions: JSON path matching against rule context (e.g. `equipment.status === "received"`)
- Action chaining up to depth 3 (a `update_task` action fires `task.status_changed` rules)
- CRUD API + admin UI at `/automacoes`
- Migration of existing `action_configs` data into `automation_rules`
- Default rules seeded in migration (Correios delivered → equipment received, etc.)

## Non-goals

- Cron parser — the Worker has one fixed trigger; every enabled `schedule.cron` rule runs each tick
- Complex condition operators (>, <, regex) — only equality matching
- Rule versioning or audit trail
- Visual flow builder

## Anti-goals

- Running both systems in parallel — `action_configs` dispatch must be fully replaced
- Breaking the existing checklist UI — the checklist model's step-based action configs must be migrated to automation rules

## Constraints

- Multi-tenancy: every rule is org-scoped via `org_id` FK
- The Worker cron trigger (`0 */4 * * *` or similar) already exists for Correios checks
- Slack delivery uses `postSlackMessage` (Bot API) or webhook URL; token read from `integrations` table per org
- Email uses Resend, gated by per-org `email` integration toggle
- Existing `action_configs` rows must be migrated to `automation_rules` in the migration SQL
- Inline rule execution (in PUT /equipment/:id, PATCH /tasks/:id/status) — slow actions delay the response (10s timeout, same as current)

## Approaches

### A. Unified replacement (chosen)

Add `automation_rules` table with org_id. Replace `fireActions` call sites with `fireRulesForTrigger`. Migrate `action_configs` data via SQL migration. Remove `action_configs` table and code after migration. The checklist model's save logic rewrites to `automation_rules` instead of `action_configs`.

**Trade-off:** One migration step, clean cut. Slight risk if any action_configs edge case isn't migrated.

### B. Gradual: add automation_rules alongside, deprecate later

Keep `action_configs` for task phase dispatch. Add `automation_rules` for new triggers only. Merge later.

**Why not:** Two dispatch paths for the same concept. The old PR did this and it was confusing — same event could fire from both tables.

### C. Extend action_configs with new columns

Add trigger, conditions, chaining columns to `action_configs`.

**Why not:** The table's shape (actionId as `kind:stepId`, phase-based lookup) doesn't fit condition matching or non-task triggers. Would be a Frankenstein.

## Design

### Schema

```sql
CREATE TABLE "automation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "trigger" varchar(100) NOT NULL,
  "conditions" jsonb NOT NULL DEFAULT '{}',
  "actions" jsonb NOT NULL DEFAULT '[]',
  "enabled" boolean NOT NULL DEFAULT true,
  "cron_schedule" varchar(50),
  "source_ref" varchar(200),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX "automation_rules_org_trigger_idx" ON "automation_rules" (org_id, trigger);
CREATE UNIQUE INDEX "automation_rules_org_source_ref_idx" ON "automation_rules" (org_id, source_ref) WHERE source_ref IS NOT NULL;
```

`source_ref` is the dedup key for machine-managed rules. The checklist save flow sets it to `kind:stepId` (matching the old `action_configs.actionId` pattern), enabling transactional upsert via `ON CONFLICT (org_id, source_ref)`. Human-created rules from the UI leave it null.

Triggers enum: `task.status_changed`, `equipment.status_changed`, `correios.delivered`, `schedule.cron`

Action types enum: `update_task`, `update_equipment`, `slack`, `email`, `webhook`, `correios_check`

### Engine

Same architecture as old PR #75's engine.ts, adapted to current interfaces:

- `fireRulesForTrigger(trigger, context, repos, depth)` — queries enabled rules for org+trigger, runs each
- `executeRule(rule, context, repos, depth)` — matches conditions, runs actions sequentially
- `matchesConditions(conditions, context, repos)` — flattens context to dot-paths, compares equality
- `renderTemplate(template, context)` — `{{group.field}}` replacement with aliases
- Chain cap at depth 3
- `runScheduledRules(repos)` — called by Worker cron, queries `getAllCronRules()` across all orgs (cron has no org context), runs each with the rule's org_id in context

Key interface difference from old PR: repos now require orgId:

- `updateTaskStatus(orgId, taskId, status)` (not `(id, status)`)
- `updateEquipmentStatus(orgId, equipmentId, status)` (not `(id, status)`)
- Slack via `postSlackMessage(apiUrl, token, channel, text)` + token from integrations
- Email via Resend, gated by `integrations.isConnected(orgId, "email")`

### RuleContext

```typescript
type RuleContext = {
  orgId: string;
  task?: {
    id: string;
    title: string;
    status: string;
    previousStatus?: string;
    phase?: string;
    stepId?: string;
  };
  equipment?: { id: string; tag?: string; item?: string; status: string; previousStatus?: string };
  case?: { id: string; name: string };
};
```

### Migration path for action_configs

The SQL migration:

1. Creates `automation_rules` table
2. Inserts default rules per org (Correios delivered → equipment received, etc.)
3. Migrates existing `action_configs` rows: each becomes an automation rule with trigger `task.status_changed`, condition `task.phase === <phase>`, and the matching action type
4. Drops `action_configs` table (or keeps it empty with a deprecation note — builder's call based on whether the checklist save flow is fully migrated in the same PR)

### Checklist integration

`checklistModels` table is untouched — it stores layout only. The employee-side `readChecklist` (in `features/employee/checklist.ts`) reads only from `checklistModels` and needs no changes.

The HR-side `saveChecklist` (in `action-configs/repository.ts`) currently does a transactional upsert into `action_configs` keyed on `(orgId, actionId)` where actionId is `kind:stepId`. After migration, it upserts into `automation_rules` keyed on `(org_id, source_ref)` where source_ref is the same `kind:stepId` pattern. Each step/kind combo becomes an automation rule with trigger `task.status_changed` and condition `{"task.stepId": "<stepId>"}`.

The `/checklist-model` GET/PUT endpoints stay in the same routes file; only the underlying table changes from `action_configs` to `automation_rules`.

### API

CRUD routes at `/automation-rules`, org-scoped via portal access:

- `GET /automation-rules` — list rules for org
- `POST /automation-rules` — create
- `GET /automation-rules/:id` — read
- `PUT /automation-rules/:id` — update
- `DELETE /automation-rules/:id` — delete
- `POST /automation-rules/run-scheduled` — cron endpoint (bearer auth)

### Web UI

New route `_portal.automacoes.tsx` at `/automacoes`. DataTable with columns: name, trigger label, actions summary, enabled toggle. Dialog for create/edit with form fields: name, trigger select, conditions editor, actions list, enabled, cron schedule.

## What's left to the builder

- Exact Drizzle schema definition in `packages/db/src/schema/index.ts`
- Migration SQL file number (next available after current max)
- Fixture file for test seeding
- Test structure — engine unit tests covering all action types and chaining, route integration tests, delivery path tests (Slack bot/webhook, email via Resend, webhook) matching the coverage of the existing 601-line `actions.test.ts`
- Whether to drop `action_configs` table in same migration or defer (recommendation: defer drop to a follow-up migration after verifying the checklist save works correctly against `automation_rules`)
- UI component details (the old PR's automations-page.tsx and rule-dialog.tsx are good reference)
