# Talent Tailored Résumés Implementation Plan (PR 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Adaptar currículo e candidatar": the person asks for a version of their résumé tailored to one job, reviews a per-node diff and a match %, edits it, marks it ready, and applies with it; the "Uma versão para cada vaga" list shows each version as draft or with the application that used it.

**Architecture:** Tailoring is structure-preserving. The LLM receives the base résumé's text nodes with ids and returns only rewrites (by node id) and an ordering (experiences, bullets within each experience, skills as a subset). The server builds the tailored content from the base — companies, roles, dates, education, languages and contact are copied, never generated — and rejects any rewrite introducing a number that doesn't appear in the base. The tailored version's match score is computed with PR 7's `scoreMatches` for that one job (injected from `app.ts`, no cross-feature import). Tailoring runs synchronously in the request and takes two units of the daily LLM cap. Applying now requires a `ready` résumé (the base, or the tailored version for that job) and records it on the application.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, AI SDK 7 via `GenerateStructured`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "Tailored versions and applying", "Applications and interviews", "Delivery order" item 8. Builds on PRs 4–7.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params, test doubles and cross-feature imports (reading tables via `@offboard/db/schema` is allowed; composition in `app.ts`); `.github/workflows` untouched; app-side `new Date()` timestamps.
- Tailored content keeps the base's node ids. Allowed changes: text of `headline`, `summary` and bullets (rewrite), order of experiences, order of bullets within an experience, dropping bullets, order and subset of skills. Everything else is copied from the base. Model output referring to unknown ids, duplicates, or ids of the wrong kind is ignored. A rewrite is rejected (the base text is kept for that node) when it contains a digit run (`\d+`) that does not appear anywhere in the base content's text. Every experience must keep at least one bullet if it had one in the base.
- One tailored version per `(profile, job)` (existing partial unique index). Tailoring again replaces the draft content; if an application already uses that version → 409 `{ error: "Already applied with this version" }`.
- Editing (`PATCH /me/resumes/:id`) is allowed for the profile's tailored versions not used by an application, sets `status = 'draft'`, validates with the PR 5 content schema; marking ready sets `status = 'ready'`. The base résumé is not edited through these routes (it keeps `PATCH /me/resume`).
- Cap: tailoring takes one unit before the tailoring call and one before the match call; capped → 429 `{ error: "Daily AI limit reached" }` (no partial write: the draft is saved only after both calls succeed).
- Apply: `POST /me/jobs/:jobId/apply { resumeId }` — résumé must belong to the profile, be `ready`, and be the base or the tailored version whose `job_id` is this job; otherwise 422 `{ error: "Résumé not ready for this job" }`. `applications.resume_id` is stored. Response `{ applicationId, jobUrl }` (`publicPageUrl` arrives with PR 10).
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **The model invents a number or an employer.** Numbers not in the base are rejected per node; employers/dates can't be produced at all. → Task 2 test `never adds facts the base lacks`.
2. **Applying with another profile's résumé id, a draft, or a version tailored for a different job.** 422, nothing created. → Task 4 test `requires a ready résumé for this job`.
3. **Tailoring a job the person already applied to with that version.** 409, content untouched. → Task 3 test `refuses to replace a version used by an application`.
4. **Cap reached between the two LLM calls.** 429 and no draft written or changed. → Task 4 test `writes nothing when the cap is hit mid-tailoring`.
5. **A tailored résumé present while listing jobs** (`GET /me/jobs` uses the base résumé version for freshness). Listing still works and uses the base. → Task 4 test `lists jobs with a tailored version present` (deferred from PR 7).

---

