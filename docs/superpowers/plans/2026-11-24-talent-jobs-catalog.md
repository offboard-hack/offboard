# Talent Jobs Catalog Implementation Plan (PR 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR can share a job by pasting its link (the server fetches the page and an LLM extracts the fields), and a signed-in talent with active access lists open jobs, newest first, filtered by work model.

**Architecture:** A new `jobs` feature slice owns the `jobs` table, the share route and `GET /api/me/jobs`. Two shared, feature-agnostic helpers carry the risky parts: `shared/ai.ts` (structured generation through Vercel AI Gateway with zero data retention) and `shared/page-text.ts` (public-HTTPS-only page fetch with manual redirect re-validation, timeout and size cap). Both are injected through `createApp` options so tests never hit the network.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, AI SDK 7 (`ai@7`, already added to `@offboard/api`), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — sections "Jobs", "LLM", "Delivery order" item 3. Builds on PR 2 (`docs/superpowers/plans/2026-11-24-talent-identity.md`).

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commit messages ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; do not touch `.github/workflows`.
- Features import only themselves, `shared` and `@offboard/*` packages; cross-feature wiring happens in `app.ts`.
- LLM calls go through AI Gateway, model `anthropic/claude-sonnet-5.5`, with `providerOptions: { gateway: { zeroDataRetention: true } }`. API key from `AI_GATEWAY_API_KEY`; when absent the share route answers 503 `{ error: "AI not configured" }`.
- Page fetch: `https:` only, default port only, no IP-literal or private/loopback/link-local hosts, at most 3 redirects each re-validated, 10 s timeout, 2 000 000 bytes cap, `text/html` only, extracted text truncated to 30 000 chars.
- `GET /api/me/jobs` uses the talent macro in `"active"` mode, page size 20, sorted `posted_at desc nulls last, created_at desc`, only `closed_at is null`.
- Money is integer cents; work model is `remote | hybrid | onsite | null`.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A shared link that redirects to an internal address** (`https://short.link/x` → `http://169.254.169.254/`). Must be rejected without fetching the target. → Task 2 test `rejects redirects to private or non-https targets`.
2. **The same job shared twice with different tracking params** (`?utm_source=a` vs `?utm_source=b#apply`). Must return the existing job (200), not create a duplicate. → Task 3 test `deduplicates by normalized url`.
3. **A link that is not a job posting** (a blog post). Must be 422 and store nothing. → Task 4 test `rejects pages that are not job postings`.
4. **LLM returns a salary range inverted or negative** (`min > max`, negative cents). Must be normalized (swap / null) before storing. → Task 3 test `normalizes salary ranges`.
5. **Talent without accepted terms or with lapsed access listing jobs.** Must be 403 / 402 from the macro. → Task 4 test `guards the job list with active talent access`.

---

### Task 1: Jobs schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0011_add_jobs.sql`, `packages/db/drizzle/meta/0011_snapshot.json`; Modify: `packages/db/drizzle/meta/_journal.json` (`idx: 11`, `when: 1795740000006`, `tag: "0011_add_jobs"`)
- Create: `packages/db/src/job.fixture.ts`; Modify: `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Produces: enums `job_origin` (`external`, `hr`, `recruiter`) and `job_work_model` (`remote`, `hybrid`, `onsite`); table `jobs`: `id uuid pk`, `origin job_origin not null`, `source varchar(50) not null`, `source_key varchar(2048) not null`, `title varchar(255) not null`, `company varchar(255) not null`, `work_model job_work_model null`, `city varchar(255) null`, `state varchar(2) null`, `salary_min_cents integer null`, `salary_max_cents integer null`, `url text not null`, `description text not null default ''`, `posted_at timestamp null`, `closed_at timestamp null`, `created_at`, `updated_at`; unique index `jobs_source_key_idx` on `(source, source_key)`; check `jobs_salary_range` (`salary_min_cents is null or salary_max_cents is null or salary_min_cents <= salary_max_cents`).
- Produces: `seedJobs` fixture (4 open jobs: "Analista de Marketing Pleno"/Mercado Fino/hybrid/São Paulo-SP/750000–900000/external; "Analista de Growth"/Ponte Pagamentos/remote/800000–1000000/hr; "Analista de Marketing Digital"/Casa Viva/hybrid/Campinas-SP/no salary/recruiter; "Analista de Marketing de Produto"/Nuvem Alta Software/remote/700000–850000/external), `source: "seed"`, `source_key` = the job's url. `seedDatabase` deletes jobs and inserts them; `testSeedFixtures` gets `jobs: []`.

- [ ] **Step 1: Failing test** `stores jobs with a unique source key and a valid salary range` — after seeding, `jobs` has `seedJobs.length` rows; inserting a duplicate `(source, source_key)` rejects with 23505; inserting `salary_min_cents > salary_max_cents` rejects with 23514.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL (`jobs` not exported).
- [ ] **Step 3: Implement** the schema, hand-written migration (same procedure as 0010: copy `0010_snapshot.json`, add the table and enums, chain `prevId`), fixture and seed.
- [ ] **Step 4: Run** `npm test -w @offboard/db` and `npm test -w @offboard/api` → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): add jobs catalog table`

