# Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire every page in the React SPA to the `apps/api` REST endpoints, replacing hardcoded fixtures with real data.

**Architecture:** A shared API client (`shared/api.ts`) with typed fetch functions sits between TanStack Query and the backend. Each page replaces its fixture with a `queryOptions` that calls the client. Mutations use `useMutation` or XState actors. A Vite proxy and a small Hono dev server enable local development.

**Tech Stack:** React 19, TanStack Query 5, TanStack Router, XState 5, Vite 8, Hono 4, `@hono/node-server` (dev only)

**Spec:** `docs/superpowers/specs/2026-11-20-frontend-integration-design.md`

## Global Constraints

- Node >= 22.18.0, pinned exact versions (no carets), `verbatimModuleSyntax: true`
- 100% test coverage for `packages/db` and `apps/api` — `apps/web` has no test infrastructure; manual verification via dev server
- Zero comments
- Existing component props: narrow types if the component never used the removed fields (e.g., list views accepting `CaseSummary[]` instead of `OffboardingCase[]`), but do not restructure component interfaces
- `VITE_API_URL` defaults to `/api`; Vite proxy forwards to the local API in dev
- DTO → UI type mapping lives in `api.ts` fetch functions — components receive their existing shapes

## Review Focus

1. **API unreachable in dev** — if the proxy target is down, Vite returns a 502 that TanStack Query retries silently. A developer seeing a blank page with no error should get a clear fetch error. Pin: Task 1, verify that `RouteError` renders when the API is stopped.
2. **Bulk import with invalid dates** — the API validates `deadline` as `z.string().date()` (YYYY-MM-DD only). A CSV with `15/11/2026` or `2026-11-32` must show a validation error in the review step, not a 400 after submission. Pin: Task 4, validate date format client-side in the CSV parser.
3. **Checklist toggle race condition** — rapid toggling sends overlapping PATCH requests. The last-write-wins behavior must not leave the UI showing a stale state. Pin: Task 3, the mutation uses `onSettled` to refetch, not just optimistic update.
4. **Empty database** — a freshly migrated database with no seed data must render every page without errors (empty lists, zero counts). Pin: Task 1, verify dashboard renders with an empty offboardings response.
5. **Equipment date formatting** — `scheduledDate` from the API is ISO (`2026-11-10`), but the UI shows `10 nov`. The API client must format using `Intl.DateTimeFormat("pt-BR")`. Pin: Task 2, verify date formatting in the equipment mapping.

---

### Task 1: Dev infrastructure, API client, and offboardings integration

**Files:**

- Create: `apps/api/src/dev.ts`
- Create: `apps/web/src/shared/api.ts`
- Modify: `apps/api/package.json` (add `@hono/node-server` devDep, update `dev` script)
- Modify: `apps/web/vite.config.ts` (add dev proxy)
- Modify: `apps/web/src/entities/offboarding.ts` (replace fixtures with API calls)
- Modify: `apps/web/src/app/router.tsx` (update case route loader, narrow types)

**Interfaces:**

- Consumes: `GET /offboardings` → `CaseSummary[]`, `GET /offboardings/:id` → `OffboardingCaseDto | null`
- Produces: `fetchOffboardings(): Promise<CaseSummary[]>`, `fetchOffboarding(id: string): Promise<OffboardingCase>`, `apiBase` constant, `offboardingsQuery`, `offboardingDetailQuery(caseId: string)`

- [ ] **Step 1: Add `@hono/node-server` to `apps/api`**

Add `"@hono/node-server": "2.1.11"` to `apps/api/package.json` devDependencies. Run `npm install`.

- [ ] **Step 2: Create `apps/api/src/dev.ts`**

`serve(app: Hono, port: number)` from `@hono/node-server`. Read `DATABASE_URL` from env, create client, repos, app. Listen on port 3001. Log the URL to stdout.

- [ ] **Step 3: Update `apps/api/package.json` dev script**

Change `"dev": "tsx watch src/index.ts"` to `"dev": "tsx watch src/dev.ts"`.

- [ ] **Step 4: Add Vite proxy for dev**

