# Action Configs (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `phase` column to `tasks` table and create `action_configs` table with CRUD API endpoints, as the foundation for the integrations+actions system.

**Architecture:** Two schema changes (phase on tasks, new action_configs table) with repository functions and Elysia API endpoints following the existing patterns. Frontend catalog of action templates defined as a TypeScript constant. No UI in this PR — that's PR 2.

**Tech Stack:** Drizzle ORM, PostgreSQL, Elysia + TypeBox, Vitest

**Spec:** `docs/superpowers/specs/2026-11-22-integrations-actions-design.md`

## Global Constraints

- Migrations are written manually as SQL (drizzle-kit generate requires TTY)
- Each migration needs: SQL file, journal entry, snapshot JSON
- 100% test coverage on `apps/api/src/**/*.ts` (excluding `server.ts`, `vercel.ts`)
- Tests run with `DATABASE_URL=... npx vitest run` in `apps/api`
- Vercel function bundle must be rebuilt: `npx esbuild apps/api/src/vercel.ts --bundle --platform=node --format=esm --target=node22 --outfile=api/offboard.mjs --external:pg-native --banner:js='import{createRequire as _cr}from"module";const require=_cr(import.meta.url);'`
- `vercel.json` rewrites must be added for new API paths
- Seed database function must be updated to include new tables
- Commits and PR in English

## Review Focus

1. **Phase value validation** — a phase string that isn't in the known set (`pre`, `d0`, `first-week`, `second-week`, `follow-up`) should be rejected by the API, not silently stored.
2. **action_id uniqueness** — creating two configs for the same `action_id` should fail with a clear error, not silently duplicate.
3. **Unknown action_id** — an `action_id` that doesn't match any catalog entry should be rejected (or at minimum, the API should not crash).
4. **Empty config JSON** — `config` defaults to `{}` but a `null` or missing value should not break serialization.
5. **Phase on existing tasks** — existing tasks have `phase = NULL`. The API and seed must handle nullable phase gracefully.

---

### Task 1: Migration — add phase to tasks + create action_configs table

**Files:**

- Create: `packages/db/drizzle/0002_add_phase_and_action_configs.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/drizzle/meta/0002_snapshot.json`

**Interfaces:**

- Consumes: nothing
- Produces: `tasks.phase` column (varchar 50, nullable), `action_configs` table, `action_config_phase` enum

- [ ] **Step 1: Write the migration SQL file**

`packages/db/drizzle/0002_add_phase_and_action_configs.sql`:

```sql
ALTER TABLE "tasks" ADD COLUMN "phase" varchar(50);

CREATE TABLE IF NOT EXISTS "action_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "action_id" varchar(100) NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "config" jsonb NOT NULL DEFAULT '{}',
  "phase" varchar(50) NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "action_configs_action_id_idx" ON "action_configs" ("action_id");
```

- [ ] **Step 2: Update the journal to include the new migration**

Add entry to `packages/db/drizzle/meta/_journal.json` with `idx: 2`, `tag: "0002_add_phase_and_action_configs"`.

- [ ] **Step 3: Write the snapshot JSON**

Create `packages/db/drizzle/meta/0002_snapshot.json` — copy from `0001_snapshot.json`, add `phase` column to `public.tasks` table, add `public.action_configs` table with its columns and unique index.

- [ ] **Step 4: Verify migration runs locally**

Run: `DATABASE_URL=postgresql://offboard:offboard@localhost:5432/offboard npx drizzle-kit migrate`
Expected: migration applies without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/
git commit -m "feat: add phase column to tasks and action_configs table"
```

---

### Task 2: Drizzle schema + repository functions

**Files:**

- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/repositories/index.ts`

**Interfaces:**

- Consumes: DB tables from Task 1
- Produces:
  - Schema: `actionConfigs` table definition, `phase` column on `tasks`
  - Repository: `listActionConfigs(): Promise<ActionConfigRow[]>`, `getActionConfig(id: string): Promise<ActionConfigRow | null>`, `createActionConfig(data: NewActionConfig): Promise<ActionConfigRow>`, `updateActionConfig(id: string, data: Partial<NewActionConfig>): Promise<ActionConfigRow | null>`, `deleteActionConfig(id: string): Promise<boolean>`
  - Types: `ActionConfigRow = { id: string; actionId: string; enabled: boolean; config: Record<string, unknown>; phase: string }`, `NewActionConfig = { actionId: string; enabled?: boolean; config?: Record<string, unknown>; phase: string }`

- [ ] **Step 1: Add phase column and actionConfigs table to Drizzle schema**

In `packages/db/src/schema/index.ts`:

- Add `phase: varchar("phase", { length: 50 })` to the `tasks` table (nullable — no `.notNull()`)
- Add `actionConfigs` table with columns: `id` (uuid PK), `actionId` (varchar 100 notNull), `enabled` (boolean notNull default true), `config` (jsonb notNull default `{}`), `phase` (varchar 50 notNull), `createdAt`, `updatedAt`, with `uniqueIndex("action_configs_action_id_idx").on(table.actionId)`

