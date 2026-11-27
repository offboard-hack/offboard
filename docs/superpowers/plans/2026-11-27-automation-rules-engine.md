# Automation Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `action_configs` with a unified `automation_rules` engine — org-scoped rules with arbitrary triggers, conditions, chaining, CRUD API, and admin UI.

**Architecture:** New `automation_rules` table (org-scoped, trigger/conditions/actions/source_ref). Engine fires rules on trigger events (task status, equipment status, Correios delivery, cron). CRUD API replaces action-configs routes. Checklist save rewrites to automation_rules via source_ref dedup key. Admin UI at `/automacoes`.

**Tech Stack:** Elysia API, Drizzle ORM, PostgreSQL, TanStack Router/Query, vitest

**Spec:** `docs/superpowers/specs/2026-11-27-automation-rules-design.md`

## Global Constraints

- Multi-tenancy: every query must include `org_id` predicate
- 100% test coverage mandatory
- No code comments unless a linter demands it or a non-obvious constraint is invisible
- PR descriptions and commit messages in English
- Action execution has 10s timeout via `AbortSignal.timeout(10_000)`
- Chain depth capped at 3 (constant `MAX_CHAIN_DEPTH`)
- `correios.in_transit` trigger exists in enum but no default rule uses it
- Scheduled rules query across all orgs (cron has no org context)
- `checklistModels` table is untouched — only the action dispatch layer migrates

## Review Focus

1. A rule whose action triggers another rule at depth 3 must stop — depth 4 must not execute. **Test:** Task 2 engine test `it("stops chaining at MAX_CHAIN_DEPTH")`.
2. `source_ref` partial unique index allows multiple null values but enforces uniqueness on non-null per org — a checklist save must upsert, not duplicate. **Test:** Task 3 repository test `it("upserts by source_ref within the same org")`.
3. Equipment status update route currently does NOT dispatch any actions — the engine must fire `equipment.status_changed` from that route after migration. **Test:** Task 5 integration test `it("fires equipment.status_changed rule on PUT /equipment/:id")`.
4. Deleting an org cascades to its rules — no orphan rules. **Test:** Task 1 migration test verifying FK constraint.
5. `runScheduledRules` iterates rules from all orgs and must pass each rule's `org_id` into context, not a shared one. **Test:** Task 2 engine test `it("runs scheduled rules across multiple orgs")`.

---

### Task 1: Schema and Migration

**Files:**

- Modify: `packages/db/src/schema/index.ts` — add `ruleTriggers`, `ruleActionTypes`, `automationRules` table, enums, types, relation
- Create: `packages/db/drizzle/0032_add_automation_rules.sql`
- Create: `packages/db/drizzle/meta/0032_snapshot.json`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/src/automation-rules.fixture.ts`

**Interfaces:**

- Consumes: nothing
- Produces:
  - `ruleTriggers: readonly ["equipment.status_changed", "task.status_changed", "correios.delivered", "correios.in_transit", "schedule.cron"]`
  - `ruleActionTypes: readonly ["update_task", "update_equipment", "slack", "email", "webhook", "correios_check"]`
  - `type RuleTrigger = (typeof ruleTriggers)[number]`
  - `type RuleAction = { type: (typeof ruleActionTypes)[number] } & Record<string, ConfigValue>`
  - `automationRules` Drizzle table with columns: `id`, `orgId`, `name`, `trigger`, `conditions`, `actions`, `enabled`, `cronSchedule`, `sourceRef`, `createdAt`, `updatedAt`
  - Fixture: `seedAutomationRules(db: Database, orgId: string)` inserts 4 default rules

- [ ] **Step 1: Add schema to `packages/db/src/schema/index.ts`**

Add after the `actionConfigs` table definition: `ruleTriggers` array, `ruleActionTypes` array, type exports, and `automationRules` pgTable with:

- `orgId: orgIdColumn()` with cascade delete on organizations
- `sourceRef: varchar("source_ref", { length: 200 })` nullable
- Indexes: `(org_id, trigger)` and unique partial `(org_id, source_ref) WHERE source_ref IS NOT NULL`
- Add to `organizationsRelations`: `automationRules: many(automationRules)`

- [ ] **Step 2: Generate migration with drizzle-kit**

Run: `npx drizzle-kit generate`

This creates the next numbered migration (0032). Verify the SQL creates the table, indexes, and FK. Edit the generated SQL to also insert 4 default rules per existing org:

```sql
INSERT INTO "automation_rules" ("org_id", "name", "trigger", "conditions", "actions", "enabled", "cron_schedule")
SELECT o.id, r.name, r.trigger, r.conditions::jsonb, r.actions::jsonb, true, r.cron_schedule
FROM organizations o
CROSS JOIN (VALUES
  ('Correios entregue → equipamento recebido', 'correios.delivered', '{}', '[{"type":"update_equipment","set":{"status":"received"}}]', NULL),
  ('Correios entregue → tarefa concluída', 'correios.delivered', '{}', '[{"type":"update_task","set":{"status":"done"}}]', NULL),
  ('Todo equipamento devolvido → notificar RH', 'equipment.status_changed', '{"equipment.status":"received","case.allEquipmentReceived":"true"}', '[{"type":"slack","channel":"#rh","message":"Todos os equipamentos de {{case.name}} foram devolvidos"}]', NULL),
  ('Verificar rastreios Correios', 'schedule.cron', '{}', '[{"type":"correios_check"}]', '0 */4 * * *')
) AS r(name, trigger, conditions, actions, cron_schedule);
```

- [ ] **Step 3: Create fixture `packages/db/src/automation-rules.fixture.ts`**

Export `seedAutomationRules(db: Database, orgId: string)` that inserts the same 4 default rules for a given org. Used by tests.

- [ ] **Step 4: Run `packages/db` tests**

Run: `npm test -w packages/db`
Expected: PASS, 100% coverage

- [ ] **Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat: add automation_rules schema, migration 0032, and fixture"
```

