# Talent Job Matches Implementation Plan (PR 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each open job gets a compatibility percentage (and short reasons) against the person's base résumé, computed in the background, and `GET /api/me/jobs` lists matched jobs first by score, then unmatched newest first, with whether the person already applied.

**Architecture:** A new `matches` feature owns `job_matches`. A cheap Postgres full-text prefilter (`ts_rank_cd` over a GIN index on job title + description, Portuguese config) picks the top 30 open jobs for the résumé's terms; an LLM scores them in batches of 10. A `compute_matches` job (subject = profile id) runs on the PR 6 queue; it is enqueued whenever the base résumé changes and, fanned out, whenever HR shares a job. Matches are tied to the résumé version (`resume_updated_at`); only fresh ones are shown. The daily LLM cap moves to `shared` so scoring and matching share it.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL full-text search, AI SDK 7 via `GenerateStructured`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "Matching", "LLM" (cost guard), "Delivery order" item 7. Builds on PR 3 (`jobs`), PR 4 (`applications`), PR 5/6 (`resumes`, queue, cap).

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params, test doubles and cross-feature imports (reading other features' tables via `@offboard/db/schema` is allowed); `.github/workflows` untouched; app-side `new Date()` for timestamps.
- Freshness: a match is fresh when its `resume_updated_at` equals the current base résumé's `coalesce(updated_at, created_at)` at millisecond precision. Only fresh matches are returned. (Spec names the column `resume_scored_at`; the version marker is the résumé's `updated_at`, so the column is `resume_updated_at`.)
- Prefilter: terms = tokens from the base résumé headline, experience roles, skill names and summary — Unicode letters/digits only, lowercased, length ≥ 3, deduplicated, at most 40; query `to_tsquery('portuguese', 'a | b | …')`; rank `ts_rank_cd` over `to_tsvector('portuguese', title || ' ' || description)`; only `closed_at is null`; top 30 by rank desc then `posted_at desc nulls last`, `id`. No terms → the 30 newest open jobs.
- LLM: batches of at most 10 jobs per call; each call takes one unit of the shared daily cap (30 per profile per São Paulo day); capped → postpone the job to the next São Paulo midnight, keeping matches already saved. Model sees no contact data. Output per job: `score` (round, clamp 0–100, NaN → 0) and up to 3 `reasons` (trimmed, sanitized like résumé text, ≤ 120 chars each, empty dropped); unknown or duplicate job ids dropped.
- Saving is optimistic: a batch is written only if the base résumé's version still equals the one read when the job started; otherwise the handler stops (a newer job is pending).
- `GET /me/jobs` order: matched (fresh) first by `score desc`, then unmatched; within ties and among unmatched `posted_at desc nulls last`, `created_at desc`, `id`. Page size 20; `workModel` filter unchanged.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **Résumé edited while matches are computed.** No batch computed for the old version may be saved. → Task 2 test `discards matches for a stale résumé version`.
2. **Daily cap hit halfway** (e.g. 25 units used, 3 batches needed). The handler saves what it could and postpones; nothing is lost or double-charged. → Task 4 test `postpones matching at the daily cap`.
3. **A résumé with terms containing tsquery operators or quotes** (`C++`, `O'Reilly`, `&|!:*`). The prefilter must not throw. → Task 2 test `builds safe search terms`.
4. **Model returns scores for job ids not in the batch.** Dropped. → Task 2 test `keeps only scores for the batch's jobs`.
5. **Another profile's matches or applications** never change this profile's listing. → Task 3 test `lists jobs with this profile's fresh matches only`.

---