- [ ] **Step 2: Add repository functions**

In `packages/db/src/repositories/index.ts`:

- Export types `ActionConfigRow` and `NewActionConfig`
- Add `listActionConfigs()` — select all ordered by `actionId` asc
- Add `getActionConfig(id: string)` — find by id, return null if not found
- Add `createActionConfig(data: NewActionConfig)` — insert and return the row
- Add `updateActionConfig(id: string, data: Partial<NewActionConfig>)` — update with `updatedAt: new Date()`, return null if not found
- Add `deleteActionConfig(id: string)` — delete by id, return `true` if deleted
- Include all five in the returned object

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/index.ts packages/db/src/repositories/index.ts
git commit -m "feat: add actionConfigs schema and repository functions"
```

---

### Task 3: Update seed data to include phase on tasks

**Files:**

- Modify: `packages/db/src/offboarding.fixture.ts`
- Modify: `packages/db/src/seed-database.ts`
- Create: `packages/db/src/action-config.fixture.ts`

**Interfaces:**

- Consumes: `actionConfigs` table from Task 2, `tasks.phase` column
- Produces: `seedActionConfigs` array, updated `seedCases` with phase per task tuple, updated `seedDatabase` that cleans and inserts `action_configs`

- [ ] **Step 1: Add phase to seed cases**

In `packages/db/src/offboarding.fixture.ts`:

- Change `SeedCase.tasks` tuple type from `[team, title, status]` to `[team, title, status, phase]` where phase is `string | null`
- Add a phase value to each task tuple. Use the checklist phases: tasks like "Conferir estabilidades", "Comunicar desligamento" → `"pre"`; "Bloquear acessos", "Fechar ponto" → `"d0"`; "Transferir arquivos", "Coletar notebook", "Confirmar a passagem" → `"first-week"`; "Apagar dados", "Conferir a entrega" → `"second-week"`; "Responder pesquisa" → `"follow-up"`. Apply reasonable phase values based on the task nature.

- [ ] **Step 2: Create action config fixture**

Create `packages/db/src/action-config.fixture.ts`:

```ts
export type SeedActionConfig = {
  actionId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  phase: string;
};

export const seedActionConfigs: SeedActionConfig[] = [
  {
    actionId: "email::notify_collaborator",
    enabled: true,
    config: { subject: "Seu desligamento", body: "Informamos que..." },
    phase: "d0",
  },
  { actionId: "google::block_account", enabled: true, config: {}, phase: "d0" },
  { actionId: "slack::send_message", enabled: false, config: { channel: "#rh" }, phase: "d0" },
];
```

- [ ] **Step 3: Update seedDatabase to include phase and action_configs**

In `packages/db/src/seed-database.ts`:

- Import `actionConfigs` from schema and `seedActionConfigs` from fixture
- Add `await tx.delete(actionConfigs)` in the cleanup (before deleting tasks, since action_runs will FK to it later)
- Pass `phase: caseTasks[index][3] ?? null` when inserting tasks (the 4th tuple element)
- Insert `seedActionConfigs` into `actionConfigs` after the integrations insert

- [ ] **Step 4: Update package exports if needed**

Add `"./action-config-fixture"` export to `packages/db/package.json` if tests need it directly (check if the test pattern imports fixtures or uses seed).

- [ ] **Step 5: Verify seed runs locally**

Run: `DATABASE_URL=postgresql://offboard:offboard@localhost:5432/offboard npm run seed --workspace=packages/db`
Expected: seed completes without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/offboarding.fixture.ts packages/db/src/seed-database.ts packages/db/src/action-config.fixture.ts packages/db/package.json
git commit -m "feat: update seed data with phase and action configs"
```

---

### Task 4: API endpoints for action configs

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/vercel.ts` (add DELETE export)

**Interfaces:**

- Consumes: Repository functions from Task 2 (`listActionConfigs`, `getActionConfig`, `createActionConfig`, `updateActionConfig`, `deleteActionConfig`)
- Produces: HTTP endpoints — `GET /api/action-configs`, `POST /api/action-configs`, `PUT /api/action-configs/:id`, `DELETE /api/action-configs/:id`

- [ ] **Step 1: Write failing tests**

In `apps/api/src/app.test.ts`, widen the `Payload` type to accept action config fields (`actionId?: string`, `enabled?: boolean`, `config?: Record<string, unknown>`, `phase?: string`). Then add these test cases:

