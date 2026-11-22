# Integrations + Actions System Design

## Intent

The Offboard platform currently tracks offboarding cases with manually toggled tasks and integration status flags that don't connect to anything real. Users want **configurable actions** that execute automatically against connected services when an offboarding progresses — sending emails, blocking Google accounts, posting Slack messages, scheduling equipment pickups.

### Why

Manual offboarding is error-prone and slow. When someone leaves, HR has to remember to notify IT, IT has to manually block accounts, facilities has to schedule collection, finance has to cancel cards. Actions automate the parts that integrations can handle, so the checklist becomes a mix of manual tasks and automated actions.

## Goals

- Users can browse available actions per connected integration
- Users can enable/disable actions and configure their parameters
- Actions link to checklist phases (pré, D0, primeira semana, etc.)
- When an offboarding reaches a phase, enabled actions for that phase execute
- Execution is tracked with status and results per offboarding

## Non-goals

- OAuth flows for real service connections (future work, starts with email)
- Real-time webhooks from external services
- Action dependency chains (action B waits for action A)
- Multi-tenant / per-organization configuration

## Anti-goals

- Actions that run without user awareness or tracking
- Replacing the manual checklist — actions complement it, don't replace it

## Constraints

- Supabase PostgreSQL (production), local PostgreSQL (dev)
- Drizzle ORM — migrations must be written manually (drizzle-kit needs TTY)
- Elysia API with TypeBox validation
- Vercel serverless — actions must complete within 10s function timeout
- Each PR must be a separate incremental step
- 100% test coverage on API code

## Approaches Considered

### A) Actions as a separate entity from tasks

New `actions` table decoupled from checklist. Simpler but duplicates the concept of "things that happen in an offboarding."

### B) Actions as checklist step extensions

Steps gain an `action` typed field. Natural flow but ties actions to the checklist template and makes non-task actions awkward.

### C) Hybrid — independent actions linkable to phases (chosen)

Actions live as their own entity with a catalog, configuration layer, and execution tracking. They're associated with checklist phases for timing but independent from tasks. This matches the user's mental model: "the user configures which actions to run in Ações."

**Why C:** The user explicitly said actions are configurable per offboarding and determine what happens automatically. They're not 1:1 with tasks — one integration might have multiple actions, and some actions don't map to any manual task.

## Architecture

### Frontend catalog (hardcoded, like current integration catalog)

The list of available actions per integration lives in the frontend. This matches the existing pattern where `catalog` in `integrations-page.tsx` defines all integrations with their categories, icons, and descriptions.

```
ActionTemplate {
  id: string              // "google::block_account"
  integrationName: string // "Google Workspace"
  label: string           // "Bloquear conta"
  description: string     // "Suspende a conta Google do colaborador"
  defaultPhase: Phase     // "d0"
  configFields: Field[]   // optional configurable parameters
}
```

### Database tables

**action_configs** — user's enabled actions and their settings:

```
action_configs {
  id          uuid PK DEFAULT gen_random_uuid()
  action_id   varchar(100) NOT NULL        -- references catalog template id
  enabled     boolean NOT NULL DEFAULT true
  config      jsonb NOT NULL DEFAULT '{}'   -- user parameters (channel, template, etc.)
  phase       varchar(50) NOT NULL          -- checklist phase for triggering
  created_at  timestamp DEFAULT now()
  updated_at  timestamp DEFAULT now()
  UNIQUE(action_id)
}
```

**action_runs** — execution tracking per offboarding:

```
action_runs {
  id                   uuid PK DEFAULT gen_random_uuid()
  offboarding_case_id  uuid NOT NULL FK -> offboarding_cases.id ON DELETE CASCADE
  action_config_id     uuid NOT NULL FK -> action_configs.id ON DELETE CASCADE
  status               action_run_status NOT NULL DEFAULT 'pending'
  result               jsonb
  started_at           timestamp
  completed_at         timestamp
  created_at           timestamp DEFAULT now()
}

action_run_status ENUM ('pending', 'running', 'completed', 'failed', 'skipped')
```