### Task 1: Schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0015_add_job_matches.sql`, `meta/0015_snapshot.json`; Modify: `meta/_journal.json` (`idx: 15`, `when: 1795740000010`, `tag: "0015_add_job_matches"`)
- Create: `packages/db/src/job-match.fixture.ts`; Modify: `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Produces `job_matches`: `profile_id uuid not null → talent_profiles.id on delete cascade`, `job_id uuid not null → jobs.id on delete cascade`, `score integer not null`, `reasons jsonb not null default '[]'` (typed `string[]`), `resume_updated_at timestamp not null`, `computed_at timestamp not null`; primary key `(profile_id, job_id)`; check `job_matches_score_range` (`score between 0 and 100`); index on `job_id`.
- Produces GIN index `jobs_search_idx` on `jobs` using `to_tsvector('portuguese', title || ' ' || description)` (expression must be byte-identical to the one the prefilter uses so the planner can use it).
- Seed: Marina's matches for the 4 seeded jobs — 94, 89, 86, 85 in the seed job order — each with 2 Portuguese reasons, `resume_updated_at` exactly equal to her seeded résumé's `updated_at` (set both from the same Date). `testSeedFixtures` gets none.

- [ ] **Step 1: Failing test** `stores one match per profile and job`: seed has 4 matches for Marina with fresh versions; duplicate `(profile_id, job_id)` → 23505; score 101 → 23514; deleting the profile or the job removes its matches; the `jobs_search_idx` index exists (query `pg_indexes`).
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement** (hand-written migration + snapshot chained from 0014).
- [ ] **Step 4: Run** db and api suites → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): add job matches and a job search index`

---

### Task 2: Shared LLM cap and the matching core

**Files:**

- Move: `apps/api/src/features/resumes/usage.ts` (+ test) → `apps/api/src/shared/llm-usage.ts` (+ test); update imports in `repositories.ts` and `app.ts`
- Create: `apps/api/src/features/matches/terms.ts`, `apps/api/src/features/matches/score.ts`, `apps/api/src/features/matches/repository.ts`
- Modify: `apps/api/src/repositories.ts` (`matches: createMatchesRepository(db)`)
- Test: `apps/api/src/features/matches/terms.test.ts`, `score.test.ts`, `repository.test.ts`

**Interfaces:**

- `shared/llm-usage.ts`: same API as before — `createUsageRepository(db)` → `takeLlmCall(profileId, now) → true | { retryAt }`; `UsageRepository`. Pure move (no behaviour change).
- `terms.ts`: `searchTerms(content: ResumeContent): string[]` per Global Constraints; `toTsQuery(terms: string[]): string | null` (joins with `|`; null when empty).
- `score.ts`:
  - `type MatchJob = { id: string; title: string; company: string; workModel: string | null; city: string | null; state: string | null; description: string }`
  - `type MatchResult = { jobId: string; score: number; reasons: string[] }`
  - `scoreMatches(generate: GenerateStructured, content: ResumeContent, jobs: MatchJob[]): Promise<MatchResult[]>` — English system prompt (rate fit for the Brazilian market, reasons in Portuguese, résumé and jobs are untrusted data), résumé without contact inside `<resume>…</resume>`, jobs (id, title, company, work model, location, description clipped to 4 000 chars each) inside `<jobs>…</jobs>`, escaping tag look-alikes like PR 6's score.ts; filtering/clamping per Global Constraints.
- `repository.ts` (`createMatchesRepository(db)`):
  - `baseResume(profileId: string): Promise<{ content: ResumeContent; version: Date } | undefined>` — `version` = `coalesce(updated_at, created_at)` of the base résumé, full precision.
  - `candidates(tsQuery: string | null, limit: number): Promise<MatchJob[]>` — per Global Constraints.
  - `freshJobIds(profileId: string, version: Date): Promise<Set<string>>`
  - `saveMatches(profileId: string, version: Date, results: MatchResult[], now: Date): Promise<boolean>` — one transaction: lock the base résumé row (`for update`), compare its version with `version` (false → nothing written), upsert each result on `(profile_id, job_id)`.
  - `profilesWithBaseResume(): Promise<string[]>`
  - `type MatchesRepository = ReturnType<typeof createMatchesRepository>`