In `apps/web/vite.config.ts`, add `server.proxy` that forwards `/api` to `http://localhost:3001` with path rewrite stripping the `/api` prefix. Since `apiBase` defaults to `"/api"`, the browser fetches `/api/offboardings` → Vite proxy → `localhost:3001/offboardings`. No `.env.development` needed.

- [ ] **Step 5: Create `apps/web/src/shared/api.ts`**

Export `apiBase` read from `import.meta.env.VITE_API_URL ?? "/api"`.

Export `async function apiFetch<T>(path: string, init?: RequestInit): Promise<T>` — calls `fetch(apiBase + path, init)`, throws on `!response.ok` (include `response.status` and `response.statusText` in the error), returns `response.json()`.

Export `fetchOffboardings(): Promise<CaseSummary[]>` — calls `apiFetch<CaseSummary[]>("/offboardings")`.

Export `fetchOffboarding(id: string): Promise<OffboardingCase>` — calls `apiFetch<OffboardingCaseDto>("/offboardings/" + id)`, maps the response: drop `caseId` and `position` from each task in `tasks`, returning the `OffboardingCase` shape.

Import the types from `entities/offboarding.ts` (they stay defined there). Import `OffboardingCaseDto` as a local type (matches the API response: `CaseSummary & { tasks: Array<{ id, caseId, title, team, status, position }> }`).

- [ ] **Step 6: Rewrite `apps/web/src/entities/offboarding.ts`**

Remove the `fixtures` array, `CaseFixture` type, and `listOffboardings` function.

Keep `CaseSummary`, `Task`, `OffboardingCase` types — same shapes.

Keep `formatDeadline`, `offboardingDepartments`, `offboardingTeams`.

Hardcode `offboardingDepartments` as `["Marketing", "Tecnologia", "Operações", "Financeiro", "Produto"]` and `offboardingTeams` as `["RH e DP", "TI", "Gestão", "Financeiro", "Jurídico", "Facilities", "Pessoa desligada"]`.

Rewrite `offboardingsQuery`:

```typescript
export const offboardingsQuery = queryOptions({
  queryKey: ["offboardings"],
  queryFn: fetchOffboardings,
});
```

Add `offboardingDetailQuery`:

```typescript
export function offboardingDetailQuery(caseId: string) {
  return queryOptions({
    queryKey: ["offboardings", caseId],
    queryFn: () => fetchOffboarding(caseId),
  });
}
```

- [ ] **Step 7: Update `apps/web/src/app/router.tsx`**

Import `offboardingDetailQuery` from `entities/offboarding.ts`.

Change the `caseRoute.loader` from:

```typescript
loader: async ({ context, params }) => {
  const cases = await context.queryClient.ensureQueryData(offboardingsQuery);
  getCase(cases, params.caseId);
},
```

to:

```typescript
loader: async ({ context, params }) => {
  await context.queryClient.ensureQueryData(offboardingDetailQuery(params.caseId));
},
```

Change the `Case` component from:

```typescript
const { data: cases } = useSuspenseQuery(offboardingsQuery);
const offboardingCase = getCase(cases, caseId);
```

to:

```typescript
const { data: offboardingCase } = useSuspenseQuery(offboardingDetailQuery(caseId));
```

The `getCase` function and its `notFound()` throw are no longer needed for the Case component — the API returns 404 for unknown IDs, which `apiFetch` throws as an error, and TanStack Router's error boundary handles it. Remove `getCase` if no other code uses it (the dashboard loader still uses `offboardingsQuery` directly).

The `Dashboard` and `Cases` wrapper components stay unchanged — they already use `useSuspenseQuery(offboardingsQuery)` which now fetches from the API.

- [ ] **Step 8: Verify**

Run `npm run dev --workspace=apps/api` (needs `DATABASE_URL` in env). In a second terminal, run `npm run dev --workspace=apps/web`. Open the browser:

- `/painel` shows the dashboard with real data (or empty state with zero counts)
- `/desligamentos` shows the cases list
- Click a case → `/desligamentos/:uuid` shows detail with tasks
- Stop the API server → reload → `RouteError` renders

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/dev.ts apps/api/package.json apps/web/vite.config.ts apps/web/src/shared/api.ts apps/web/src/entities/offboarding.ts apps/web/src/app/router.tsx package-lock.json
git commit -m "feat(web): add API client and wire offboardings to real data"
```

---

### Task 2: Read-only pages (equipment, integrations, access, billing)

**Files:**

- Modify: `apps/web/src/shared/api.ts` (add fetch functions)
- Modify: `apps/web/src/features/asset-returns/equipment-page.tsx`
- Modify: `apps/web/src/features/integrations/integrations-page.tsx`
- Modify: `apps/web/src/features/app-access/access-page.tsx`
- Modify: `apps/web/src/features/billing/billing-page.tsx`
- Modify: `apps/web/src/app/router.tsx` (add loaders)

**Interfaces:**

- Consumes: `apiFetch` from `shared/api.ts` (Task 1), `GET /equipment`, `GET /integrations`, `GET /access/beneficiaries`, `GET /access/team-members`, `GET /billing/plans`
- Produces: `fetchEquipment`, `fetchIntegrations`, `fetchBeneficiaries`, `fetchTeamMembers`, `fetchPlans` — each returns the UI-shaped type after DTO mapping

- [ ] **Step 1: Add fetch functions to `apps/web/src/shared/api.ts`**

Each function calls `apiFetch` and maps the DTO to the UI type:

`fetchEquipment(): Promise<Equipment[]>` — maps `EquipmentDto` → `Equipment`:

- `scheduledDate: string | null` → `date: { iso, label } | null` (format label with `Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" })`)
- `method` stays as-is (the API returns the same free-text strings)
- `status` stays as-is (same enum values)

`fetchIntegrations(): Promise<Integration[]>` — maps `IntegrationDto` → `Integration`:

- `lastActivity: string | null` → for `status: "connected"`, rename to `update`; for `status: "disconnected"`, omit it
- Result is the discriminated union: `{ name, purpose } & ({ status: "connected", update: string } | { status: "disconnected" })`

`fetchBeneficiaries(): Promise<Beneficiary[]>` — maps `BeneficiaryDto` → UI shape:

- `accessUntil` → `until` (format with DateTimeFormat to `"30 abr"` style, or pass through if already formatted)

`fetchTeamMembers(): Promise<TeamMember[]>` — maps `TeamMemberDto` → UI shape:

- `accessScope` → `access`, `securityStatus` → `security`

`fetchPlans(): Promise<Plan[]>` — maps `PlanDto` → UI shape:

- `priceCents` → `price` (divide by 100), `activeLicenses` → `active`, `costCenter` → `area`

Export `queryOptions` for each: `equipmentQuery`, `integrationsQuery`, `beneficiariesQuery`, `teamMembersQuery`, `plansQuery`.

- [ ] **Step 2: Wire equipment page**

In `equipment-page.tsx`: remove the hardcoded `equipment` array. Import `equipmentQuery` from `shared/api.ts`. Add `useSuspenseQuery(equipmentQuery)` at the top of `EquipmentPage`. Use the fetched data where the constant was used.

The `Equipment` type stays defined locally — the API client maps to this shape.

- [ ] **Step 3: Wire integrations page**

In `integrations-page.tsx`: remove the hardcoded `integrations` array. Import `integrationsQuery`. Add `useSuspenseQuery(integrationsQuery)`. The `Integration` type stays local.

- [ ] **Step 4: Wire access page**

In `access-page.tsx`: remove the hardcoded `beneficiaries` and `team` arrays. Import `beneficiariesQuery` and `teamMembersQuery`. Add two `useSuspenseQuery` calls. Types stay local.

- [ ] **Step 5: Wire billing page**

In `billing-page.tsx`: remove the hardcoded `plans` array. Import `plansQuery`. Add `useSuspenseQuery(plansQuery)`. The `plans` type stays local.

- [ ] **Step 6: Add route loaders in `router.tsx`**

Add `loader` to each route that calls `context.queryClient.ensureQueryData(...)` with the matching query:

- `equipmentRoute` → `equipmentQuery`
- `integrationsRoute` → `integrationsQuery`
- `accessRoute` → `beneficiariesQuery` and `teamMembersQuery` (both in parallel with `Promise.all`)
- `plansRoute` → `plansQuery`

- [ ] **Step 7: Verify**

With both dev servers running, visit each page:

- `/bens-e-coleta` — equipment table with formatted dates
- `/integracoes` — integration list with status badges
- `/acessos-ao-app` — beneficiaries table + team table
- `/planos-e-gastos` — plans with prices in BRL (divided by 100)

Filter dropdowns on equipment and integrations pages should still work (client-side filtering on the full dataset).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/shared/api.ts apps/web/src/features/asset-returns/equipment-page.tsx apps/web/src/features/integrations/integrations-page.tsx apps/web/src/features/app-access/access-page.tsx apps/web/src/features/billing/billing-page.tsx apps/web/src/app/router.tsx
git commit -m "feat(web): wire equipment, integrations, access, billing to API"
```

---

### Task 3: Checklist integration with mutations

**Files:**

- Modify: `apps/web/src/shared/api.ts` (add checklist functions)
- Modify: `apps/web/src/features/checklist/checklist-page.tsx`
- Modify: `apps/web/src/app/router.tsx` (add checklist loader)

**Interfaces:**

- Consumes: `apiFetch` from `shared/api.ts`, `GET /checklist`, `PATCH /checklist/:id`
- Produces: `fetchChecklist`, `toggleChecklistRule`, `checklistQuery`

- [ ] **Step 1: Add checklist functions to `api.ts`**

`fetchChecklist(): Promise<{ baseRules: ChecklistRule[], optionalRules: ChecklistRule[] }>` — calls `apiFetch<ChecklistRuleDto[]>("/checklist")`, splits by `required` field: `required: true` → `baseRules`, `required: false` → `optionalRules`. Each rule maps to `{ id, title, description, team, timing, enabled }`.

`toggleChecklistRule(id: string, enabled: boolean): Promise<void>` — calls `apiFetch("/checklist/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) })`.

Export `checklistQuery` as a `queryOptions`.

- [ ] **Step 2: Rewrite checklist page**

In `checklist-page.tsx`:

- Remove the hardcoded `baseRule` and `optionalRules` constants
- Import `checklistQuery`, `toggleChecklistRule` from `shared/api.ts`
- Import `useSuspenseQuery`, `useMutation`, `useQueryClient` from `@tanstack/react-query`
- Use `useSuspenseQuery(checklistQuery)` to get `{ baseRules, optionalRules }`
- Replace `useState<Set<string>>` with the `enabled` field from each rule
- Add `useMutation` for toggle: `mutationFn: ({ id, enabled }) => toggleChecklistRule(id, enabled)`, `onSettled: () => queryClient.invalidateQueries({ queryKey: checklistQuery.queryKey })`
- The `onCheckedChange` handler calls `mutate({ id: rule.id, enabled: checked })`
- Remove the "As alterações valem para esta prévia e não são salvas." disclaimer text — changes are now persisted
- Handle multiple base rules (render each with the "Obrigatória" badge, no toggle)

- [ ] **Step 3: Add checklist loader in `router.tsx`**

Add `loader` to `checklistRoute` that calls `context.queryClient.ensureQueryData(checklistQuery)`.

- [ ] **Step 4: Verify**

- `/checklist-automatico` renders rules from the API
- Toggle a rule → the switch flips immediately → page reload shows the persisted state
- Rapid toggling → final state is consistent after refetch

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/shared/api.ts apps/web/src/features/checklist/checklist-page.tsx apps/web/src/app/router.tsx
git commit -m "feat(web): wire checklist page with toggle mutations"
```

---

### Task 4: Bulk import submission with extended CSV

**Files:**

- Modify: `apps/web/src/shared/api.ts` (add bulk create function)
- Modify: `apps/web/src/features/bulk-import/import-machine.ts`
- Modify: `apps/web/src/features/bulk-import/import-page.tsx`

**Interfaces:**

- Consumes: `apiFetch` from `shared/api.ts`, `POST /offboardings/bulk`, `queryClient` from `app/router.tsx`
- Produces: `bulkCreateOffboardings(rows)`, updated `ImportRow` type with `role` and `deadline`

- [ ] **Step 1: Add bulk create function to `api.ts`**

`bulkCreateOffboardings(rows: Array<{ name: string, role: string, department: string, deadline: string }>): Promise<{ id: string }[]>` — calls `apiFetch("/offboardings/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) })`.

- [ ] **Step 2: Extend `ImportRow` type in `import-machine.ts`**

Add `role: string` and `deadline: string` to `ImportRow`.

- [ ] **Step 3: Update CSV parser in `import-machine.ts`**

Change the column validation from:

```
columns?.length !== 2 || columns[0] !== "nome" || columns[1] !== "departamento"
```

to check for 4 columns: `nome`, `cargo`, `departamento`, `prazo`.

Error message: `"A primeira linha do CSV precisa ter as colunas nome, cargo, departamento e prazo."`

Update the row mapping to extract all 4 fields. Validate that all 4 are non-empty. Add date format validation for `prazo`: must match `YYYY-MM-DD` (regex `^\d{4}-\d{2}-\d{2}$`) — if invalid, mark the row as `{ kind: "invalid", issue: "O prazo deve estar no formato AAAA-MM-DD." }`.

- [ ] **Step 4: Add `submitting` state to the XState machine**

Change the `confirm` transition target from `"complete"` to `"submitting"`.

Add a new `submitting` state between `review` and `complete`:

```typescript
submitting: {
  invoke: {
    src: fromPromise(async ({ input }) => bulkCreateOffboardings(input)),
    input: ({ context }) => context.rows
      .filter((row) => row.kind === "valid")
      .map(({ name, role, department, deadline }) => ({ name, role, department, deadline })),
    onDone: "complete",
    onError: {
      target: "review",
      actions: assign({
        error: ({ event }) =>
          event.error instanceof Error
            ? event.error.message
            : "Não foi possível cadastrar. Tente novamente.",
      }),
    },
  },
},
```

Import `bulkCreateOffboardings` from `shared/api.ts`.

- [ ] **Step 5: Update `import-page.tsx`**

Add `role` and `deadline` columns to `previewColumns` and `columnsWithIssues`:

```typescript
{ id: "role", accessorFn: ({ role }) => role || "—", header: "Cargo" },
{ id: "deadline", accessorFn: ({ deadline }) => deadline || "—", header: "Prazo" },
```

Add a `submitting` state render block (between `review` and `complete`):

```tsx
{step === "submitting" && (
  <section ...>
    <h2>Cadastrando...</h2>
    <p>{rows.length} pessoas sendo cadastradas.</p>
  </section>
)}
```

Update the `complete` state text:

- `"Prévia concluída"` → `"Cadastro concluído"`
- `"X pessoas revisadas"` → `"X pessoas cadastradas"`

If the `review` state has `error` in context (from a failed submit), show the error message above the action buttons.

Update the `ImportGuide` CSV sample:

```
nome,cargo,departamento,prazo
Pessoa Exemplo,Analista,Marketing,2026-12-15
```

Remove the bottom privacy disclaimer: `"Prévia local. Nenhum desligamento será cadastrado."`.

Add query invalidation: in `ImportPage`, when the machine enters `complete`, call `queryClient.invalidateQueries({ queryKey: ["offboardings"] })`. Import `useQueryClient` from `@tanstack/react-query` and `queryClient` from `app/router.tsx` (or use the hook).

Update the `stages` array: `["Arquivo", "Revisão", "Conclusão"]` → `["Arquivo", "Revisão", "Cadastro"]` (the third step is now an actual operation, not just a preview conclusion).

- [ ] **Step 6: Verify**

Create a test CSV with 4 columns:

```csv
nome,cargo,departamento,prazo
Maria Silva,Analista,Marketing,2026-12-01
João Santos,Engenheiro,Tecnologia,2026-12-15
```

- Upload → review shows all 4 columns
- Confirm → submitting state shows → complete state shows "2 pessoas cadastradas"
- Navigate to `/desligamentos` → the imported cases appear
- Upload a CSV with invalid date `prazo: "15/12/2026"` → row shows validation error
- Upload a CSV with 2 columns → error "A primeira linha do CSV precisa ter as colunas nome, cargo, departamento e prazo."

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/shared/api.ts apps/web/src/features/bulk-import/import-machine.ts apps/web/src/features/bulk-import/import-page.tsx
git commit -m "feat(web): extend CSV to 4 columns and submit bulk import to API"
```
