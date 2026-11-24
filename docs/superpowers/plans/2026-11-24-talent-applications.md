# Talent Applications Implementation Plan (PR 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A talent with active access applies to an open job, moves each application through the funnel, logs interviews, and reads the funnel summary and the week's interview agenda — the data behind Davi's Candidaturas screen.

**Architecture:** A new `applications` feature slice owns three tables (`applications`, `application_events`, `interviews`). Funnel rules live in a pure module (`funnel.ts`) so transitions and counts are unit-tested without a database; the repository applies them inside transactions with row locks. Every query is scoped by the session's `profileId`; an id belonging to another profile is indistinguishable from a missing one (404).

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "Applications and interviews", "Tailored versions and applying" (apply contract), "Delivery order" item 4 ("apply (without tailoring)"). Builds on PR 2 (talent access macro in `apps/api/src/shared/talent-access.ts`) and PR 3 (`jobs` table).

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `.github/workflows` untouched.
- Features import only themselves, `shared` and `@offboard/*`; reading the shared `jobs` table from `@offboard/db/schema` for joins is allowed, importing `features/jobs` is not.
- All `/me/*` routes use the talent macro in `"active"` mode; every repository function takes `profileId` first and filters by it; another profile's ids answer 404.
- Stages in order: `sent` < `in_review` < `interview` < `offer`; `closed` is terminal. Allowed transitions: any strictly later stage, or `closed` (with `closedReason` required) from any non-closed status. Anything else (same status, backwards, from `closed`, `closedReason` without `closed`) → 409 `{ error: "Invalid status transition" }`.
- `furthest_stage` records the furthest stage ever reached. Closing as `hired` sets it to `offer` (a hire implies an offer).
- Funnel counts: `sent` = all applications; `responded` = `furthest_stage >= in_review` or `closed_reason in (rejected, hired)`; `interviews` = `furthest_stage >= interview`; `offers` = `furthest_stage = offer`.
- Interview agenda dates are São Paulo calendar days at fixed offset `-03:00` (Brazil has no DST since 2019); `to` is inclusive; span at most 31 days.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **Another profile's application or interview id** in PATCH / POST interview / DELETE interview. Must be 404 and change nothing. → Task 4 test `hides other profiles' applications`.
2. **Concurrent status changes on the same application** (two PATCHes racing). The row lock must serialize them so `furthest_stage` and events stay consistent. → Task 3 test `serializes concurrent status changes`.
3. **Interview logged on a closed application.** Must be 409 and not reopen it. → Task 3 test `rejects interviews on closed applications`.
4. **Applying to a closed or unknown job, or twice.** 404 for unknown/closed, 409 `{ error: "Already applied" }` for a repeat. → Task 4 test `applies once to open jobs`.
5. **Agenda range at the day boundary**: an interview at 23:30 São Paulo on `to` is included; one at 00:30 São Paulo the day after is not. → Task 3 test `bounds the agenda by São Paulo days`.

---

### Task 1: Schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0012_add_applications.sql`, `packages/db/drizzle/meta/0012_snapshot.json`; Modify: `packages/db/drizzle/meta/_journal.json` (`idx: 12`, `when: 1795740000007`, `tag: "0012_add_applications"`)
- Create: `packages/db/src/application.fixture.ts`; Modify: `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Produces enums: `application_status` (`sent`, `in_review`, `interview`, `offer`, `closed`), `application_closed_reason` (`rejected`, `withdrawn`, `hired`), `interview_mode` (`video`, `in_person`, `phone`).
- Produces `applications`: `id uuid pk`, `profile_id uuid not null → talent_profiles.id on delete cascade`, `job_id uuid not null → jobs.id on delete restrict`, `status application_status not null default 'sent'`, `furthest_stage application_status not null default 'sent'`, `closed_reason application_closed_reason null`, `applied_at timestamp not null default now()`, `status_changed_at timestamp not null default now()`, `created_at`, `updated_at`; unique `applications_profile_job_idx` on `(profile_id, job_id)`; index on `profile_id`; checks `applications_closed_reason` (`(status = 'closed') = (closed_reason is not null)`) and `applications_furthest_stage` (`furthest_stage <> 'closed'`).
- Produces `application_events`: `id uuid pk`, `application_id uuid not null → applications.id on delete cascade`, `status application_status not null`, `closed_reason application_closed_reason null`, `created_at timestamp not null default now()`; index on `application_id`.
- Produces `interviews`: `id uuid pk`, `application_id uuid not null → applications.id on delete cascade`, `starts_at timestamp with time zone not null`, `mode interview_mode not null`, `with_whom varchar(255) not null`, `notes text not null default ''`, `created_at`, `updated_at`; index on `(application_id)` and on `starts_at`.
- Produces seed: for the seeded talent profile (Marina), one application per seeded job with statuses `interview` (furthest `interview`), `interview`, `sent`, `in_review` (furthest matching), applied 1, 6, 5 and 9 days ago, each with matching events; one interview on the first `interview` application at 10:00 São Paulo two days from seeding, mode `video`, with "RH da Mercado Fino". `testSeedFixtures` gets no applications.

- [ ] **Step 1: Failing test** `stores applications with one per job and a consistent closed reason`: default seed yields the fixture counts for all three tables; a second application for the same `(profile_id, job_id)` → 23505; `status = 'closed'` without reason → 23514; `closed_reason` with `status = 'sent'` → 23514; `furthest_stage = 'closed'` → 23514; deleting the talent profile removes its applications, events and interviews; deleting a job with applications → 23503.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement** schema, hand-written migration and snapshot (same procedure as 0010/0011: copy `0011_snapshot.json`, chain `prevId`), fixture and seed (delete order: interviews, events, applications before jobs and talent profiles).
- [ ] **Step 4: Run** `npm test -w @offboard/db` and `npm test -w @offboard/api` → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): add applications, events and interviews`