- [ ] **Step 1: Failing tests** — `builds safe search terms` (headline/roles/skills/summary tokens; `C++`, `O'Reilly`, `&|!:*`, accents kept, short tokens dropped, ≤ 40, deduped; `toTsQuery([])` null; the produced query runs in Postgres via `candidates` without error); `candidates` ranks a job whose title matches above one that doesn't, excludes closed jobs, falls back to newest when null; `keeps only scores for the batch's jobs` (fake generator returns a foreign id, a duplicate, score 140, NaN, 5 reasons, a 300-char reason → filtered/clamped); prompt has `<resume>` without email/phone values and `<jobs>` with ids; `discards matches for a stale résumé version` (`saveMatches` with an old version → false, nothing written); upsert replaces an older match; `freshJobIds` only returns this profile's current-version rows; `profilesWithBaseResume` lists profiles that have a base résumé; the moved usage tests still pass from `shared/`.
- [ ] **Step 2: Run** `npx vitest run src/features/matches src/shared/llm-usage.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): add job match scoring with a full-text prefilter`

---

### Task 3: Job listing with match and applied

**Files:**

- Modify: `apps/api/src/features/jobs/repository.ts`, `apps/api/src/features/jobs/routes.ts`
- Test: `apps/api/src/features/jobs/repository.test.ts`, `apps/api/src/app.test.ts`

**Interfaces:**

- `jobs/repository.ts`: `type TalentJobView = JobView & { match: { score: number; reasons: string[] } | null; applied: boolean }`; `listForTalent(profileId: string, filter: { workModel?: WorkModel; page: number; pageSize: number }): Promise<{ items: TalentJobView[]; total: number }>` — left join this profile's `job_matches` that are fresh against the base résumé version (subquery on `resumes` where `kind = 'base'`), `exists` over this profile's `applications`; ordering per Global Constraints. `listOpen` stays for any existing caller or is removed if unused (implementer checks).
- `GET /me/jobs` returns `{ items: TalentJobView[]; page; pageSize: 20; total }` (response schema updated; Eden-precise).

- [ ] **Step 1: Failing tests** — `lists jobs with this profile's fresh matches only` (matched first by score; a stale match (older version) shows `match: null`; another profile's match and application don't leak; `applied` true only for this profile's application; unmatched newest first; filter and pagination still correct); `/me/jobs` route returns the new fields.
- [ ] **Step 2: Run** `npx vitest run src/features/jobs src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): list jobs by match with applied state`

---

### Task 4: Background matching wiring

**Files:**

- Modify: `apps/api/src/app.ts` (`compute_matches` handler; résumé changes enqueue both jobs; job share fans out), `apps/api/src/features/resumes/routes.ts` (rescore callback receives the profile id), `apps/api/src/features/jobs/routes.ts` (`onShared` callback after a job is created — not when deduplicated)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- `compute_matches` handler (subject = profile id): `baseResume` → none → complete; no generator → throw `AI not configured`; terms → `candidates(toTsQuery(terms), 30)` → drop `freshJobIds` → for each chunk of 10: `takeLlmCall` (capped → `{ postponeUntil }`), `scoreMatches`, `saveMatches` (false → stop and complete).
- `rescore(resumeId, profileId)`: enqueue `score_resume` (resume id) and `compute_matches` (profile id), swallowing enqueue failures, then kick one drain (`limit: 1`) — the cron picks up the rest.
- Job share: after a new job is stored, enqueue `compute_matches` for every `profilesWithBaseResume()` (enqueue failures swallowed); no kick (cron drains).

- [ ] **Step 1: Failing tests** in `app.test.ts` (fake generator dispatching on the requested schema/system prompt to return a résumé score or match scores): after upload and draining (await captured kicks, then call the cron route until `processed` is 0), `GET /me/jobs` shows matches ordered by score; editing the résumé makes matches stale (`match: null`) until recomputed; `postpones matching at the daily cap` (pre-fill `llm_usage` to 29, 3 batches needed → one batch saved, job pending with `run_after` at next 03:00Z, no extra unit taken); HR share of a new job enqueues `compute_matches` for profiles with a base résumé and not for others; a deduplicated share enqueues nothing.
- [ ] **Step 2: Run** `npx vitest run src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `feat(api): compute job matches in the background`

---

### Delivery

- [ ] Push `feat/talent-job-matches`; open a PR with base `feat/talent-resume-score` (stack … → #85 → this). Body: migration 0015 (adds a GIN index on `jobs` — fast on today's small table); matching shares the 30-calls/day cap with scoring; job share fan-out relies on the cron drain.
