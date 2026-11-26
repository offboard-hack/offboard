# Talent Résumé Score Implementation Plan (PR 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every base résumé gets a 0–100 score and up to five concrete suggestions ("Revisar · +4") computed in the background; the person applies or dismisses each suggestion, and any change rescores automatically.

**Architecture:** A Postgres-backed job queue (`background_jobs`, claimed with `FOR UPDATE SKIP LOCKED`) lives in a new `background` feature with a drain loop and a cron route. Handlers are registered per kind in `app.ts`, so the queue knows nothing about résumés. The `resumes` feature adds scoring (one LLM call returning score + suggestions, validated against the résumé's own nodes), suggestion persistence, and apply/dismiss routes. Writes that change résumé content enqueue `score_resume` and kick one bounded drain in the background (`waitUntil` on the Worker, fire-and-forget on Node); a 15-minute cron is the safety net. A per-profile daily LLM call cap protects cost.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, AI SDK 7 via `GenerateStructured`, Cloudflare Workers (`waitUntil` from `cloudflare:workers`, cron triggers), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "Résumé" (suggestions, scoring), "Background work", "LLM" (cost guard), "Delivery order" item 6. Builds on PR 5 (`resumes`, content with node ids).

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params, test doubles and cross-feature imports. `.github/workflows` untouched (the deploy env change is its own PR #84).
- App-side `new Date()` for every timestamp write (no SQL `now()` defaults relied upon for values read back).
- Queue: enqueue is idempotent per `(kind, subject)` while a job is `pending`; a `running` job does not block a new `pending` one. Claim with `FOR UPDATE SKIP LOCKED`, setting `status = running`, `locked_until = now + 5 min`, `attempts + 1`; `running` rows past `locked_until` are claimable again. Failure: retry with `run_after = now + 2^attempts minutes` until 3 attempts, then `failed` with `last_error` (≤ 2 000 chars). One drain processes at most 5 jobs and stops starting new ones after 20 s.
- Scoring: one LLM call returns `score` and ≤ 5 suggestions. A suggestion only rewrites the text of an existing `headline`, `summary` or experience `bullet` node; `original_text` is taken from the résumé, never from the model; suggestions targeting unknown nodes, other node kinds, duplicates, or identical text are dropped; `score` clamped to 0–100, `estimated_gain` rounded and clamped to 1–20.
- A score is saved only if the résumé's `updated_at` still equals the value read before the LLM call (otherwise the result is discarded — a newer job is already pending). Saving replaces `open` suggestions and keeps `applied`/`dismissed` ones.
- Cost cap: at most 30 LLM calls per profile per São Paulo day (fixed `-03:00`); over the cap, the job is rescheduled to the next São Paulo midnight without counting an attempt.
- Cron route `GET|POST /api/background/drain` uses the existing `machine: "cron"` guard (`CRON_SECRET`). Worker cron triggers: keep `0 8 * * *` (Correios) and add `*/15 * * * *` (drain); `scheduled(controller)` dispatches by `controller.cron`.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **Two drains running at once** (cron and a kick). No job may be processed twice. → Task 2 test `claims each job once across concurrent drains`.
2. **The person edits the résumé while a score is being computed.** The stale score must not be saved; the newer pending job scores the new content. → Task 3 test `discards a score computed for stale content`.
3. **Applying a suggestion after the node changed** (person edited that bullet). Must be 409 and change nothing. → Task 3 test `rejects applying a stale suggestion`.
4. **A handler that keeps throwing.** Retries with backoff, then `failed` with the error recorded; the drain continues with other jobs. → Task 2 test `retries then fails a broken job`.
5. **Model suggestions that target a contact field or invent a node id.** Dropped, never stored. → Task 3 test `keeps only suggestions for existing text nodes`.

---

### Task 1: Schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0014_add_background_jobs_and_suggestions.sql`, `meta/0014_snapshot.json`; Modify: `meta/_journal.json` (`idx: 14`, `when: 1795740000009`, `tag: "0014_add_background_jobs_and_suggestions"`)
- Modify: `packages/db/src/resume.fixture.ts`, `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Produces enum `background_job_status` (`pending`, `running`, `done`, `failed`) and table `background_jobs`: `id uuid pk`, `kind varchar(50) not null`, `subject varchar(255) not null`, `payload jsonb not null default '{}'`, `status background_job_status not null default 'pending'`, `attempts integer not null default 0`, `run_after timestamp not null`, `locked_until timestamp null`, `last_error text null`, `created_at`, `updated_at`; partial unique `background_jobs_pending_idx` on `(kind, subject) where status = 'pending'`; index `background_jobs_claim_idx` on `(status, run_after)`.
- Produces enum `resume_suggestion_status` (`open`, `applied`, `dismissed`) and table `resume_suggestions`: `id uuid pk`, `resume_id uuid not null → resumes.id on delete cascade`, `target_node_id varchar(64) not null`, `original_text text not null`, `suggested_text text not null`, `rationale text not null`, `estimated_gain integer not null`, `status resume_suggestion_status not null default 'open'`, `created_at`, `updated_at`; index on `resume_id`; check `resume_suggestions_gain` (`estimated_gain between 1 and 20`).
- Produces table `llm_usage`: `profile_id uuid not null → talent_profiles.id on delete cascade`, `day date not null`, `calls integer not null default 0`; primary key `(profile_id, day)`.
- Seed: Marina's base résumé gets `score: 82`, `scored_at` = 2 days ago, and 3 open suggestions targeting her seeded summary/bullet node ids, Portuguese, gains 4, 4, 3 (e.g. "Diga quanto vendeu o lançamento…", "Troque 'responsável por campanhas' pelo resultado…", "Inclua Google Analytics 4 e SQL…" targeting the summary). `testSeedFixtures` gets none.

- [ ] **Step 1: Failing test** `stores jobs, suggestions and usage`: seed counts; two `pending` jobs for the same `(kind, subject)` → 23505, but a `running` + a `pending` one coexist; gain 0 and 21 → 23514; deleting the résumé removes its suggestions; deleting the profile removes its usage rows.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement** (hand-written migration + snapshot chained from 0013).
- [ ] **Step 4: Run** db and api suites → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): add background jobs, résumé suggestions and LLM usage`

---

### Task 2: Background queue and drain

**Files:**

- Create: `apps/api/src/features/background/repository.ts`, `apps/api/src/features/background/drain.ts`
- Modify: `apps/api/src/repositories.ts` (`background: createBackgroundRepository(db)`)
- Test: `apps/api/src/features/background/repository.test.ts`, `apps/api/src/features/background/drain.test.ts`

**Interfaces:**

- Produces in `repository.ts`:
  - `type BackgroundJob = { id: string; kind: string; subject: string; payload: Record<string, ConfigValue>; attempts: number }`
  - `enqueue(kind: string, subject: string, payload?: Record<string, ConfigValue>, runAfter?: Date): Promise<void>` — `on conflict do nothing` against the pending index.
  - `claim(limit: number, now?: Date): Promise<BackgroundJob[]>` — one statement or transaction using `FOR UPDATE SKIP LOCKED` over `status = 'pending' and run_after <= now` or `status = 'running' and locked_until < now`, ordered by `run_after`.
  - `complete(id: string): Promise<void>`; `retry(id: string, error: string, attempts: number, now?: Date): Promise<void>` (backoff or `failed` per Global Constraints); `postpone(id: string, runAfter: Date): Promise<void>` (back to `pending`, attempts decremented by the claim's increment).
  - `type BackgroundRepository = ReturnType<typeof createBackgroundRepository>`
- Produces in `drain.ts`:
  - `type JobHandler = (job: BackgroundJob) => Promise<void | { postponeUntil: Date }>`
  - `drain(repo: BackgroundRepository, handlers: Record<string, JobHandler>, options?: { limit?: number; budgetMs?: number; now?: () => number }): Promise<{ processed: number; failed: number }>` — claims up to `limit` (default 5), runs sequentially, stops starting new jobs after `budgetMs` (default 20 000) and releases unstarted claims back to `pending`; unknown kind → `retry` with `"Unknown job kind"`.

- [ ] **Step 1: Failing tests** — enqueue idempotency (twice → one pending row; with a running row → second pending allowed); claim order and stale-lock reclaim; `claims each job once across concurrent drains` (10 jobs, two `drain` calls via `Promise.all` with handlers recording ids → each id exactly once); `retries then fails a broken job` (attempts 1→2→3 with run_after backoff 2, 4 minutes, then `failed` + `last_error`; another job in the same drain still completes); postpone restores attempts; budget stops early and releases the rest; unknown kind retried.
- [ ] **Step 2: Run** `npx vitest run src/features/background` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): add a Postgres job queue with bounded drains`

---

### Task 3: Scoring and suggestions

**Files:**

- Create: `apps/api/src/features/resumes/score.ts`, `apps/api/src/features/resumes/suggestions.ts`
- Modify: `apps/api/src/features/resumes/repository.ts`
- Test: `apps/api/src/features/resumes/score.test.ts`, `apps/api/src/features/resumes/suggestions.test.ts`

**Interfaces:**

- Produces in `score.ts`:
  - `type TextNode = { id: string; kind: "headline" | "summary" | "bullet"; text: string }`; `textNodes(content: ResumeContent): TextNode[]`
  - `type ScoredSuggestion = { targetNodeId: string; originalText: string; suggestedText: string; rationale: string; estimatedGain: number }`
  - `scoreResume(generate: GenerateStructured, content: ResumeContent): Promise<{ score: number; suggestions: ScoredSuggestion[] }>` — English system prompt (score for Brazilian job market, Portuguese suggestions in the person's voice, never invent facts or numbers — ask the person to add them instead), content serialized with node ids inside `<resume>…</resume>` as untrusted data; filtering/clamping per Global Constraints.
- Produces in `suggestions.ts` (`createSuggestionsRepository(db)` — or added to the résumé repository, implementer's call, keep one responsibility per file):
  - `type SuggestionView = { id: string; targetNodeId: string; originalText: string; suggestedText: string; rationale: string; estimatedGain: number }`
  - `listOpen(profileId: string): Promise<SuggestionView[]>` (base résumé only, highest gain first)
  - `saveScore(resumeId: string, expectedUpdatedAt: Date, result: { score: number; suggestions: ScoredSuggestion[] }, now: Date): Promise<boolean>` — one transaction: lock the résumé row, compare `updated_at` with `expectedUpdatedAt` (false → nothing written), set `score`, `scored_at`, delete `open` suggestions, insert new ones.
  - `apply(profileId: string, suggestionId: string, now: Date): Promise<ResumeView | "not_found" | "stale">` — one transaction: lock the base résumé of the profile, find the open suggestion on it, the node's current text must equal `original_text` (else `"stale"`), write `suggested_text`, set suggestion `applied`, bump `updated_at`, reset score.
  - `dismiss(profileId: string, suggestionId: string): Promise<boolean>`
- Produces in `resumes/repository.ts`: `forScoring(resumeId: string): Promise<{ profileId: string; content: ResumeContent; updatedAt: Date } | undefined>`.
- Produces usage helpers (in the résumé feature or `shared`, no cross-feature import): `takeLlmCall(db-backed repo, profileId: string, now: Date): Promise<true | { retryAt: Date }>` — upsert-increment `llm_usage` for the São Paulo day if `calls < 30`, else next São Paulo midnight.

- [ ] **Step 1: Failing tests** — `keeps only suggestions for existing text nodes` (fake generator returns suggestions for a bullet, a contact field, an unknown id, a duplicate and an identical text → only the bullet one survives with `originalText` from the résumé); clamping of score and gain; prompt contains `<resume>` with ids; `discards a score computed for stale content` (`saveScore` with an old `expectedUpdatedAt` → false, nothing written); `saveScore` keeps applied/dismissed and replaces open; `rejects applying a stale suggestion` (node edited → `"stale"`, nothing changed); apply success writes text, marks applied, resets score; another profile's suggestion → `"not_found"` / `false`; usage cap: 30 calls then `{ retryAt }` at the next `03:00Z`.
- [ ] **Step 2: Run** `npx vitest run src/features/resumes` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): score résumés and manage suggestions`

---

### Task 4: Routes, enqueueing, cron and Worker wiring

**Files:**

- Create: `apps/api/src/features/background/routes.ts`
- Modify: `apps/api/src/features/resumes/routes.ts` (suggestion routes; enqueue + kick after upload, PATCH and apply), `apps/api/src/app.ts` (handler registry `{ score_resume }`, option `runInBackground?: (task: Promise<void>) => void`), `apps/api/src/worker.ts` (accept `waitUntil` in `createWorkerApi(bindings, { waitUntil })`), `apps/web/cloudflare.worker.ts` (pass `waitUntil` from `cloudflare:workers`; `scheduled(controller)` dispatching `0 8 * * *` → Correios, `*/15 * * * *` → `/api/background/drain`), `apps/web/cloudflare.config.ts` (two triggers when cron is enabled), `apps/api/src/server.ts`, `apps/api/src/vercel.ts`, `vercel.json` (rewrite `/api/background/:path*`)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- `score_resume` handler (composed in `app.ts`): `forScoring(subject)` → missing → done; `takeLlmCall` → `{ retryAt }` → `{ postponeUntil: retryAt }`; no generator configured → throw (retry/fail); `scoreResume`; `saveScore(subject, updatedAt, result, new Date())`.
- `backgroundRoutes(repo, handlers, cronSecret)` → `GET|POST /background/drain` (`machine: "cron"` pattern from offboardings routes) → 200 `{ processed, failed }`.
- Résumé routes:
  - `GET /me/resume/suggestions` (`talent: "active"`) → 200 `SuggestionView[]`.
  - `POST /me/resume/suggestions/:id/apply` → 200 `ResumeView`, 404 `{ error: "Suggestion not found" }`, 409 `{ error: "Résumé changed since this suggestion" }`.
  - `POST /me/resume/suggestions/:id/dismiss` → 204 or 404.
  - After a successful upload, PATCH or apply: `enqueue("score_resume", resume.id)` then `kick()`, where `kick = () => runInBackground(drain(...))` and `runInBackground` defaults to `(task) => void task.catch(() => undefined)`.

- [ ] **Step 1: Failing tests** in `app.test.ts` (fake generator returning a score and a valid suggestion; `runInBackground` captured so the test can await it): upload → job enqueued and, after awaiting the kicked drain, `GET /me/resume` shows the score and `GET /me/resume/suggestions` the suggestion; apply → 200 with new text, score reset, a new job enqueued; stale apply → 409; dismiss → 204 then gone; other profile → 404; cron route without secret → 401/403, with secret → 200 `{ processed, failed }`; over the daily cap the job is postponed (no LLM call).
- [ ] **Step 2: Run** `npx vitest run src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** routes, composition and runtime wiring (verify `waitUntil` is exported by `cloudflare:workers` in `node_modules/@cloudflare/workers-types/index.d.ts`).
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `feat(api): score résumés in the background and expose suggestions`

---

### Delivery

- [ ] Push `feat/talent-resume-score`; open a PR with base `feat/talent-resume` (stack … → #83 → this). Body: migration 0014; drains every 15 min only when `OFFBOARD_ENABLE_CRON=1`; scoring needs the AI key; the daily cap of 30 LLM calls per profile.
