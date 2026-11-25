# Talent Sources Reshape Implementation Plan (PR 9, reshaped)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jobs enter the catalog only from automated sources managed by the Offboard team. Remove HR job sharing and partner recruiters; turn the admin-managed job feeds into a code-defined source registry synced by the cron.

**Architecture:** The branch `feat/talent-external-jobs` already contains Greenhouse/Lever adapters, feed sync, admin feed routes and partner recruiters (commits `ecc6bcd…b1efcc7`). This plan reshapes it before the PR opens: migration `0018` (never deployed) is rewritten to create `job_sources` instead of `job_feeds` + `recruiter_partners`; the `feeds` feature becomes `sources`, whose list of boards lives in a reviewed constant (`catalogSources`) that the drain cron syncs into `job_sources` (insert new, re-enable listed, disable and close jobs of removed ones); the HR share route, its extraction pipeline, the safe page fetcher, the recruiters feature and the HR "shared jobs" aggregate are deleted.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-talent-ai-apply-design.md` — "Job catalog and sources", "Partner recruiters" (removed for now, Samuel 2026-11-25), "Delivery order" item 1.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test doubles and cross-feature imports; `.github/workflows` untouched; app-side `new Date()` timestamps.
- Migration `0018` is rewritten in place (it was never merged or deployed). Earlier migrations (0010–0017) are not touched.
- `jobs.origin` keeps its enum values; only `external` is produced from now on. Migration 0018 closes open jobs with origin `hr` or `recruiter` (`closed_at = now()`); seed jobs become `origin = 'external'` with `source` `greenhouse`/`lever`-like values (`seed` source is fine) — no seeded `hr`/`recruiter` rows.
- Source registry: `job_sources` (`id`, `kind job_source_kind` enum `greenhouse` | `lever`, `target varchar(100)` (board slug, same format check as before), `label varchar(255) null`, `enabled boolean not null default true`, `last_synced_at`, `last_error varchar(100)`, `created_at`, `updated_at`; unique `(kind, target)`). `catalogSources` (in `apps/api/src/features/sources/catalog.ts`) is the source of truth; `syncCatalog(now)` upserts listed ones (enabled, label updated) and disables unlisted ones, closing their open jobs (`closed_at = now`) in the same transaction. Seed `catalogSources` with the boards verified to have Brazilian jobs: greenhouse `stone` (label "Stone") and greenhouse `quintoandar` (label "QuintoAndar"). Seeded DB rows for local dev are disabled (no network locally unless a developer enables them by hand).
- Everything removed must leave no dead code: delete files whose only consumers are removed, drop their tests, update composition/runtime entries/README/`vercel.json` rewrites.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A source removed from `catalogSources` whose jobs were matched or applied to.** Jobs are closed (not deleted); applications and résumés referencing them keep working. → Task 3 test `disables removed sources and closes their jobs`.
2. **Existing HR- or recruiter-origin jobs after the migration.** Closed, still readable through applications. → Task 1 test.
3. **No remaining route for HR sharing or recruiter submission** (`POST /api/jobs/share`, `/api/recruiters/*`, `/api/recruiter-partners*`, `/api/job-feeds*` → 404). → Task 2/3 tests.
4. **Cron with an empty or unchanged catalog** schedules nothing new and changes nothing. → Task 3 test.

---

### Task 1: Rewrite migration 0018 and seeds

**Files:** `packages/db/src/schema/index.ts`, `packages/db/drizzle/0018_*.sql` (rename to `0018_add_job_sources.sql`, update the journal tag), `meta/0018_snapshot.json`, `meta/_journal.json`, `packages/db/src/job-feed.fixture.ts` → `job-source.fixture.ts`, delete `packages/db/src/recruiter-partner.fixture.ts`, `packages/db/src/job.fixture.ts`, `packages/db/src/seed-database.ts`, `packages/db/test/database.test.ts`.

**Interfaces:** schema exports `jobSources`, `jobSourceKindEnum`; `jobs.lastSeenAt` kept; `recruiterPartners`, `jobs.recruiterPartnerId`, `jobFeeds`, `jobFeedProviderEnum` removed.

- [ ] **Step 1: Failing test** `stores job sources and closes shared jobs`: seed has the 2 disabled sources; duplicate `(kind, target)` → 23505; invalid target → 23514; migrating a DB that has an open `hr` job and a `recruiter` job leaves both closed (apply 0001–0017, insert, then 0018 — use drizzle's migrator with a folder copy limited to ≤ 0017 then the full folder, or run the 0018 SQL directly); seed jobs are all `external`.
- [ ] **Step 2–4:** run → FAIL; implement; run db + api suites (api will fail until Task 2/3 adapt — if so, include the minimal API compile fixes here or sequence Tasks so each commit is green; the commit must be green).
- [ ] **Step 5: Commit** `refactor(db): replace job feeds and recruiter partners with job sources`

---

### Task 2: Remove HR job sharing and partner recruiters

**Files:** delete `apps/api/src/features/recruiters/*`, `apps/api/src/features/jobs/share.ts`, `apps/api/src/features/jobs/extract.ts` (+ tests) if unused, `apps/api/src/shared/page-text.ts` and `apps/api/src/shared/dns-guard.ts` (+ tests) if unused after removal (keep `shared/html-text.ts`, `shared/response-body.ts` used by sources); modify `apps/api/src/features/jobs/{routes,repository}.ts` (drop `/jobs/share`, `createShared`, `findBySource`, `countByPartnerSince`), `apps/api/src/features/insights/{repository,routes}.ts` (drop `sharedJobs`), `apps/api/src/app.ts`, `server.ts`, `vercel.ts`, `worker.ts` (drop `fetchPage`, DNS guard wiring, recruiter wiring), `vercel.json` (drop `/api/jobs/:path*`, recruiter rewrites), `apps/api/README.md` (drop rows for removed env/features), tests.

- [ ] **Step 1: Failing tests** — `POST /api/jobs/share`, `POST /api/recruiters/jobs`, `GET /api/recruiter-partners` → 404; aggregates response has no `sharedJobs` key (deep key-set test updated).
- [ ] **Step 2–4:** run → FAIL; remove; run full suites (100%).
- [ ] **Step 5: Commit** `refactor(api): remove HR job sharing and partner recruiters`

---

### Task 3: Code-defined source registry

**Files:** rename `apps/api/src/features/feeds` → `apps/api/src/features/sources` (`sources.ts` adapters keep their API; `repository.ts` works on `job_sources`; add `catalog.ts` with `catalogSources` and `syncCatalog`); delete the admin routes file and its tests; modify `apps/api/src/app.ts` (`ingest_jobs` handler reads `job_sources`; drain cron `beforeDrain` runs `syncCatalog(now)` then schedules due sources), `apps/api/src/repositories.ts`, `vercel.json` (drop `/api/job-feeds*`).

**Interfaces:** `catalogSources: readonly { kind: "greenhouse" | "lever"; target: string; label: string | null }[]`; `syncCatalog(now: Date): Promise<{ added: number; enabled: number; disabled: number; closed: number }>`; repository `dueIds(now)`, `get(id)`, `sync(id, result, now)` unchanged in behaviour.

- [ ] **Step 1: Failing tests** — `disables removed sources and closes their jobs` (applications on a closed job still listed); unchanged catalog → no-op; new catalog entry → inserted enabled and due; label change → updated; `/api/job-feeds` → 404; the cron path syncs then schedules (fake fetch).
- [ ] **Step 2–4:** run → FAIL; implement; full verification `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `refactor(api): manage job sources in code and sync them from the cron`

---

### Delivery

- [ ] Push `feat/talent-external-jobs`; open the PR with base `docs/talent-ai-apply-design` (#97). Body: migration 0018; sources are a reviewed list in code (adding a board = a PR); HR sharing and partner recruiters removed (recruiters recoverable from `b1efcc7`); cron required for syncing.