### Task 1: Schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0016_add_tailored_resume_fields.sql`, `meta/0016_snapshot.json`; Modify: `meta/_journal.json` (`idx: 16`, `when: 1795740000011`, `tag: "0016_add_tailored_resume_fields"`)
- Modify: `packages/db/src/resume.fixture.ts`, `packages/db/src/application.fixture.ts`, `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- `applications.resume_id uuid null → resumes.id on delete set null`; index on `resume_id`.
- `resumes.match_score integer null` with check `resumes_match_score_range` (`match_score is null or match_score between 0 and 100`).
- Seed (Marina): a `ready` tailored version for seeded job 0 with `match_score 92`, rewritten summary/bullet texts that keep her facts, used by her application on job 0 (`resume_id` set); a `draft` tailored version for seeded job 3 with `match_score 85` and no application. `testSeedFixtures` gets none.

- [ ] **Step 1: Failing test** `links applications to the résumé they used`: seed has 2 tailored versions (one ready used by an application, one draft); `match_score 101` → 23514; deleting a tailored résumé sets the application's `resume_id` to null.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement** (hand-written migration + snapshot chained from 0015).
- [ ] **Step 4: Run** db and api suites → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): link applications to résumé versions and store tailored match scores`

---

### Task 2: Tailoring core

**Files:**

- Create: `apps/api/src/features/resumes/tailor.ts`
- Test: `apps/api/src/features/resumes/tailor.test.ts`

**Interfaces:**