---

### Task 2: Shared AI and page-text helpers

**Files:**

- Create: `apps/api/src/shared/ai.ts`, `apps/api/src/shared/page-text.ts`
- Modify: `apps/api/package.json` / `package-lock.json` (already contain `ai@^7`; commit them here)
- Test: `apps/api/src/shared/ai.test.ts`, `apps/api/src/shared/page-text.test.ts`

**Interfaces:**

- Produces in `ai.ts`:
  - `type GenerateStructured = <T>(request: { schema: z.ZodType<T>; system: string; prompt: string }) => Promise<T>`
  - `createGenerateStructured(model: LanguageModel): GenerateStructured` — `generateText({ model, system, prompt, output: Output.object({ schema }), providerOptions: { gateway: { zeroDataRetention: true } } })`, returns `output`.
  - `gatewayModel(apiKey: string, modelId = "anthropic/claude-sonnet-5.5"): LanguageModel` — `createGateway({ apiKey })(modelId)`.
- Produces in `page-text.ts`:
  - `parsePublicUrl(raw: string): URL | "invalid_url"` — rules from Global Constraints (https, no credentials, default port, hostname not `localhost`/`*.localhost`/`*.local`/`*.internal`, not an IPv4 literal in 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, not any IPv6 literal).
  - `type FetchPageResult = { url: URL; text: string } | "invalid_url" | "unreachable" | "not_html" | "too_large"`
  - `fetchPageText(url: URL, fetchImpl: typeof fetch = fetch): Promise<FetchPageResult>` — `redirect: "manual"`, follows ≤3 `Location`s through `parsePublicUrl`, `AbortSignal.timeout(10_000)`, rejects non-2xx as `unreachable`, non-`text/html` as `not_html`, bodies over 2 000 000 bytes (by `content-length` or while streaming) as `too_large`; text = HTML minus `<script>`/`<style>`/tags, entities `&amp; &lt; &gt; &quot; &#39; &nbsp;` decoded, whitespace collapsed, sliced to 30 000 chars.

- [ ] **Step 1: Failing tests**
  - `ai.test.ts`: with `MockLanguageModelV4` (`ai/test`) returning `{"title":"x"}` as text, `createGenerateStructured(model)({ schema: z.object({ title: z.string() }), system: "s", prompt: "p" })` resolves `{ title: "x" }`, and the mock's `doGenerate` call received `providerOptions.gateway.zeroDataRetention === true` and the system/prompt. `gatewayModel("key")` returns a model whose `modelId` is `"anthropic/claude-sonnet-5.5"`.
  - `page-text.test.ts` (fake `fetchImpl`, no network): accepts `https://jobs.example.com/a`; rejects `http://…`, `https://user:pw@x.com`, `https://x.com:8443`, `https://localhost`, `https://10.0.0.1`, `https://169.254.169.254`, `https://[::1]`, `not a url` → `"invalid_url"`; `rejects redirects to private or non-https targets` (302 → `http://169.254.169.254/` returns `"invalid_url"` and the fake was called exactly once); follows a public redirect; 4 redirects → `"unreachable"`; 500 → `"unreachable"`; thrown fetch (timeout) → `"unreachable"`; `application/pdf` → `"not_html"`; `content-length: 3000000` → `"too_large"`; a streamed body over the cap without content-length → `"too_large"`; HTML with script/style/tags/entities → clean text; 40 000-char text sliced to 30 000.