### API endpoints

```
GET    /api/action-configs              -- list all configured actions
POST   /api/action-configs              -- create/enable an action config
PUT    /api/action-configs/:id          -- update config or disable
DELETE /api/action-configs/:id          -- remove an action config

GET    /api/offboardings/:id/action-runs -- list runs for an offboarding
POST   /api/offboardings/:id/execute     -- trigger actions for current phase
```

### UI

New route `/acoes` (Ações) with:

- Action catalog grouped by integration (like integrations page by category)
- Each action card shows: integration logo, action name, description, phase
- Toggle to enable/disable, expandable config form for parameters
- Status of connection required (linked to integration status)

On the offboarding detail page:

- New section showing action runs with status badges
- Manual trigger button per phase

### Action catalog (initial)

| Integration         | Action                       | Description               | Default Phase   |
| ------------------- | ---------------------------- | ------------------------- | --------------- |
| Google Workspace    | Bloquear conta               | Suspende a conta Google   | D0              |
| Google Workspace    | Transferir arquivos          | Move Drive para gestor    | Primeira semana |
| Slack               | Desativar usuário            | Remove do workspace Slack | D0              |
| Slack               | Enviar mensagem              | Posta aviso em canal      | D0              |
| Email               | Enviar e-mail ao colaborador | Email customizável        | D0              |
| Email               | Enviar e-mail ao gestor      | Notifica o gestor         | Pré             |
| Transportadora      | Gerar etiqueta Correios      | Cria logística reversa    | Primeira semana |
| Transportadora      | Rastrear coleta              | Consulta status           | Segunda semana  |
| Sistema de folha    | Enviar rescisão              | Transmite ao eSocial      | D0              |
| Clínica ocupacional | Agendar exame                | Agenda demissional        | Pré             |

### Tasks phase column

The existing `tasks` table has no `phase` column — when `createTasksFromChecklist()` generates tasks, the phase is discarded. For automatic triggering, we need to persist the phase on each task.

**Migration**: `ALTER TABLE tasks ADD COLUMN phase varchar(50)`. Existing tasks get `phase = NULL` (manual-only offboardings created before this feature). The checklist generation flow will be updated to include the phase.

### Execution flow

1. User enables actions in `/acoes` and configures parameters
2. When an offboarding is created, `action_runs` are created for all enabled actions (status: pending), and tasks are created with their `phase` set
3. **Automatic trigger**: when a task status changes to `done`, the system checks if all tasks for that phase are now done. If yes, pending `action_runs` for that phase auto-execute
4. **Manual fallback**: a "Executar fase" button on the offboarding detail page triggers pending runs for a chosen phase regardless of task completion
5. Each run calls the integration's handler, updates status to `running` → `completed`/`failed`
6. Results are stored as JSONB (error messages, response data, etc.)

### Config deletion behavior

`action_runs` has `ON DELETE CASCADE` from `action_config_id`. Deleting an action config removes its pending runs from future offboardings. Completed runs are historical but not yet needed for audit. Future work can add soft delete if audit trails are required. (Builder's call.)

### PR breakdown

1. **Add phase to tasks + schema for action_configs** — migrations, Drizzle schema, CRUD endpoints, tests
2. **UI: Ações page** — action catalog display, enable/disable toggles, config forms
3. **Schema + API for action_runs** — table, migration, endpoints, tests
4. **UI: Action runs on offboarding detail** — status display, manual trigger button
5. **Execution engine** — handler registry, auto-trigger on phase completion, manual fallback
6. **Email action implementation** — first real integration handler
7. **Google/Slack stubs** — prepared handlers awaiting OAuth (future)

## Builder's decisions

- Action config is per-action unique (one config per action template), not per-offboarding. All offboardings share the same action configuration. Future work could add per-offboarding overrides.
- The catalog lives in the frontend to avoid a migration every time we add a new action type. The DB only stores user preferences.
- Phase association is on action_configs, not action_runs, so changing the phase applies to future offboardings.
- Execution is synchronous within the Vercel function timeout. Long-running actions need an async pattern (future work).
