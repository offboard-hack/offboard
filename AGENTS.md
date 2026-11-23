# Offboard

## API and shared database

- Keep Elysia composition in `apps/api/src/app.ts` and runtime entry points in `apps/api/src`. Put routes, validation, services, repositories, and feature tests under `apps/api/src/features/<feature>`. Wire dependencies between slices explicitly in the app composition.
- Keep Drizzle schemas, inferred database types, relations, migrations, connection setup, and developer seeds in `packages/db`. Keep workflow queries and persistence behavior in the API feature that owns them.
- Export the composed Elysia `App` as a type-only contract. Use Eden via `@offboard/api-client` for Offboard API calls. Infer response and body types from the client with `Treaty.Data` and `Parameters`. Keep locally defined types for UI state and form validation.
- Use the web app’s shared API client factory for SSR and browser calls so session cookies and private caching rules apply consistently.
- Keep API features independent. Import within a feature or from `shared`, and pass cross-feature services through app composition. Feature tests may use the repository composition to set up integration data.

## Frontend

### Feature slices

- Keep composition, the shell, and TanStack Start route setup in `apps/web/src/app`.
- Keep each workflow in its own directory under `apps/web/src/features`. Colocate its screens, workflow state, and fixtures used only by that slice.
- Put domain types and data shared by multiple features in `apps/web/src/entities`. Keep general UI primitives in `apps/web/src/shared/ui` and the Tailwind theme in `apps/web/src/styles.css`.
- Features can depend on `entities` and `shared`. Compose workflows and wire routes in `app`. Cross-feature data should move through a shared domain model or explicit inputs.
- Keep web imports directed from `app` through `features` and `entities` to `shared`. Features may use their own slice, entities, and shared modules. `npm run lint` checks these rules and workspace boundaries.
- Use TanStack Query for server state, TanStack Start routes for shareable navigation and filters, TanStack Table for tabular state, and XState for multi-step workflows. Keep person-name searches local to the page.

### TanStack Start skills

- For TanStack Start work in `apps/web`, start with [React Start](.agents/skills/react-start/SKILL.md). Use [Start Core](.agents/skills/start-core/SKILL.md) for server functions, middleware, execution boundaries, API routes, authentication, and deployment. Use [Start Server Core](.agents/skills/start-server-core/SKILL.md) for the server runtime and request handling. The bundled subskills live alongside their respective entry points.

### Adding a portal screen

1. Start from [Equipe](apps/web/src/app/routes/_portal.equipe.tsx) for an API-backed list, [Planos e gastos](apps/web/src/app/routes/_portal.planos-e-gastos.tsx) for a fixture-backed screen, or [Checklist](apps/web/src/app/routes/_portal.checklist-automatico.tsx) for a browser-local draft with server actions. Register the file route under `app/routes/_portal.<path>.tsx`, add the title in `head`, and use `requirePortalAccess` for permissions beyond portal sign-in. Add a sidebar entry in `app/portal.tsx` only for primary destinations.
2. Validate URL filters with Zod in `validateSearch`. Define shared pagination with `listSearchSchema` and connect the route's navigation using `listPagination`. Give additional tables their own pagination state. Keep sorting, column visibility, and person-name search local unless the workflow explicitly requires shareable state.
3. Define a single `queryOptions` per read. Own it in the feature when only that feature uses it, or in `entities` when several features use it. Use the shared API client and pass Query's abort signal to reads. Load page-critical queries with `context.queryClient.ensureQueryData` and read the same options with `useSuspenseQuery`. Load independent queries in parallel. Use `useQuery` only when the result can arrive after the main content.
4. Reuse `ListPage`, `ListBreadcrumb`, `DataTable` and the existing shadcn primitives. Use `lazyRouteComponent` for the feature entry or an app-level route binding when multiple features compose the page. Keep placeholders inside `ListPendingPage` and match the layout they replace. Add a route fallback for routes that can wait on required data and keep smaller deferred reads scoped to the affected cells or panels.
5. Use TanStack Form and Zod for submission, and TanStack Query mutations for writes. Keep the action's pending and error feedback near its trigger. Invalidate the owning query family after writes. Use optimistic updates only when the UI can restore every cache entry it changed.

### Rendering and cache