```ts
it("lists action configs from seed", async () => {
  const res = await call("/action-configs");
  const list = await res.json();
  expect(res.status).toBe(200);
  expect(list.length).toBeGreaterThan(0);
  expect(list[0]).toEqual({
    id: expect.any(String),
    actionId: expect.any(String),
    enabled: expect.any(Boolean),
    config: expect.any(Object),
    phase: expect.any(String),
  });
});

it("creates an action config", async () => {
  const body = {
    actionId: "google::transfer_files",
    phase: "first-week",
    config: { target: "manager" },
  };
  const res = await call("/action-configs", "POST", body);
  const created = await res.json();
  expect(res.status).toBe(201);
  expect(created).toEqual({
    id: expect.any(String),
    actionId: "google::transfer_files",
    enabled: true,
    config: { target: "manager" },
    phase: "first-week",
  });
});

it("rejects a duplicate action_id", async () => {
  await call("/action-configs", "POST", { actionId: "dup::test", phase: "d0" });
  const res = await call("/action-configs", "POST", { actionId: "dup::test", phase: "d0" });
  expect(res.status).toBe(409);
});

it("updates an action config", async () => {
  const created = await (
    await call("/action-configs", "POST", { actionId: "upd::test", phase: "d0" })
  ).json();
  const res = await call(`/action-configs/${created.id}`, "PUT", { enabled: false, phase: "pre" });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id: created.id, enabled: false, phase: "pre" });
});

it("returns 404 when updating unknown config", async () => {
  const res = await call(`/action-configs/${missingCaseId}`, "PUT", { enabled: false });
  expect(res.status).toBe(404);
});

it("deletes an action config", async () => {
  const created = await (
    await call("/action-configs", "POST", { actionId: "del::test", phase: "d0" })
  ).json();
  const res = await call(`/action-configs/${created.id}`, "DELETE");
  expect(res.status).toBe(204);
});

it("rejects invalid action config", async () => {
  const noAction = await call("/action-configs", "POST", { phase: "d0" });
  const noPhase = await call("/action-configs", "POST", { actionId: "test::x" });
  expect(noAction.status).toBe(422);
  expect(noPhase.status).toBe(422);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=postgresql://offboard:offboard@localhost:5432/offboard npx vitest run --reporter=verbose` in `apps/api`
Expected: new tests FAIL (routes don't exist yet).

- [ ] **Step 3: Add TypeBox schemas and endpoints to `apps/api/src/app.ts`**

Define TypeBox types:

- `actionConfigRow`: Object with `id` (String), `actionId` (String), `enabled` (Boolean), `config` (Record String Unknown), `phase` (String)
- `actionPhase`: Union of Literals for the 5 valid phases

Add endpoints:

- `GET /action-configs` → `repos.listActionConfigs()`
- `POST /action-configs` → body `{ actionId: text, phase: actionPhase, enabled?: Boolean, config?: Object }`. Call `repos.createActionConfig(body)`. On unique violation (catch Postgres error code `23505`), return 409. Set status 201.
- `PUT /action-configs/:id` → params `{ id: uuid }`, body `{ enabled?: Boolean, config?: Object, phase?: actionPhase }`. Call `repos.updateActionConfig(id, body)`. Return 404 if null.
- `DELETE /action-configs/:id` → params `{ id: uuid }`. Call `repos.deleteActionConfig(id)`. Return 204 (empty body).

- [ ] **Step 4: Add DELETE export to `apps/api/src/vercel.ts`**

Add `export const DELETE = handle;` alongside the existing GET, POST, PUT, PATCH exports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL=postgresql://offboard:offboard@localhost:5432/offboard npx vitest run --reporter=verbose --coverage` in `apps/api`
Expected: all tests PASS, 100% coverage maintained.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/vercel.ts
git commit -m "feat: add CRUD API endpoints for action configs"
```

---

### Task 5: Vercel wiring + bundle rebuild

**Files:**

- Modify: `vercel.json`
- Rebuild: `api/offboard.mjs`

**Interfaces:**

- Consumes: API endpoints from Task 4
- Produces: deployed API routes for `/api/action-configs` and `/api/action-configs/:path*`

- [ ] **Step 1: Add rewrites to vercel.json**

Add before the SSR catch-all:

```json
{ "source": "/api/action-configs", "destination": "/api/offboard" },
{ "source": "/api/action-configs/:path*", "destination": "/api/offboard" }
```

- [ ] **Step 2: Rebuild the Vercel API bundle**

Run: `npx esbuild apps/api/src/vercel.ts --bundle --platform=node --format=esm --target=node22 --outfile=api/offboard.mjs --external:pg-native --banner:js='import{createRequire as _cr}from"module";const require=_cr(import.meta.url);'`
Expected: bundle compiles without errors.

- [ ] **Step 3: Run all tests one final time**

Run: `DATABASE_URL=postgresql://offboard:offboard@localhost:5432/offboard npx vitest run --coverage` in `apps/api`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add vercel.json api/offboard.mjs
git commit -m "feat: wire action-configs routes in Vercel"
```
