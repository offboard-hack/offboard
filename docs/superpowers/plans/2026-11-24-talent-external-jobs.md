# Talent External Jobs Implementation Plan (PR 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Vagas catalog never depends only on people feeding it: an admin registers company job boards (Greenhouse or Lever official public APIs) that are imported in the background, and partner recruiters submit job links through a personal token.

**Architecture:** The spec's Gupy adapter is replaced (Gupy has no public search API — verified 404) by official per-company board APIs: Greenhouse `GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true` and Lever `GET https://api.lever.co/v0/postings/{board}?mode=json`. A new `feeds` feature owns `job_feeds`, deterministic normalization (no LLM), an `ingest_jobs` background job per feed (scheduled by the existing 15-minute drain cron every 6 hours per feed), upserts by `(source, source_key)`, closing jobs missing from their feed for 3 days, and fanning out `compute_matches` when new jobs arrive. A new `recruiters` feature owns `recruiter_partners` (token stored as SHA-256), admin management routes, and a token-authenticated submission route that reuses the HR share pipeline (refactored into a function inside the jobs feature) with a per-partner daily cap.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, Web Crypto (`crypto.subtle.digest`), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "Jobs" (external ingestion, partner recruiters), "Background work", "Delivery order" item 9. Deviation from the spec: Greenhouse/Lever feeds instead of Gupy (decided with Samuel on 2026-11-24).

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test doubles and cross-feature imports (reading tables via `@offboard/db/schema` allowed; composition in `app.ts`); `.github/workflows` untouched; app-side `new Date()` timestamps; no network in tests (inject `fetch`).
- Feed board slugs: `^[a-z0-9][a-z0-9_-]{0,99}$`. Providers: `greenhouse`, `lever`. Feed requests go only to the two fixed hosts above (no user-controlled host); 15 s timeout; response ≤ 10 MB; non-2xx or invalid JSON → feed error recorded (`last_error` = short code, e.g. `http_404`, `invalid_json`, `timeout`, `too_large`), no jobs changed.
- Normalization (deterministic): `source` = provider; `source_key` = `${board}:${id}`; title, company (`company_label` override, else Greenhouse `company_name`, else Lever board name title-cased), url (Greenhouse `absolute_url`, Lever `hostedUrl`; must be https), description = plain text (Greenhouse `content` is HTML-escaped HTML → unescape then strip tags; Lever `descriptionPlain` + `additionalPlain`), clipped to 20 000 chars; `postedAt` (Greenhouse `first_published`, Lever `createdAt` ms); work model (Lever `workplaceType` remote/hybrid/onsite; Greenhouse: `remoto|remote` → remote, `híbrido|hibrido|hybrid` → hybrid in title or location, else null); city/state from location text with a Brazilian state map (name or UF → UF; city = first comma segment when a state is found); salary null. Items failing validation are skipped individually (counted in the sync result).
- Brazil filter: keep a job only when its location mentions `Brasil`/`Brazil`, a Brazilian state name or UF, or (Lever) `country = "BR"`; otherwise skip.
- Sync: upsert by `(source, source_key)` with `origin = 'external'`, `last_seen_at = now`, `closed_at = null` (reopen); after a successful fetch, close this feed's jobs (`source = provider and source_key like 'board:%'`) with `last_seen_at < now - 3 days`; update `last_synced_at`/`last_error`. A feed is due when enabled and `last_synced_at` is null or older than 6 hours.
- Recruiter tokens: 32 random bytes base64url shown once at creation; stored as lowercase hex SHA-256 (`token_hash char(64)` unique); revoked partners can't submit (401, same as unknown token). Submission: `POST /api/recruiters/jobs { url }` with `Authorization: Bearer <token>`; at most 20 jobs created per partner per São Paulo day (429 beyond); origin `recruiter`, `recruiter_partner_id` set.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A feed returning malformed items mixed with good ones.** Good ones imported, bad ones skipped and counted; nothing throws. → Task 2 test `skips invalid items`.
2. **A feed that fails (404, timeout, garbage).** No job is closed or changed; the error is recorded. → Task 3 test `keeps jobs when a sync fails`.
3. **A job disappearing from the feed then reappearing.** Closed only after 3 days missing; reopened when it returns. → Task 3 test `closes missing jobs after three days and reopens returning ones`.
4. **A revoked or unknown recruiter token, or a 21st submission in a day.** 401 / 401 / 429; nothing stored. → Task 4 test `guards recruiter submissions`.
5. **Ingested jobs never overwrite HR- or recruiter-shared rows** (different `source`), and a feed can't touch another feed's jobs when closing. → Task 3 test `scopes closing to the feed`.

---