- [ ] **Step 2: Run** from `apps/api`: `npx vitest run src/shared/ai.test.ts src/shared/page-text.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement** both modules (read `node_modules/ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx` and `55-testing.mdx` for the exact v7 API).
- [ ] **Step 4: Run** focused tests, then `npm test -w @offboard/api` → PASS at 100%.
- [ ] **Step 5: Commit** `feat(api): add structured generation and safe page fetch helpers`

---

### Task 3: Jobs repository and extraction

**Files:**

- Create: `apps/api/src/features/jobs/repository.ts`, `apps/api/src/features/jobs/extract.ts`
- Modify: `apps/api/src/repositories.ts` (`jobs: createJobsRepository(db)`)
- Test: `apps/api/src/features/jobs/repository.test.ts`, `apps/api/src/features/jobs/extract.test.ts`

**Interfaces:**

- Produces in `extract.ts`:
  - `jobDraftSchema` (Zod): `{ isJobPosting: boolean, title: string, company: string, workModel: "remote" | "hybrid" | "onsite" | null, city: string | null, state: string | null (2-letter UF), salaryMinCents: number | null, salaryMaxCents: number | null, description: string }`
  - `type JobDraft = Omit<z.infer<typeof jobDraftSchema>, "isJobPosting">`
  - `extractJob(generate: GenerateStructured, page: { url: URL; text: string }): Promise<JobDraft | "not_a_job">` — system prompt in English instructing extraction from a Brazilian job page (monthly salary in BRL → cents, UF code, `isJobPosting=false` for anything else); trims strings; normalizes salary: negatives → null, `min > max` → swapped; empty title or company → `"not_a_job"`.
  - `normalizeJobUrl(url: URL): string` — drops hash and `utm_*`, `gclid`, `fbclid` params, sorts remaining params, lowercases host, strips a trailing `/` from non-root paths.
- Produces in `repository.ts` (`createJobsRepository(db)`):
  - `type JobView = { id: string; origin: "external" | "hr" | "recruiter"; title: string; company: string; workModel: "remote" | "hybrid" | "onsite" | null; city: string | null; state: string | null; salaryMinCents: number | null; salaryMaxCents: number | null; url: string; postedAt: string | null }`
  - `findBySource(source: string, sourceKey: string): Promise<JobView | undefined>`
  - `createShared(input: JobDraft & { url: string; sourceKey: string }): Promise<{ job: JobView; created: boolean }>` — `origin: "hr"`, `source: "hr-link"`, `postedAt: now`; on unique conflict returns the existing row with `created: false`.
  - `listOpen(filter: { workModel?: "remote" | "hybrid" | "onsite"; page: number; pageSize: number }): Promise<{ items: JobView[]; total: number }>`
  - `type JobsRepository = ReturnType<typeof createJobsRepository>`

- [ ] **Step 1: Failing tests**
  - `extract.test.ts` (fake `generate`): maps a full draft; `normalizes salary ranges` (`min 900000, max 750000` → swapped; `-1` → null); `isJobPosting: false` → `"not_a_job"`; blank title → `"not_a_job"`; the `generate` call's prompt contains the page url and text; `normalizeJobUrl(new URL("https://Jobs.Example.com/vaga/?utm_source=a&b=2&a=1#apply"))` → `"https://jobs.example.com/vaga?a=1&b=2"`.
  - `repository.test.ts` (PostgreSQL, `testSeedFixtures` plus inline inserts): `deduplicates by normalized url` (second `createShared` with same `sourceKey` → `created: false`, same id, one row); `listOpen` excludes closed jobs, filters by `workModel`, orders by `postedAt desc nulls last`, paginates (`page: 2, pageSize: 1`) with correct `total`.
- [ ] **Step 2: Run** `npx vitest run src/features/jobs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → PASS at 100%.
- [ ] **Step 5: Commit** `feat(api): add jobs repository and job extraction`

