# Talent Preferences Implementation Plan (AI Apply step 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back the Preferências screen: application mode and target titles, profile fields with share flags, job preferences, an answer library of employer questions, rejection reasons for suggested jobs; make preferences shape the Vagas list and matching; generate a cover letter and an Assisted package per job.

**Architecture:** A new `preferences` feature owns `talent_preferences` (mode, hybrid threshold, target titles, job preferences, profile fields with share flags), the answer library (`answer_questions` catalog of normalized question texts — seeded common ones plus ones collected later by the agent — and `talent_answers`), and `job_rejections`. The jobs listing reads preferences and rejections (tables via `@offboard/db/schema`) to hide rejected jobs and rank jobs that fit preferences first. Matching adds target titles to its search terms. A cover letter is generated per (person, job) with the same "no new facts" guard as tailoring and stored in `application_packages`; the Assisted package bundles the ready résumé, the cover letter, the person's library answers and the apply URL.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, AI SDK 7 via `GenerateStructured`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-talent-ai-apply-design.md` — "Preferences (Preferências screen)", "Applying" (package, Assisted), "Delivery order" item 4.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test doubles and cross-feature imports (read other features' tables via `@offboard/db/schema`; compose in `app.ts`); `.github/workflows` untouched; app-side `new Date()` timestamps; all `/me/*` routes use the talent macro (`"active"` unless stated).
- Modes: `automatic`, `hybrid`, `review` (default `review`); `hybridThreshold` integer 50–100 (default 75). Storing a mode is allowed on any tier; enforcement (Plano X, consent) arrives with the agent (steps 5–7).
- Target titles: 0–20 strings, each 2–100 chars, trimmed, case-insensitive dedupe, sanitized like résumé text.
- Job preferences: `workModels` subset of remote/hybrid/onsite (empty = any); `locations` up to 20 `{ city: string | null; state: UF }` (empty = anywhere); `relocate` boolean; `salaryFloorCents` integer ≥ 0 or null; `seniorities` subset of `intern | junior | mid | senior | lead | manager | director` (empty = any); `excludedCompanies` up to 50 strings (case-insensitive match against `jobs.company`).
- Profile fields, each `{ value: string | null; share: boolean }`: `phone`, `city`, `linkedin`, `portfolio`, `workAuthorization`, `availability`, `noticePeriod`, `salaryExpectation`. Only `share: true` fields may ever be sent to employers (enforced in the package and later by the agent).
- A job **fits preferences** when: work model in `workModels` (or empty, or job work model null), location matches one of `locations` by state and, if given, city (or empty, or job is remote, or `relocate` is true), company not excluded, salary unknown or `salaryMaxCents >= salaryFloorCents`. Seniority isn't checked yet (jobs have no seniority field) — stored only.
- Rejections: reasons `salary | location | company | seniority | work_model | not_interested | other` plus optional note (≤ 500); a rejected job never appears in `GET /me/jobs` and is never auto-applied (later steps).
- Answer library: `answer_questions` (`id`, `normalized` unique, `text`, `common` bool); normalization = lowercase, accents stripped, whitespace collapsed, trailing punctuation removed. Seed ~10 common Brazilian questions (pretensão salarial, disponibilidade para início, aviso prévio, PcD autodeclaração, como soube da vaga, disponibilidade para viagens, aceita modelo presencial, possui CNH, nível de inglês, LinkedIn). Answers ≤ 2 000 chars; empty answer deletes it.
- Cover letter: Portuguese, ≤ 1 500 chars, built from the base or the job's ready tailored résumé + job; rejected if it introduces a digit run absent from the résumé (same guard idea as tailoring); one LLM cap unit; regenerating replaces it.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A rejected job reappearing** in `/me/jobs` (any page, any filter) or being matched again. → Task 4 test `hides rejected jobs`.
2. **Preferences filtering too much**: empty preferences must change nothing; a remote job fits any location. → Task 4 test `ranks jobs that fit preferences first`.
3. **Non-shared profile fields leaking** into the Assisted package. → Task 5 test `keeps non-shared fields out of the package`.
4. **A cover letter inventing a number** (e.g. "aumentei vendas em 40%" when 40 isn't in the résumé). Rejected, nothing stored, 502. → Task 5 test.
5. **Question normalization collisions**: "Qual sua pretensão salarial?" and "qual a sua pretensao salarial" — one library entry, not two (normalization only; the "a"/no "a" difference is acceptable as two entries). → Task 3 test.

---

### Task 1: Schema, migration and seed

**Files:** `packages/db/src/schema/index.ts`; `packages/db/drizzle/0019_add_preferences.sql`, `meta/0019_snapshot.json`, `meta/_journal.json` (`idx: 19`, `when: 1795740000014`, `tag: "0019_add_preferences"`); fixtures + `seed-database.ts`; `packages/db/test/database.test.ts`.

**Interfaces:** enum `application_mode` (`automatic`, `hybrid`, `review`); `talent_preferences` (`profile_id uuid pk → talent_profiles on delete cascade`, `mode` default `review`, `hybrid_threshold integer not null default 75` check 50–100, `target_titles jsonb not null default '[]'`, `job_preferences jsonb not null default '{}'`, `profile_fields jsonb not null default '{}'`, `created_at`, `updated_at`); `answer_questions` (`id uuid pk`, `normalized varchar(500) unique not null`, `text varchar(500) not null`, `common boolean not null default false`, `created_at`); `talent_answers` (`profile_id → talent_profiles cascade`, `question_id → answer_questions cascade`, `answer text not null`, `updated_at`; pk (profile_id, question_id)); enum `rejection_reason` (values above); `job_rejections` (`profile_id → talent_profiles cascade`, `job_id → jobs cascade`, `reason`, `note varchar(500) null`, `created_at`; pk (profile_id, job_id)); `application_packages` (`profile_id → talent_profiles cascade`, `job_id → jobs cascade`, `cover_letter text not null`, `created_at`, `updated_at`; pk (profile_id, job_id)). Seed: the common questions (normalized), Marina's preferences (mode `hybrid`, titles "Analista de Marketing", "Marketing de Produto", "Growth"; workModels remote+hybrid; locations SP; profile fields with phone not shared, LinkedIn shared), answers to 8 of the 10 common questions (2 left unanswered, matching the design's banner), one rejection with reason `salary`.

