# Frontend Integration Design (Phase 3)

## Intent

Wire the existing React SPA to the `apps/api` REST endpoints built in Phase 2. Every page currently renders hardcoded fixtures — replace them with real API calls so the UI reflects the Postgres database.

## Goals

- Every page that shows data fetches it from the API
- Bulk import submits to the API, not just previews locally
- Checklist toggle persists via the API
- Loading and error states use the existing TanStack Query + Suspense infrastructure
- No visible regressions — pages render the same shapes, just from real data

## Non-Goals

- New UI for endpoints without screens (single offboarding create, delete, task create, task status update)
- Authentication or authorization
- Optimistic updates beyond checklist toggle
- Offline support or caching strategy beyond TanStack Query defaults

## Anti-Goals

- Pages that silently swallow API errors — every fetch failure must surface through the existing `RouteError` component
- N+1 query patterns — the list view must get task counts in a single request, not one query per case

## Constraints

- Node >= 22.18.0, pinned exact versions, `verbatimModuleSyntax: true`
- 100% test coverage for new/modified code in `packages/db` and `apps/api`
- Zero comments
- Frontend tests: the web app has no test infrastructure today — adding vitest to `apps/web` is in scope only if the work naturally requires it; otherwise, manual verification via the dev server is sufficient
- Existing component props and route structure must not change — integration happens at the data layer, not the UI layer
- `VITE_API_URL` environment variable for API base URL; defaults to `/api` for Vercel same-origin deployment

## Approaches

### Chosen: Shared API client + per-page query hooks

Create `apps/web/src/shared/api.ts` with typed fetch functions. Each page replaces its fixture with a `queryOptions` call that uses these functions. Mutations use `useMutation` from TanStack Query.

Why: the codebase already uses `queryOptions` + `useSuspenseQuery` with router loaders. This extends the existing pattern with minimal new concepts.

### Rejected: OpenAPI codegen

A generated client from an OpenAPI spec would automate the type mapping. Rejected because: adds a build step, the API has only 15 endpoints, and the codebase doesn't use code generation anywhere.

### Rejected: Direct fetch per page

Each page could fetch directly without a shared client. Rejected because: duplicates base URL handling and error logic across 7+ files.

## Design

### 1. Backend change: task count aggregation

The offboarding list view shows `completed` and `total` task counts per case. The current `findAll()` returns flat offboarding records without task data.

Add `findAllWithProgress()` to the offboarding repository:

- `LEFT JOIN` on tasks table, `COUNT(*)` for total, `COUNT(*) FILTER (WHERE status = 'done')` for completed
- Returns `Array<Offboarding & { completed: number; total: number }>`
- Update `GET /offboardings` to use this method

### 2. API client module

`apps/web/src/shared/api.ts`:

- Reads `VITE_API_URL` from `import.meta.env`, defaults to `"/api"`
- Exports one async function per endpoint group: `fetchOffboardings()`, `fetchOffboarding(id)`, `fetchTasks(caseId)`, `fetchEquipment(status?)`, `fetchIntegrations(status?)`, `fetchBeneficiaries()`, `fetchTeamMembers()`, `fetchPlans()`, `fetchChecklist()`, `toggleChecklistRule(id, enabled)`, `bulkCreateOffboardings(rows)`
- Each function calls `fetch()`, checks `response.ok`, throws on error, returns typed JSON
- Types mirror the existing frontend types (`CaseSummary`, `Task`, etc.)

### 3. Query integration per page

#### Offboardings (central hub)

`entities/offboarding.ts`:

- Replace `listOffboardings()` fixture with `fetchOffboardings()` from the API client
- `offboardingsQuery` keeps the same `queryKey` and shape
- Remove the `fixtures` array and `CaseFixture` type
- Keep `offboardingDepartments` and `offboardingTeams` — compute them from the fetched data, or hardcode them (they're filter options, not data)

Case detail: add a `offboardingDetailQuery(caseId)` that fetches `GET /offboardings/:id` + `GET /offboardings/:caseId/tasks` in parallel and combines them into the existing `OffboardingCase` shape. Update the case route's loader to use this query.

#### Self-contained pages

Each page (integrations, equipment, access, billing, checklist) follows the same pattern:

1. Move the hardcoded array out, replace with a `queryOptions` that calls the API client
2. Wrap the component body in `useSuspenseQuery` to get the data
3. Add a `loader` to the route in `router.tsx` that calls `ensureQueryData`

#### Bulk import mutation

In `import-machine.ts`, the `confirm` transition currently just moves to `complete`. Wire it to invoke `bulkCreateOffboardings(rows)` via a `fromPromise` actor, then invalidate the offboardings query on success.

#### Checklist mutation

In `checklist-page.tsx`, the toggle currently flips local state. Wire it to call `toggleChecklistRule(id, enabled)` via `useMutation`, with `onMutate` for optimistic update and `onError` for rollback. Remove the "preview only" disclaimer.

### 4. Environment configuration

- `apps/web/.env.development`: `VITE_API_URL=http://localhost:3000` (local dev)
- `apps/web/.env.production`: `VITE_API_URL=/api` (Vercel same-origin)
- Vercel rewrites `/api/*` to the `apps/api` serverless function (documented, not implemented — Vercel config is out of scope)

### 5. Bulk import CSV format

The current CSV parser accepts only `nome` and `departamento`. The API requires `name`, `role`, `department`, and `deadline`. Extend the CSV format to four columns: `nome`, `cargo`, `departamento`, `prazo`. Update the import machine validation and preview table accordingly.

### 6. Builder check resolutions

- **Task count aggregation already exists** — `DrizzleOffboardingRepository.list()` already joins tasks and returns `completed`/`total`. No backend change needed.
- **DTO shape mapping** lives in the `api.ts` fetch functions — components keep their current props.
- **Client-side filtering** — fetch the full dataset, filter in the component (UI needs totals/metrics).
- **Mutation errors** — checklist toggle: one request per click, errors show inline via mutation state. Import: add a `submitting` state with error handling that returns to `review`.
- **`apps/web` coverage** — no test infrastructure exists; manual verification via dev server is sufficient.
- **Filter lists** — `offboardingDepartments` and `offboardingTeams` stay hardcoded for v1.
- **IDs** — UUIDs replace fixture slugs naturally.
- **API base URL** — assumes Vercel rewrite strips `/api` prefix.

### 7. What's left to the builder

- Error message copy if the API is unreachable (the existing `RouteError` component handles this generically)
- Exact column header names and validation messages for the extended CSV format