### Task 1: Schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0018_add_job_feeds_and_recruiters.sql`, `meta/0018_snapshot.json`; Modify: `meta/_journal.json` (`idx: 18`, `when: 1795740000013`, `tag: "0018_add_job_feeds_and_recruiters"`)
- Create: `packages/db/src/job-feed.fixture.ts`, `packages/db/src/recruiter-partner.fixture.ts`; Modify: `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Enum `job_feed_provider` (`greenhouse`, `lever`). Table `job_feeds`: `id uuid pk`, `provider job_feed_provider not null`, `board varchar(100) not null`, `company_label varchar(255) null`, `enabled boolean not null default true`, `last_synced_at timestamp null`, `last_error varchar(100) null`, `created_at`, `updated_at`; unique `job_feeds_provider_board_idx` on `(provider, board)`; check `job_feeds_board_format` (`board ~ '^[a-z0-9][a-z0-9_-]{0,99}$'`).
- Table `recruiter_partners`: `id uuid pk`, `name varchar(255) not null`, `company varchar(255) not null`, `token_hash char(64) not null` (unique `recruiter_partners_token_hash_idx`), `revoked_at timestamp null`, `created_at`, `updated_at`.
- `jobs.recruiter_partner_id uuid null → recruiter_partners.id on delete set null` (+ index); `jobs.last_seen_at timestamp null`.
- Seed: two feeds, both `enabled = false` (no network in local dev until an admin enables them): greenhouse `quintoandar` (label "QuintoAndar") and greenhouse `stone` (label "Stone"); one recruiter partner "Ana Ribeiro — Talentos Parceiros" whose token is the fixed dev value `dev-recruiter-token-offboard-local` (hash stored); the seeded Casa Viva recruiter job gets this partner's id. `testSeedFixtures` gets none.

- [ ] **Step 1: Failing test** `stores job feeds and recruiter partners`: seed rows; duplicate (provider, board) → 23505; board `Bad Slug` → 23514; duplicate token hash → 23505; deleting the partner sets the job's `recruiter_partner_id` null.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement** (hand-written migration + snapshot chained from 0017).
- [ ] **Step 4: Run** db and api suites → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): add job feeds and recruiter partners`

---

### Task 2: Feed adapters and normalization

**Files:**

- Create: `apps/api/src/features/feeds/sources.ts`, `apps/api/src/features/feeds/normalize.ts`, `apps/api/src/shared/html-text.ts` (extract `htmlToText` from `shared/page-text.ts` and reuse it there; behaviour unchanged)
- Test: `sources.test.ts`, `normalize.test.ts`, `apps/api/src/shared/html-text.test.ts`

**Interfaces:**

- `type FeedJob = { sourceKey: string; title: string; company: string; workModel: "remote" | "hybrid" | "onsite" | null; city: string | null; state: string | null; url: string; description: string; postedAt: Date | null }`
- `type FeedResult = { jobs: FeedJob[]; skipped: number } | { error: "http_error" | "invalid_json" | "timeout" | "too_large"; status?: number }`
- `fetchFeed(feed: { provider: "greenhouse" | "lever"; board: string; companyLabel: string | null }, fetchImpl?: typeof fetch): Promise<FeedResult>` — fixed host per provider, 15 s timeout, size cap, per-item zod `safeParse`, normalization and Brazil filter per Global Constraints (filtered-out items are not counted as skipped).
- `normalize.ts` exports: `brazilState(text: string): string | null` (UF from name or UF token, accent-insensitive), `parseLocation(text: string): { city: string | null; state: string | null; inBrazil: boolean }`, `workModelFrom(text: string): FeedJob["workModel"]`.