---

### Task 4: Routes and composition

**Files:**

- Create: `apps/api/src/features/jobs/routes.ts`
- Modify: `apps/api/src/app.ts` (options `generateStructured?: GenerateStructured`, `fetchPage?: (url: URL) => Promise<FetchPageResult>`), `apps/api/src/worker.ts` (`AI_GATEWAY_API_KEY` optional in `runtimeConfig`), `apps/api/src/server.ts`, `apps/api/src/vercel.ts` (read `process.env.AI_GATEWAY_API_KEY`), `apps/web/cloudflare.config.ts` (declare `AI_GATEWAY_API_KEY: bindings.secret()` only when `process.env.OFFBOARD_AI_CONFIGURED === "1"`), `vercel.json` (rewrite `/api/jobs/:path*`)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: `JobsRepository`, `extractJob`, `normalizeJobUrl` (Task 3); `parsePublicUrl`, `fetchPageText`, `GenerateStructured`, `createGenerateStructured`, `gatewayModel` (Task 2); `PortalAccessPlugin`; `TalentAccessPlugin` (PR 2).
- Produces `jobsRoutes(repos: JobsRepository, access: PortalAccessPlugin, talentAccess: TalentAccessPlugin, deps: { generate: GenerateStructured | undefined; fetchPage: (url: URL) => Promise<FetchPageResult> })`:
  - `POST /jobs/share { url: string (maxLength 2048) }` — `permit: ["create", "Offboarding"]`. Order: `parsePublicUrl` → 422 `{ error: "Invalid job url" }`; existing `findBySource("hr-link", normalizeJobUrl(url))` → 200 job (no fetch, no LLM); `generate` undefined → 503 `{ error: "AI not configured" }`; `fetchPage` failure → 422 for `invalid_url`, 502 `{ error: "Could not read the job page" }` for the others; `extractJob` → 422 `{ error: "Page is not a job posting" }`; else `createShared` → 201 (or 200 when `created: false`). Response `JobView`.
  - `GET /me/jobs?workModel=&page=` — `talent: "active"`; `page` integer ≥ 1 default 1; response `{ items: JobView[]; page: number; pageSize: 20; total: number }`.
- `app.ts`: `generate = options.generateStructured`; `fetchPage = options.fetchPage ?? ((url) => fetchPageText(url))`. Entries build `generateStructured` with `createGenerateStructured(gatewayModel(key))` when the key is set.

- [ ] **Step 1: Failing tests** in `app.test.ts` (fake `generateStructured` and `fetchPage` passed in `appOptions`; record calls):
  - `shares a job by link`: rh POST → 201 with extracted fields; repeating with `?utm_source=x` → 200 same id and the fakes were not called again; `visualizador` → 403.
  - `rejects pages that are not job postings`: fake returns `isJobPosting: false` → 422, no row stored.
  - `reports unreadable pages and missing AI`: `fetchPage` → `"unreachable"` → 502; app built without `generateStructured` → 503; `http://` url → 422 and `fetchPage` not called.
  - `guards the job list with active talent access`: talent without terms → 403; after terms → 200 with the seeded open jobs (seed a couple inline since `testSeedFixtures.jobs` is empty); `?workModel=remote` filters; `?page=0` → 422; lapsed (subscription canceled) → 402; portal session → 403.
- [ ] **Step 2: Run** `npx vitest run src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** routes and composition.
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web` → all pass, API 100%.
- [ ] **Step 5: Commit** `feat(api): let HR share jobs by link and list them for talent`

---

### Delivery

- [ ] Push `feat/talent-jobs-catalog` and open a PR with base `feat/talent-welcome-invite` (stacked on #78 → #77). The body names: migration 0011 also runs before deploy; `AI_GATEWAY_API_KEY` must be set (and `OFFBOARD_AI_CONFIGURED=1` at build) for sharing to work in prod; the SSRF guard does not resolve DNS (a public hostname pointing to a private IP is not blocked — acceptable on Workers, which cannot reach private networks, but not on the Node server).