- Keep portal routes on per-request SSR with a fresh QueryClient and private, no-store responses. Static prerendering is for public, session-independent content only. Let the portal recheck session access during navigation because permissions may be revoked. Client intent preloading uses Query's freshness policy, so keep Router's preload stale time at zero.
- Use finite, explicit query freshness based on the data. Offboarding and administrative records use 30 seconds, tracking uses 60 seconds. Keep detail keys under their list prefix so one invalidation refreshes both. When a list already contains the full matching case, seed the detail with that row and its original freshness timestamp. Return `notFound()` for missing route records and preserve the route error boundary for failed reads.
- Read local or session storage only after hydration. When a screen combines browser state with required server data, load the server data in the route and gate only the browser-dependent editor. Preserve a failed save as a draft. For Checklist, retry deletions only against row IDs previously loaded by or created for that draft.

### Components and visual system

- Use TanStack Form and Zod for forms. Show field-level validation next to the control and pass parsed values to the submit handler.
- Use shared shadcn/ui Base components whenever there is a matching interactive component. Use `Select` for choosing a value, `DropdownMenu` for actions, `Combobox` for searchable choices, and `Sheet`, `Drawer`, or `Dialog` for modal surfaces. Prefer the existing shared implementation when one exists.
- Use shadcn/ui for buttons, inputs, toggles, switches, and progress. Keep semantic links, tables, landmarks, and native file picking where their platform behavior fits the task.
- Use stock Tailwind utilities and shadcn/ui variants. Use shadcn preset `b3kul0ngY` for Maia component styles, theme tokens, Nunito Sans, and Hugeicons. Preserve the preset’s rounded inputs, buttons, and select triggers when adapting a reference layout. Use stock variants and match control heights when controls share a toolbar.
- Keep working surfaces flat with thin dividers. Use subtle gradients on summary cards in the corresponding icon color. Apply the shared `menu-tint` utility to select, dropdown, and submenu surfaces. Keep global CSS limited to theme setup and shared visual utilities.
- Use shadcn/ui and Base UI state attributes for input and overlay transitions. Keep motion brief and interruptible, honor reduced-motion preferences, and give every gesture an equivalent visible control or keyboard path.

### Navigation and data views

- Use the shared shadcn/sidebar for the app shell and group links by workflow. Keep the sidebar for primary destinations. Expose bulk import via **Importar** in **Desligamentos**, and mark **Desligamentos** active during import.
- Use the shared shadcn breadcrumb to orient the user on Desligamentos. Keep the accessible page heading and omit a duplicate visible heading or introductory block.
- Adapt reference layouts using Offboard’s domain data and Brazilian Portuguese labels. Derive summary counts, deadline statuses, progress, and pending teams from existing records. Derive deadline status in the workspace timezone. Add fields or period comparisons only when the underlying data supports them.
- Compose list views with shared `ListPage` for the breadcrumb, accessible heading, and optional summary cards. Use the shared DataTable panel by default. Use the embedded variant for tables inside workflows such as CSV review. Place labeled filters together, followed by the search and actions toolbar, the table, and a result summary or pagination where useful. Keep controls available in empty states so filters can be reset. Use Hugeicons with visible text on workflow and modal footer actions. Use an outline **Importar** button and a primary **Desligamento** button.
- Validate list filters and pagination search params with Zod in TanStack Start routes. Keep list page and page size in the URL, reset the page when filters change, and keep CSV review pagination local to the import workflow.
- Follow the shadcn sortable-column pattern with a ghost trigger, a dropdown for ascending and descending order, and an option to clear active sorting. Keep the sort state exposed through `aria-sort`.
- On case lists, make the whole row open the case and retain the person’s semantic link for keyboard navigation. Left-align the name and role, show at most two pending teams with a `+N` indicator for the rest, and confine horizontal scrolling to the table on narrow screens.

### Verification

- Run `npm test` from the root with `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database. Apply the migrations before the test run. The GitHub verification workflow starts its own PostgreSQL service.

- Verify changed workflows in the browser at desktop and narrow mobile sizes. Exercise focus, keyboard and touch input, and relevant empty, error, and pending states. Use [Verify Offboard](.agents/skills/verify-offboard/SKILL.md) with an authenticated local session for portal flows. Run `npm run lint`, `npm run format:check`, `npm run build -w @offboard/web`, and the relevant workspace tests.