---

### Task 2: Rule Engine

**Files:**

- Create: `apps/api/src/features/automation-rules/engine.ts`
- Create: `apps/api/src/features/automation-rules/engine.test.ts`

**Interfaces:**

- Consumes: `automationRules` table, `RuleTrigger`, `RuleAction`, `ConfigValue` from schema; `postSlackMessage` from `shared/slack.ts`; Resend for email
- Produces:
  - `type RuleContext = { orgId: string; task?: { id: string; title: string; status: string; previousStatus?: string; phase?: string; stepId?: string }; equipment?: { id: string; tag?: string; item?: string; status: string; previousStatus?: string }; case?: { id: string; name: string } }`
  - `type RuleResult = { ruleId: string; matched: boolean; errors: string[] }`
  - `type EngineRepos` — object with `automationRules`, `offboardings`, `equipment`, `runCorreiosCheck?`, `slack`, `emailEnabled`
  - `executeRule(rule: Rule, context: RuleContext, repos: EngineRepos, depth?: number): Promise<RuleResult>`
  - `fireRulesForTrigger(trigger: RuleTrigger, context: RuleContext, repos: EngineRepos, depth?: number): Promise<RuleResult[]>`
  - `runScheduledRules(repos: EngineRepos): Promise<RuleResult[]>` — queries `getAllCronRules()` across all orgs, fires each with its `orgId` in context

- [ ] **Step 1: Write failing tests in `engine.test.ts`**

Test cases (integration tests against real DB, same pattern as `actions.test.ts`):

- `it("fires matching rules for a trigger")` — insert a rule, fire trigger, assert matched
- `it("skips disabled rules")`
- `it("evaluates conditions — matches")` — condition `{"equipment.status":"received"}` with matching context
- `it("evaluates conditions — rejects")` — same condition, non-matching context
- `it("renders templates in Slack message")` — `{{task.title}}` replacement
- `it("chains update_task to task.status_changed rules")` — depth 1 chain
- `it("stops chaining at MAX_CHAIN_DEPTH")` — insert rules that chain 4 deep, only 3 fire
- `it("runs scheduled rules across multiple orgs")` — insert cron rules for 2 orgs, verify both fire
- `it("handles Slack webhook action")`
- `it("handles Slack bot action")`
- `it("handles email action")`
- `it("handles webhook action")`
- `it("handles correios_check action")`
- `it("returns error for unknown action type")`
- `it("survives a broken DB on fireRulesForTrigger")` — returns `[]`