---

### Task 2: Funnel rules

**Files:**

- Create: `apps/api/src/features/applications/funnel.ts`
- Test: `apps/api/src/features/applications/funnel.test.ts`

**Interfaces:**

- Produces:
  - `type Stage = "sent" | "in_review" | "interview" | "offer"`; `type ApplicationStatus = Stage | "closed"`; `type ClosedReason = "rejected" | "withdrawn" | "hired"`
  - `type FunnelState = { status: ApplicationStatus; closedReason: ClosedReason | null; furthestStage: Stage }`
  - `transition(current: FunnelState, change: { status: ApplicationStatus; closedReason?: ClosedReason }): FunnelState | "invalid_transition"`
  - `summarize(rows: Pick<FunnelState, "closedReason" | "furthestStage">[]): { sent: number; responded: number; interviews: number; offers: number }`
  - `saoPauloDayRange(from: string, to: string): { start: Date; end: Date } | "invalid_range"` — `start` = `${from}T00:00:00-03:00`, `end` = day after `to` at `00:00:00-03:00` (exclusive); `"invalid_range"` when `to < from` or the span exceeds 31 days.

- [ ] **Step 1: Failing tests** — table-driven over every `(status, change)` pair: forward moves update `status` and raise `furthestStage`; skipping (`sent` → `offer`) sets `furthestStage: "offer"`; same/backward/from-closed/closed-without-reason/reason-without-closed → `"invalid_transition"`; closing keeps `furthestStage` except `hired` → `"offer"`. `summarize`: the spec's examples (interview→rejected counts as interview and responded; `sent`→withdrawn counts only as sent; `sent`→`offer` counts responded+interview+offer; `sent`→hired counts responded+interview+offer). `saoPauloDayRange("2026-11-23","2026-11-29")` → start `2026-11-23T03:00:00.000Z`, end `2026-11-30T03:00:00.000Z`; reversed and 32-day spans → `"invalid_range"`.
- [ ] **Step 2: Run** from `apps/api`: `npx vitest run src/features/applications/funnel.test.ts` → FAIL.
- [ ] **Step 3: Implement** (pure, no imports beyond types).
- [ ] **Step 4: Run** → PASS; full `npm test -w @offboard/api` at 100%.
- [ ] **Step 5: Commit** `feat(api): add application funnel rules`

---

### Task 3: Applications repository

**Files:**

- Create: `apps/api/src/features/applications/repository.ts`
- Modify: `apps/api/src/repositories.ts` (`applications: createApplicationsRepository(db)`)
- Test: `apps/api/src/features/applications/repository.test.ts`

**Interfaces:**

- Consumes: `transition`, `summarize`, `FunnelState`, `ApplicationStatus`, `ClosedReason` (Task 2).
- Produces (`createApplicationsRepository(db)`):
  - `type ApplicationView = { id: string; status: ApplicationStatus; closedReason: ClosedReason | null; appliedAt: string; statusChangedAt: string; job: { id: string; title: string; company: string; workModel: "remote" | "hybrid" | "onsite" | null; city: string | null; state: string | null } }`
  - `type InterviewView = { id: string; applicationId: string; startsAt: string; mode: "video" | "in_person" | "phone"; with: string; notes: string; job: { title: string; company: string } }`
  - `apply(profileId: string, jobId: string): Promise<{ applicationId: string; jobUrl: string } | "job_not_found" | "already_applied">` — job must exist with `closed_at is null`; inserts application + a `sent` event in one transaction.
  - `list(profileId: string): Promise<ApplicationView[]>` — newest `applied_at` first.
  - `summary(profileId: string): Promise<{ sent: number; responded: number; interviews: number; offers: number }>`
  - `changeStatus(profileId: string, applicationId: string, change: { status: ApplicationStatus; closedReason?: ClosedReason }): Promise<ApplicationView | "not_found" | "invalid_transition">` — transaction, `select … for update` scoped by profile, `transition`, update (`status_changed_at = now()`), insert event.
  - `addInterview(profileId: string, applicationId: string, input: { startsAt: Date; mode: InterviewView["mode"]; with: string; notes?: string }): Promise<InterviewView | "not_found" | "application_closed">` — same lock; if status is earlier than `interview`, applies `transition(…, { status: "interview" })` and records the event.
  - `removeInterview(profileId: string, interviewId: string): Promise<boolean>`
  - `interviewsBetween(profileId: string, start: Date, end: Date): Promise<InterviewView[]>` — `start <= starts_at < end`, ascending.
  - `type ApplicationsRepository = ReturnType<typeof createApplicationsRepository>`