- [ ] **Step 1: Failing tests** — fixtures shaped like real responses (Greenhouse: `absolute_url`, `title`, `company_name`, `location.name`, `first_published`, escaped `content`; Lever: `text`, `hostedUrl`, `categories.location`, `workplaceType`, `country`, `createdAt`, `descriptionPlain`, `additionalPlain`): maps both providers; `skips invalid items` (missing title / non-https url → skipped count); Brazil filter (São Paulo kept, New York dropped, Lever `country: "BR"` kept); work model detection; state map (`Sao Paulo`, `São Paulo`, `SP`, `Rio de Janeiro`, `RJ`, unknown); company label override; description unescaped/stripped/clipped; errors: 404 → `{ error: "http_error", status: 404 }`, bad JSON, timeout, oversize; requests go to the fixed host with the board path; `htmlToText` move keeps `page-text` tests green.
- [ ] **Step 2: Run** `npx vitest run src/features/feeds src/shared` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): read Greenhouse and Lever job boards`

---

### Task 3: Feed sync, scheduling and admin routes

**Files:**

- Create: `apps/api/src/features/feeds/repository.ts`, `apps/api/src/features/feeds/routes.ts`
- Modify: `apps/api/src/app.ts` (`ingest_jobs` handler; due-feed scheduling inside the drain cron route; fan-out of `compute_matches` when a sync created jobs), `apps/api/src/features/background/routes.ts` (accept an optional `beforeDrain` hook), `apps/api/src/repositories.ts`, `vercel.json` (rewrite `/api/job-feeds` and `/api/job-feeds/:path*`)
- Test: `apps/api/src/features/feeds/repository.test.ts`, `apps/api/src/app.test.ts`

**Interfaces:**

- `createFeedsRepository(db)`: `list()`, `create({ provider, board, companyLabel })` (`"exists"` on unique violation), `update(id, { enabled?, companyLabel? })`, `remove(id)`, `get(id)`, `dueIds(now)`, `sync(feedId, result: FeedResult, now): Promise<{ created: number; updated: number; closed: number; skipped: number } | "failed">` (one transaction for the success path: upsert, reopen, close missing > 3 days scoped to this feed, update feed status; failure path only records `last_error` and `last_synced_at`).
- `FeedView = { id, provider, board, companyLabel, enabled, lastSyncedAt: string | null, lastError: string | null, openJobs: number }`.
- Admin routes (`permit: ["manage", "Integrations"]`): `GET /job-feeds`, `POST /job-feeds { provider, board, companyLabel? }` (201; 409 exists; 422 invalid board) → enqueue `ingest_jobs` and kick one targeted drain, `PATCH /job-feeds/:id { enabled?, companyLabel? }`, `DELETE /job-feeds/:id` (204; jobs keep existing).
- `ingest_jobs` handler (subject = feed id): feed missing or disabled → complete; `fetchFeed` (with the app's `fetch` option for tests); `sync`; when `created > 0` → fan out `compute_matches` like HR shares.
- Drain cron route: before draining, `enqueueMany("ingest_jobs", await feeds.dueIds(now))`.

- [ ] **Step 1: Failing tests** — `keeps jobs when a sync fails`; `closes missing jobs after three days and reopens returning ones`; `scopes closing to the feed` (another feed's and HR/recruiter jobs untouched; same source key from a different board distinct); upsert updates title/description of an existing external job; admin CRUD with role checks (rh → 403); POST enqueues and the kicked drain imports from a fake fetch; cron schedules only due enabled feeds; new jobs fan out `compute_matches`.
- [ ] **Step 2: Run** `npx vitest run src/features/feeds src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): import job boards in the background`

---

### Task 4: Partner recruiters

**Files:**

- Modify: `apps/api/src/features/jobs/routes.ts` + create `apps/api/src/features/jobs/share.ts` (extract the share pipeline as `shareJob(deps, { url, origin: "hr" | "recruiter", recruiterPartnerId?: string })` returning a typed outcome; the HR route keeps its exact behaviour), `apps/api/src/features/jobs/repository.ts` (`createShared` accepts `origin`/`recruiterPartnerId`; source `hr-link` for HR, `recruiter-link` for recruiters; `countByPartnerSince(partnerId, since)`)
- Create: `apps/api/src/features/recruiters/repository.ts`, `apps/api/src/features/recruiters/routes.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/repositories.ts`, `vercel.json` (rewrites `/api/recruiter-partners`, `/api/recruiter-partners/:path*`, `/api/recruiters/:path*`)
- Test: `apps/api/src/features/recruiters/repository.test.ts`, `apps/api/src/app.test.ts`

**Interfaces:**

- `createRecruitersRepository(db)`: `list()` (no hashes), `create({ name, company }) → { partner, token }` (token generated with `crypto.getRandomValues`, hash via `crypto.subtle.digest`), `revoke(id)`, `byToken(token): Promise<{ id: string } | undefined>` (active only).
- Admin routes (`permit: ["manage", "Integrations"]`): `GET /recruiter-partners`, `POST /recruiter-partners { name, company }` → 201 `{ partner, token, submitUrl }` (token shown once), `DELETE /recruiter-partners/:id` → 204 (revokes).
- Recruiter route: `POST /recruiters/jobs { url }` with `Authorization: Bearer` → 401 `{ error: "Unauthorized" }` for missing/unknown/revoked; 429 `{ error: "Daily limit reached" }` when the partner created ≥ 20 jobs today (São Paulo day); otherwise `shareJob` with origin `recruiter` → same status mapping as the HR share; new job fans out `compute_matches`. No session, no CORS credentials needed.

- [ ] **Step 1: Failing tests** — HR share behaviour unchanged (existing tests stay green); `guards recruiter submissions` (missing/unknown/revoked → 401 with nothing stored; 21st in a day → 429; next day allowed); recruiter job stored with origin `recruiter` and the partner id, deduped separately from HR shares of the same URL; token never returned by list; hash lookup; admin role checks.
- [ ] **Step 2: Run** `npx vitest run src/features/recruiters src/features/jobs src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `feat(api): let partner recruiters submit jobs with a token`

---

### Delivery

- [ ] Push `feat/talent-external-jobs`; open a PR with base `feat/talent-hr-aggregates` (stack … → #89 → this). Body: migration 0018; Gupy replaced by official Greenhouse/Lever board APIs (no public Gupy API); feeds seeded disabled; sync needs cron (`OFFBOARD_ENABLE_CRON=1`); recruiter submissions use AI extraction (AI key needed) and are capped at 20/day per partner; the dev recruiter token.