Use an HTTP test server for Slack/webhook/email (same pattern as `actions.test.ts`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w apps/api -- --reporter=verbose apps/api/src/features/automation-rules/engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `engine.ts`**

Adapt the old PR's `engine.ts` (321 lines) to current interfaces:

- `EngineRepos.offboardings.updateTaskStatus(orgId, taskId, status)` — 3 args, not 2
- `EngineRepos.equipment.updateEquipmentStatus(orgId, equipmentId, status)` — 3 args, not 2
- Slack: use `postSlackMessage(apiUrl, token, channel, text)` from `shared/slack.ts`, or webhook URL
- Email: use Resend directly (same as `actions.ts`)
- `matchesConditions`: flattens context to dot-paths, compares equality. Special case `case.allEquipmentReceived` queries `equipment.areAllCaseEquipmentReceived(caseId)`
- `renderTemplate`: `{{group.field}}` replacement with aliases (`tag`, `item`, `task`, `status`, `case`)
- `orgId` flows from `RuleContext` — every repo call uses `context.orgId`
- `runScheduledRules`: calls `repos.automationRules.getAllCronRules()` (returns `Rule & { orgId: string }[]`), fires each with `{ orgId: rule.orgId }` as context

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w apps/api -- --reporter=verbose apps/api/src/features/automation-rules/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/automation-rules/
git commit -m "feat: add automation rules engine with chaining and multi-org scheduled rules"
```

---

### Task 3: Repository

**Files:**

- Create: `apps/api/src/features/automation-rules/repository.ts`
- Modify: `apps/api/src/repositories.ts` — add `automationRules` to the repositories object
- Modify: `apps/api/src/repositories.test.ts` — add new repository if tested there

**Interfaces:**

- Consumes: `automationRules` table from schema
- Produces:
  - `createAutomationRulesRepository(db: Database)` returning:
    - `listRules(orgId: string)`
    - `getRule(orgId: string, id: string)`
    - `createRule(orgId: string, data: NewRule)`
    - `updateRule(orgId: string, id: string, data: Partial<NewRule>)`
    - `deleteRule(orgId: string, id: string): Promise<boolean>`
    - `getEnabledRulesByTrigger(orgId: string, trigger: RuleTrigger)`
    - `getAllCronRules(): Promise<(Rule & { orgId: string })[]>` — no org filter
    - `upsertBySourceRef(orgId: string, sourceRef: string, data: NewRule)` — `ON CONFLICT (org_id, source_ref) DO UPDATE`
    - `deleteBySourceRef(orgId: string, sourceRef: string): Promise<boolean>`
  - `type AutomationRulesRepository = ReturnType<typeof createAutomationRulesRepository>`

- [ ] **Step 1: Write repository tests**

Test `upsertBySourceRef` specifically:

- `it("creates a rule with source_ref")`
- `it("upserts by source_ref within the same org")` — second call updates, not duplicates
- `it("allows same source_ref in different orgs")` — two orgs, same ref, two rows

- [ ] **Step 2: Implement `repository.ts`**

Follow the pattern from the old PR's repository.ts, adding `orgId` to all queries and the new `upsertBySourceRef` / `deleteBySourceRef` methods.

- [ ] **Step 3: Add to `repositories.ts`**

```typescript
import { createAutomationRulesRepository } from "./features/automation-rules/repository.js";
// in createRepositories:
automationRules: createAutomationRulesRepository(db),
```

- [ ] **Step 4: Run tests**

Run: `npm test -w apps/api`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/automation-rules/repository.ts apps/api/src/repositories.ts apps/api/src/repositories.test.ts
git commit -m "feat: add automation rules repository with upsert-by-source-ref"
```

---

### Task 4: CRUD API Routes

**Files:**

- Create: `apps/api/src/features/automation-rules/routes.ts`
- Modify: `apps/api/src/app.ts` — wire routes, replace `dispatchAction` with engine call
- Modify: `apps/api/src/app.test.ts` — add route tests

**Interfaces:**

- Consumes: `AutomationRulesRepository`, `EngineRepos`, `portalAccess`
- Produces:
  - `automationRulesRoutes(repos, access, runScheduled, cronSecret)` Elysia plugin
  - Routes: `GET /automation-rules`, `POST /automation-rules`, `GET /automation-rules/:id`, `PUT /automation-rules/:id`, `DELETE /automation-rules/:id`, `POST /automation-rules/run-scheduled`

- [ ] **Step 1: Implement `routes.ts`**

Adapt the old PR's routes.ts: same CRUD shape, all org-scoped via `principal.orgId`. The `/run-scheduled` endpoint uses bearer auth (`cronSecret`).

- [ ] **Step 2: Wire in `app.ts`**

Replace the `dispatchAction` closure with engine-based dispatch:

```typescript
const dispatchAction: DispatchAction = async (context, stepId) => {
  await fireRulesForTrigger(
    "task.status_changed",
    {
      orgId: context.orgId,
      task: {
        id: context.taskId,
        title: context.taskTitle,
        status: context.status,
        phase: context.phase,
        stepId: stepId ?? undefined,
      },
    },
    engineRepos,
  );
};
```

Replace `.use(actionConfigsRoutes(...))` with `.use(automationRulesRoutes(...))`.

Keep the `readChecklist` reference — it reads from `checklistModels`, not `action_configs`.

- [ ] **Step 3: Add route tests in `app.test.ts`**

Tests for CRUD operations on `/api/automation-rules`, including permission checks and the run-scheduled endpoint.

- [ ] **Step 4: Run full test suite**

Run: `npm test -w apps/api`
Expected: PASS with 100% coverage

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/automation-rules/routes.ts apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat: add automation rules CRUD API and replace action dispatch with engine"
```

---

### Task 5: Checklist Migration and Equipment Trigger

**Files:**

- Modify: `apps/api/src/features/action-configs/repository.ts` — rewrite `saveChecklist` to use `automation_rules` via `upsertBySourceRef`
- Modify: `apps/api/src/features/equipment/routes.ts` — add `fireRulesForTrigger("equipment.status_changed", ...)` after status update
- Modify: `apps/api/src/features/offboardings/routes.ts` — add `fireRulesForTrigger("correios.delivered", ...)` after delivery detection
- Modify: `apps/api/src/app.test.ts` — integration tests for new trigger points

**Interfaces:**

- Consumes: `AutomationRulesRepository.upsertBySourceRef`, `fireRulesForTrigger` from engine
- Produces: equipment status changes and Correios deliveries now fire automation rules

- [ ] **Step 1: Write failing integration tests**

- `it("fires equipment.status_changed rule on PUT /equipment/:id")` — seed a rule with trigger `equipment.status_changed`, update equipment status, verify rule fired (Slack/webhook received)
- `it("fires correios.delivered rules when Correios check finds delivery")` — seed delivery rule, trigger cron check with mock delivered response, verify equipment marked received

- [ ] **Step 2: Rewrite `saveChecklist` in `action-configs/repository.ts`**

Replace `action_configs` upsert with `automation_rules` upsert via `upsertBySourceRef`. Each step/kind combo becomes a rule with `trigger: "task.status_changed"`, `sourceRef: "kind:stepId"`, and the action type matching the kind (email/slack/webhook).

The `readChecklist` function still reads from `checklistModels` only — no change needed.

- [ ] **Step 3: Add `fireRulesForTrigger` to equipment routes**

After `repos.updateEquipmentStatus(orgId, id, status)` succeeds, fire:

```typescript
void fireRulesForTrigger(
  "equipment.status_changed",
  {
    orgId,
    equipment: { id: params.id, status: body.status, previousStatus: updated.previousStatus },
  },
  engineRepos,
).catch(() => {});
```

The `previousStatus` comes from the update return value — modify `updateEquipmentStatus` to return it if not already returned.

- [ ] **Step 4: Add `fireRulesForTrigger` to Correios delivery handler**

In `checkTrackedShipments`, after marking equipment returned on delivery, fire:

```typescript
await fireRulesForTrigger(
  "correios.delivered",
  {
    orgId: task.orgId,
    task: { id: task.id, title: task.title, status: "done", phase: task.phase ?? undefined },
    equipment: task.equipmentId ? { id: task.equipmentId, status: "received" } : undefined,
    case: { id: task.caseId, name: task.caseName },
  },
  engineRepos,
);
```

- [ ] **Step 5: Run full test suite**

Run: `npm test -w apps/api`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/action-configs/ apps/api/src/features/equipment/ apps/api/src/features/offboardings/ apps/api/src/app.test.ts
git commit -m "feat: wire automation rules to checklist save, equipment, and Correios triggers"
```

---

### Task 6: Remove action_configs Dispatch Code

**Files:**

- Delete: `apps/api/src/features/action-configs/actions.ts`
- Delete: `apps/api/src/features/action-configs/actions.test.ts`
- Delete: `apps/api/src/shared/action-dispatch.ts`
- Modify: `apps/api/src/app.ts` — remove `fireActions` import, remove old `dispatchAction` closure
- Modify: `apps/api/src/features/employee/routes.ts` — replace `DispatchAction` parameter with engine dispatch
- Modify: `apps/api/src/features/offboardings/routes.ts` — remove `DispatchAction` parameter, use engine directly

**Interfaces:**

- Consumes: `fireRulesForTrigger` from engine (already wired in Task 4/5)
- Produces: clean removal of old dispatch path

- [ ] **Step 1: Remove old dispatch code**

Delete `actions.ts`, `actions.test.ts`, `action-dispatch.ts`. Update all callers to use `fireRulesForTrigger` from the engine.

The `DispatchAction` type and `dispatchTaskAction` helper are no longer needed — callsites fire the engine directly.

- [ ] **Step 2: Update employee routes**

Replace `dispatchAction: DispatchAction` parameter with a function that calls `fireRulesForTrigger("task.status_changed", ...)`.

- [ ] **Step 3: Run full test suite**

Run: `npm test -w apps/api`
Expected: PASS with 100% coverage

- [ ] **Step 4: Commit**

```bash
git add -A apps/api/src/
git commit -m "refactor: remove action_configs dispatch code, engine handles all triggers"
```

---

### Task 7: Web UI — Entity and Route

**Files:**

- Create: `apps/web/src/entities/automation-rule.ts`
- Create: `apps/web/src/app/routes/_portal.automacoes.tsx`
- Create: `apps/web/src/features/automations/automations-page.tsx`
- Create: `apps/web/src/features/automations/rule-dialog.tsx`
- Create: `apps/web/src/features/automations/rule-form.ts`
- Create: `apps/web/src/features/automations/rule-form.test.ts`
- Modify: `apps/web/src/app/portal.tsx` — add `/automacoes` to navigation
- Modify: `apps/web/src/app/route-pending.tsx` — add `AutomationsPending` if pattern used

**Interfaces:**

- Consumes: `GET /api/automation-rules`, `POST`, `PUT`, `DELETE` from Task 4
- Produces: `/automacoes` page with DataTable, create/edit dialog, enable/disable toggle

- [ ] **Step 1: Create `apps/web/src/entities/automation-rule.ts`**

Same as old PR: query options, mutation hooks, types derived from API client.

- [ ] **Step 2: Create `apps/web/src/features/automations/rule-form.ts`**

Export `triggerLabels`, `actionLabels`, `triggerItems`, `summarizeActions`, `parseConditions`, `parseActions`, `defaultActionsJson`.

- [ ] **Step 3: Write `rule-form.test.ts`**

Test `parseConditions`, `parseActions`, `summarizeActions` with valid/invalid inputs.

- [ ] **Step 4: Create `rule-dialog.tsx`**

Dialog with form fields: name (text), trigger (select from `triggerItems`), conditions (JSON textarea), actions (JSON textarea), enabled (checkbox), cronSchedule (text, shown when trigger is `schedule.cron`).

- [ ] **Step 5: Create `automations-page.tsx`**

DataTable with columns: name, trigger label, actions summary, enabled toggle. Create button opens dialog. Row click opens edit dialog. Delete button with confirmation.

- [ ] **Step 6: Create route `_portal.automacoes.tsx`**

Follow the `_portal.integracoes.tsx` pattern: `createFileRoute("/_portal/automacoes")`, beforeLoad checks `manage` + `Integrations` permission, loader ensures query data, lazy loads `AutomationsPage`.

- [ ] **Step 7: Add to portal navigation**

In `portal.tsx` `navigationGroups`, add to the "Administração" group before "Integrações":

```typescript
{
  to: "/automacoes",
  label: "Automações",
  subject: "Integrations",
  icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
},
```

- [ ] **Step 8: Run web tests and type check**

Run: `npm test -w apps/web && npx tsc --noEmit -p apps/web`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat: add /automacoes admin page for automation rules CRUD"
```

---

**Deferred:** Dropping the `action_configs` table is a follow-up migration after this PR lands and the checklist save is verified in production. The table remains in the schema but is no longer written to after Task 6. The `/action-configs` CRUD routes are removed in Task 6 (they were only used by the old checklist-auto page, which now reads from `/automation-rules`).