- [ ] **Step 1: Failing tests** (PostgreSQL; create profiles with `repos.talent.enable` and jobs with direct inserts): `apply` happy path, `already_applied`, closed job → `job_not_found`, unknown job → `job_not_found`; `list` order and job fields; `summary` after a sequence of `changeStatus` calls equals `summarize` of the spec examples; `changeStatus` writes one event per change and returns `invalid_transition` unchanged; another profile → `not_found`; `serializes concurrent status changes` (two `changeStatus` to `interview` and `offer` via `Promise.all` → final `furthestStage` is `offer`, exactly one of them may be invalid, events count matches successful changes); `addInterview` promotes `sent` → `interview` with an event, keeps `offer` as is, `rejects interviews on closed applications`, other profile → `not_found`; `removeInterview` true/false incl. other profile → false; `bounds the agenda by São Paulo days` (interviews at `2026-11-29T23:30:00-03:00` included and `2026-11-30T00:30:00-03:00` excluded for range 23–29).
- [ ] **Step 2: Run** `npx vitest run src/features/applications` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` at 100%.
- [ ] **Step 5: Commit** `feat(api): add applications repository`

---

### Task 4: Routes and composition

**Files:**

- Create: `apps/api/src/features/applications/routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: `ApplicationsRepository` (Task 3), `saoPauloDayRange` (Task 2), `TalentAccessPlugin` from `shared/talent-access.ts`.
- Produces `applicationsRoutes(repos: ApplicationsRepository, talentAccess: TalentAccessPlugin)`, all `talent: "active"`, profile id from the macro's `me.id`:
  - `POST /me/jobs/:jobId/apply` (uuid param) → 201 `{ applicationId, jobUrl }`, 404 `{ error: "Job not found" }`, 409 `{ error: "Already applied" }`.
  - `GET /me/applications` → 200 `ApplicationView[]`.
  - `GET /me/applications/summary` → 200 `{ sent, responded, interviews, offers }`.
  - `PATCH /me/applications/:id { status, closedReason? }` → 200 `ApplicationView`, 404 `{ error: "Application not found" }`, 409 `{ error: "Invalid status transition" }`.
  - `POST /me/applications/:id/interviews { startsAt (format date-time), mode, with (1–255), notes? (≤ 2000) }` → 201 `InterviewView`, 404, 409 `{ error: "Application is closed" }`.
  - `DELETE /me/interviews/:id` → 204 or 404 `{ error: "Interview not found" }`.
  - `GET /me/interviews?from=YYYY-MM-DD&to=YYYY-MM-DD` (both required, `format: "date"`) → 200 `InterviewView[]`, 422 `{ error: "Invalid date range" }` for `"invalid_range"`.

- [ ] **Step 1: Failing tests** in `app.test.ts` (talent sessions via `x-test-session: talent` + `x-test-talent-id`, terms accepted; seed a job inline): `applies once to open jobs`; `moves an application through the funnel` (PATCH sequence + summary numbers + 409 on backwards); `logs interviews and lists the week` (POST interview promotes to `interview`; GET range returns it; DELETE then 404); `hides other profiles' applications` (second profile: PATCH/POST interview/DELETE → 404, list empty); `validates the agenda range` (`to < from` and 32-day span → 422; missing params → 422); lapsed and portal sessions → 402 / 403 on one route each.
- [ ] **Step 2: Run** `npx vitest run src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** routes and composition.
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web` → all pass.
- [ ] **Step 5: Commit** `feat(api): expose applications, funnel and interview agenda`

---

### Delivery

- [ ] Push `feat/talent-applications`; open a PR with base `feat/talent-jobs-catalog` (stack #77 → #78 → #79 → this). Body: migration 0012 before deploy; `resume_id` and `publicPageUrl` from the spec's apply contract arrive with résumés (PR 5/8/10); hired implies offer in the funnel.