- [ ] Steps: failing db test (constraints, cascades, seed counts incl. 2 unanswered) → implement (hand-written migration chained from 0018) → db + api suites green → commit `feat(db): add preferences, answer library, rejections and packages`.

---

### Task 2: Preferences and profile routes

**Files:** create `apps/api/src/features/preferences/{schema,repository,routes}.ts` (+ tests); modify `apps/api/src/repositories.ts`, `apps/api/src/app.ts`, account export (`apps/api/src/features/account/*`: include preferences, answers with question text, rejections, packages).

**Interfaces:** Zod schemas for `jobPreferences` and `profileFields` (Global Constraints) used on write; `GET /me/preferences` → `{ mode, hybridThreshold, targetTitles, jobPreferences, profileFields }` (defaults when no row); `PUT /me/preferences` (partial; validated; upsert) → same shape. Changing `targetTitles` enqueues `compute_matches` for the person (composition).

- [ ] Steps: failing tests (defaults; validation 422s; partial update; another profile isolated; export includes them; titles change enqueues matching) → implement → green → commit `feat(api): store application mode, titles, job preferences and profile fields`.

---

### Task 3: Answer library

**Files:** `apps/api/src/features/preferences/answers.ts` (+ test), routes in the same feature.

**Interfaces:** `normalizeQuestion(text: string): string`; repository `library(profileId)` → `{ questions: { id, text, common, answer: string | null }[]; unanswered: number }` (common questions + any question the person has answered or that was collected for them later; ordered common first then text); `answer(profileId, questionId, text)` (empty → delete); `ensureQuestion(text) → id` (upsert by normalized; used by the agent later). Routes: `GET /me/answers`, `PUT /me/answers/:questionId { answer }` (404 unknown question).

- [ ] Steps: failing tests (normalization collisions, unanswered count = common questions without answer, isolation, empty answer deletes) → implement → green → commit `feat(api): add the answer library`.

---

### Task 4: Rejections and preference-aware listing and matching

**Files:** preferences feature (rejections repository + routes), `apps/api/src/features/jobs/repository.ts` (`listForTalent` reads preferences + rejections), `apps/api/src/features/jobs/routes.ts` (response adds `fitsPreferences: boolean`), `apps/api/src/features/matches/terms.ts` + handler composition (target titles added first to search terms; rejected jobs skipped as candidates).

**Interfaces:** `POST /me/jobs/:jobId/reject { reason, note? }` → 204 (404 unknown/closed job; idempotent overwrite); `DELETE /me/jobs/:jobId/reject` → 204; `GET /me/rejections` → `{ items: { job: { id, title, company }, reason, note, createdAt }[]; reasons: { reason, count }[] }`. `GET /me/jobs` excludes rejected jobs and orders: fits-preferences first, then the existing order (match score desc, unmatched newest).

- [ ] Steps: failing tests (`hides rejected jobs`; `ranks jobs that fit preferences first` incl. empty preferences no-op, remote fits any location, relocate, excluded company case-insensitive, salary floor with unknown salary fitting; matching search terms start with titles; rejected not in candidates) → implement → green → commit `feat(api): reject jobs with a reason and rank by preferences`.

---

### Task 5: Cover letter and Assisted package

**Files:** `apps/api/src/features/preferences/cover-letter.ts` (or a new `packages` feature — implementer's call; no cross-feature imports), routes, composition in `app.ts` (reads the ready résumé for the job: tailored ready version if any else base).

**Interfaces:** `writeCoverLetter(generate, resume: ResumeContent, job: { title; company; description }) → string | "invented_numbers"`; `POST /me/jobs/:jobId/cover-letter` → 200 `{ coverLetter }` (cap unit; 429/503/502 like tailoring; nothing stored on rejection); `GET /me/jobs/:jobId/package` → `{ job: { title, company, url }, resume: { id, kind }, coverLetter: string | null, profile: { field: value }[] (shared only), answers: { question, answer }[] (answered library entries) }`.

- [ ] Steps: failing tests (`keeps non-shared fields out of the package`; invented number → 502 and nothing stored; regenerate replaces; package uses the tailored ready version when present; other profile 404) → implement → full verification `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web` → commit `feat(api): write cover letters and assemble the Assisted package`.

---

### Delivery

- [ ] Push `feat/talent-preferences`; open a PR with base `feat/talent-external-jobs` (#100). Body: migration 0019; modes are stored but not enforced until the agent (Plano X + consent); seniority stored only; collected questions arrive with the agent.