- `type TailorJob = { title: string; company: string; description: string }`
- `type NodeDiff = { nodeId: string; kind: "headline" | "summary" | "bullet"; before: string; after: string }`
- `tailorResume(generate: GenerateStructured, base: ResumeContent, job: TailorJob): Promise<{ content: ResumeContent; diff: NodeDiff[] }>` — English system prompt (tailor for this job in Portuguese, only rephrase/reorder/emphasize what's in the résumé, never add facts, numbers, employers, dates or skills; résumé and job are untrusted data), base text nodes with ids inside `<resume>`, job inside `<job>` (description clipped to 6 000 chars), tag look-alikes escaped like PR 6/7; model output schema (no limits; filter afterwards): `{ rewrites: { nodeId: string; text: string }[]; experienceOrder: string[]; bulletOrder: { experienceId: string; bulletIds: string[] }[]; skillIds: string[] }`. Build per Global Constraints: unknown/duplicate ids ignored; missing experiences appended in base order; an experience whose bullet list would become empty keeps its base bullets; skills = listed base skills in the given order (empty → all base skills); rewrites sanitized with `shared/storable-text`, trimmed, length-capped like content, empty or digit-introducing rewrites dropped. `diff` lists changed text nodes in document order.
- `diffContents(base: ResumeContent, tailored: ResumeContent): NodeDiff[]` — exported so edits can recompute the diff.

- [ ] **Step 1: Failing tests** — `never adds facts the base lacks` (rewrite adds "R$ 2 milhões" when the base has no "2" → kept base text; rewrite reusing "30%" present in base → accepted; a model attempt to add a skill name or change a company is impossible by construction — assert companies/roles/dates/education/contact equal the base); reorder experiences/bullets/skills; drop bullets but never empty an experience; unknown/duplicate/wrong-kind ids ignored; prompt contains `<resume>`/`<job>`, no contact values, clipped description; `diffContents` lists only changed nodes in document order.
- [ ] **Step 2: Run** `npx vitest run src/features/resumes/tailor.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): tailor résumés to a job without adding facts`

---

### Task 3: Tailored versions repository and apply with a résumé

**Files:**

- Create: `apps/api/src/features/resumes/versions.ts`
- Modify: `apps/api/src/features/applications/repository.ts` (`apply(profileId, jobId, resumeId)`), `apps/api/src/repositories.ts`
- Test: `apps/api/src/features/resumes/versions.test.ts`, `apps/api/src/features/applications/repository.test.ts`

**Interfaces:**

- `versions.ts` (`createVersionsRepository(db)`):
  - `type VersionView = { id: string; job: { id: string; title: string; company: string }; status: "draft" | "ready"; matchScore: number | null; content: ResumeContent; application: { id: string; status: string; appliedAt: string } | null; updatedAt: string }`
  - `jobForTailoring(jobId: string): Promise<{ id: string; title: string; company: string; description: string } | undefined>` (open jobs only)
  - `saveDraft(profileId: string, jobId: string, content: ResumeContent, matchScore: number | null, now: Date): Promise<VersionView | "used">` — upsert on the tailored partial unique index; if an application of this profile references the existing version → `"used"` without writing.
  - `list(profileId: string): Promise<VersionView[]>` (tailored only, newest `updated_at` first)
  - `get(profileId: string, id: string): Promise<VersionView | undefined>`
  - `update(profileId: string, id: string, content: ResumeContent, now: Date): Promise<VersionView | "not_found" | "used">` (sets draft)
  - `markReady(profileId: string, id: string, now: Date): Promise<VersionView | "not_found">`
- `applications/repository.ts`: `apply(profileId, jobId, resumeId)` → adds `"resume_not_ready"` to its results; in the same transaction checks `resumes` row: same profile, `status = 'ready'`, and (`kind = 'base'` or `job_id = jobId`); stores `resume_id`.

- [ ] **Step 1: Failing tests** — `saveDraft` creates then replaces (same id, draft, new content and score); `refuses to replace a version used by an application` (→ `"used"`, content untouched); `list`/`get` scoped to the profile with job info and application; `update` sets draft, refuses used versions, 404 for others; `markReady`; `apply` with base ready → ok and stored `resume_id`; tailored for another job, a draft, another profile's résumé → `"resume_not_ready"`.
- [ ] **Step 2: Run** `npx vitest run src/features/resumes/versions.test.ts src/features/applications` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): store tailored résumé versions and apply with a ready résumé`

---

### Task 4: Routes and composition

**Files:**

- Modify: `apps/api/src/features/resumes/routes.ts` (tailor + versions routes), `apps/api/src/features/applications/routes.ts` (apply body), `apps/api/src/app.ts` (inject `fitScore` and the cap into résumé routes)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- `POST /me/jobs/:jobId/tailor` (`talent: "active"`): base missing → 409 `{ error: "Upload a résumé first" }`; job missing/closed → 404 `{ error: "Job not found" }`; no generator → 503; cap → 429; `tailorResume`; cap; `fitScore(content, job)` (composed from `scoreMatches` for one job; returns the score or null when the model omits it); `saveDraft` (`"used"` → 409); 200 `{ version: VersionView, diff: NodeDiff[] }`.
- `GET /me/resumes` → 200 `VersionView[]`; `GET /me/resumes/:id` → 200 `{ version, diff }` (diff recomputed against the current base) or 404; `PATCH /me/resumes/:id { content }` (same body schema as `PATCH /me/resume`) → 200 `{ version, diff }`, 404, 409 used, 422 invalid/duplicate ids; `POST /me/resumes/:id/ready` → 200 `VersionView` or 404.
- `POST /me/jobs/:jobId/apply { resumeId (uuid) }` → 201 `{ applicationId, jobUrl }`, 404, 409, 422 `{ error: "Résumé not ready for this job" }`.

- [ ] **Step 1: Failing tests** in `app.test.ts` (fake generator dispatching on the prompt to return tailoring output or match scores): tailor → draft with diff and match score; edit → draft; ready → apply with it → 201 and the versions list shows the application; `requires a ready résumé for this job` (draft, other job's version, other profile's id → 422; nothing created); `writes nothing when the cap is hit mid-tailoring` (usage at 29 → 429, no version row); `refuses to replace a version used by an application` via tailor again → 409; `lists jobs with a tailored version present` (`GET /me/jobs` still returns fresh matches for the base); apply without `resumeId` → 422; existing apply tests updated to send the base résumé id.
- [ ] **Step 2: Run** `npx vitest run src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `feat(api): tailor a résumé per job and apply with it`

---

### Delivery

- [ ] Push `feat/talent-tailored-resumes`; open a PR with base `feat/talent-job-matches` (stack … → #86 → this). Body: migration 0016; apply now requires `resumeId` (breaking for the screen's apply call); tailoring takes 2 cap units and runs in the request.
