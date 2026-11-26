# AI Apply Drafts Implementation Plan (AI Apply step 6, part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For an allowlisted, consenting person, prepare an AI application for a Greenhouse job: read the form's questions from Greenhouse, draft every answer from the person's allowed data, and let the person review, edit and confirm it. The confirmed attempt waits in `queued` for the browser runner (part 2).

**Architecture:** A new `ai-apply` feature owns the `ai_applications` attempts, the Greenhouse form reader, the drafting (deterministic fields plus one LLM call with code-side validation) and the attempt routes. Consent lives in the talent feature, profile fields in the preferences feature. Shared helpers handle the access gate and the share-filtered résumé. Part 2 (a separate plan and PR, after the Browserbase spike) adds the browser runner, rehearsal execution, evidence and `needs_check`.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, AI SDK 7 via `GenerateStructured`, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-talent-ai-apply-agent-design.md`. This plan covers these sections: "Access and consent", "Profile fields", "What can be applied to", "Attempts" (states, never-twice indexes, prepare/list/get/confirm/cancel routes), "Preparing the draft" and "Applications" (`channel`). Part 2 covers "Running the browser", "Evidence", the `check` route and the "Spike first" task.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test doubles and cross-feature imports (read other features' tables via `@offboard/db/schema`, compose in `app.ts`); `.github/workflows` untouched; app-side `new Date()` timestamps.
- **Gate (every `ai-apply` route):**
  - an active talent session (`talent: "active"`);
  - the account email (`talent_profiles.personal_email`, compared case-insensitively) in `AI_APPLY_ALLOWLIST` (comma-separated, trimmed);
  - AI Apply consent given;
  - AI configured.
  - Failing the allowlist or consent → 403 `{ error: "AI Apply not available" }`. No AI → 503 `{ error: "AI not configured" }`.
- **Consent:** `PUT /me/ai-apply/consent { accept: boolean }` uses `talent: "signed-in"`. It stores `ai_apply_consent_at` (null = none) and `ai_apply_consent_version` (current version `"2026-11-25"`). Withdrawing cancels the person's `draft` and `queued` attempts with reason `consent_withdrawn`.
- **New profile fields,** each `{ value, share }` like step 4:
  - `cpf`: 11 digits, valid check digits, not all-same digits. Input may include `.` and `-`, and it is stored digits-only.
  - `birthDate`: `YYYY-MM-DD`, a real date, the person at least 14 years old on the São Paulo date.
  - `address`: `{ cep: 8 digits (input may include "-"), street ≤ 200, number ≤ 20, complement ≤ 100 | null, neighborhood ≤ 100, city ≤ 100, state: UF }` with a single `share`.
  - `value: null` means unset.
- **AI-capable job:** open, `jobs.source = 'greenhouse'`, `source_key` matching `^[a-z0-9][a-z0-9_-]*:\d+$` (board:id).
- **Preparing requires:** a base résumé (409 `{ error: "Upload a résumé first" }`), no application for the job (409 `{ error: "Already applied" }`), not rejected (409 `{ error: "Job rejected" }`), no non-final attempt (409 `{ error: "Already in progress" }`). An unknown, closed or non-capable job → 404 `{ error: "Job not found" }`.
- **States** (enum `ai_application_state`):
  - All values: `draft`, `queued`, `running`, `submitting`, `submitted`, `rehearsed`, `assisted`, `needs_check`, `cancelled`.
  - Non-final states: `draft`, `queued`, `running`, `submitting` and `needs_check`. A unique partial index on `(profile_id, job_id)` allows only one non-final attempt.
  - Part 1 produces only `draft`, `queued`, `assisted` (reason `document_required`) and `cancelled`.
- **Drafting:**
  - One LLM call counts one cap unit (429 like tailoring when capped). Greenhouse unreachable or invalid → 502 `{ error: "Could not read the application form" }`. LLM failure → 502 `{ error: "Could not prepare the application" }`.
  - **Never invent:** select values must be among the options, `library`/`profile` text must equal the stored value, every text answer passes the step 4 digit guard (`shared/resume-digits.ts`), sensitive questions are never inferred, and library answers overlapping a not-shared field (salary expectation, start availability, notice period, LinkedIn) are never used.
- **Sensitive questions:** questions in Greenhouse `compliance` or `demographic_questions`, plus any regular question whose normalized label mentions deficiência/PcD/disability, raça/cor/etnia/race/ethnicity, gênero/gender/sexo, orientação sexual/sexual orientation, identidade de gênero, diversidade/diversity, or consentimento/consent. Errs toward sensitive.
- **Document upload:** a required `input_file` question other than résumé or cover letter (e.g. laudo) → the attempt is created directly as `assisted` with reason `document_required`.
- **Confirm:**
  - Allowed only from `draft`, within 7 days of `prepared_at`, with the job still open and not applied to. A draft older than that → 409 `{ error: "Draft expired" }`. Other conflicts reuse the messages above.
  - Every required non-file question must be filled, select values among options, text ≤ 2 000 chars after trim and sanitize. Otherwise 422 `{ error: "Invalid answers" }`.
  - Confirmed text and select answers to custom and sensitive questions are saved to the person's library (`ensureQuestion(label, now)` + `answer(profileId, id, text, now)`, multi-select joined with `"; "`).
  - The attempt becomes `queued`, storing `confirmed` and `rehearsal`. Nothing is enqueued in part 1.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A not-shared value reaching the draft or the LLM.** This covers a not-shared phone or CPF, and a salary library answer when `salaryExpectation.share` is false. Task 5 test: `keeps not-shared data out of the draft and the prompt`.
2. **A sensitive question answered by inference** (e.g. "Você é PcD?" with Sim/Não and no saved answer) → drafted blank with status `sensitive`; with a saved library answer → used. Task 5 test: `never infers sensitive questions`.
3. **Confirming twice, or confirming after applying by hand.** Two concurrent confirms leave one `queued`, and a manual application between preparing and confirming → 409. Task 6 test: `confirms once`.
4. **The model answering a select with text that isn't an option** (a label vs value mismatch, extra spaces, different case) → matched by normalized label, otherwise blank. Task 5 test: `matches select answers to options or drafts them blank`.
5. **Greenhouse returning 404, a closed job, HTML or malformed JSON** → 502 or 404 and no attempt row, with no cap unit spent before the form is read. Task 5 test: `handles unreadable forms`.

---

### Task 1: Schema and migration 0020

**Files:** `packages/db/src/schema/index.ts`; `packages/db/drizzle/0020_add_ai_applications.sql`, `meta/0020_snapshot.json`, `meta/_journal.json` (`idx: 20`, `when: 1795740000015`, `tag: "0020_add_ai_applications"`); `packages/db/test/database.test.ts`.

**Interfaces:**

- `talent_profiles` gains `ai_apply_consent_at timestamp null` and `ai_apply_consent_version varchar(20) null`.
- enum `application_channel` (`manual`, `ai_apply`) and `applications.channel` (not null, default `manual`).
- enum `ai_application_state` (Global Constraints values).
- `ai_applications`:
  - `id uuid pk`
  - `profile_id → talent_profiles on delete cascade`
  - `job_id → jobs on delete restrict`
  - `state` (not null, default `draft`)
  - `reason varchar(50) null`
  - `form jsonb not null`, `draft jsonb not null`, `confirmed jsonb null`
  - `rehearsal boolean not null default false`
  - `resume_id → resumes on delete set null`
  - `evidence jsonb null`, `screenshot_key varchar(512) null`
  - `prepared_at timestamp not null`, `confirmed_at null`, `finished_at null`, `created_at`, `updated_at`
  - unique partial index `ai_applications_active_idx` on `(profile_id, job_id)` where state in the non-final list
  - index on `(profile_id, created_at)`
- `ProfileFields` type gains `cpf?: ProfileField`, `birthDate?: ProfileField`, `address?: AddressField`. `AddressField = { value: Address | null; share: boolean }`, where `Address` is the address shape from Global Constraints.
- Exported types `FormQuestion`, `DraftAnswer`, `ConfirmedAnswer` (the jsonb shapes, defined in Task 4/5 Interfaces) live in the schema so the jsonb columns are typed.

- [ ] Steps: failing db test `stores AI applications` (the active-index rejects a second `draft` for the same pair with 23505 but allows one after `cancelled`; cascade on profile delete; `channel` defaults to `manual`; restrict on job delete) → hand-written migration chained from 0019, cross-checked with `npx drizzle-kit export` → db + api suites green → commit `feat(db): add AI application attempts, consent and channel`.

---

### Task 2: Profile fields for forms

**Files:** `apps/api/src/features/preferences/schema.ts`, `apps/api/src/shared/talent-preferences.ts` (`toPreferences` defaults `{ value: null, share: false }` for the three new fields), `apps/api/src/features/preferences/package.ts` (Assisted package lists the shared new fields after the existing order: `cpf` formatted `000.000.000-00`, `birthDate` as `DD/MM/YYYY`, `address` as one line `street, number[ - complement] - neighborhood, city - UF, CEP 00000-000`), account export (falls out of `toPreferences`), tests.

**Interfaces:** `isValidCpf(digits: string): boolean` in `apps/api/src/shared/cpf.ts`.

- [ ] Steps: failing tests are `validates CPF, birth date and address`, covering:
  - a valid CPF with a mask → stored as digits; a wrong check digit → 422; `111.111.111-11` → 422;
  - a 13-year-old → 422; `2026-02-30` → 422;
  - a CEP with a dash → stored as digits; `state: "XX"` → 422.

  Also: `GET` defaults for the new fields; the PUT merge keeps other fields; the package shows only the shared ones. Then implement → green → commit `feat(api): store CPF, birth date and address for application forms`.

---

### Task 3: AI Apply consent and access gate

**Files:** `apps/api/src/features/talent/{repository,routes}.ts` (`setAiApplyConsent`, the route, and `GET /me` gains `aiApply: { consented: boolean; available: boolean }` where `available` = allowlisted and consented and AI configured); `apps/api/src/shared/ai-apply-access.ts`; config wiring in `apps/api/src/app.ts` options (`aiApplyAllowlist: string[]`), `server.ts`, `worker.ts` (`AI_APPLY_ALLOWLIST` optional in `runtimeConfig`), `apps/web/cloudflare.config.ts` (bind `AI_APPLY_ALLOWLIST` as a secret only when `OFFBOARD_AI_APPLY_CONFIGURED === "1"`, the same pattern as `OFFBOARD_AI_CONFIGURED`); `apps/api/README.md` env table row.

**Interfaces:**

- `parseAllowlist(raw: string | undefined): string[]` (lowercased, trimmed, empty dropped).
- `aiApplyAccess(profile: { personalEmail: string; aiApplyConsentAt: Date | null }, allowlist: string[]): "allowed" | "not_allowed"`.
- Repository `setAiApplyConsent(profileId, accept: boolean, now: Date)`: accept sets the timestamp and version. Withdraw nulls both and, in the same transaction, cancels `draft`/`queued` attempts (`state = cancelled`, `reason = consent_withdrawn`, `finished_at = now`), reading `ai_applications` via `@offboard/db/schema`.

- [ ] Steps: failing tests are `stores AI Apply consent` (accept → `GET /me` consented, version stored; withdraw cancels a seeded `draft` and `queued` attempt but leaves a `submitted` one; another profile untouched; portal session → 403) and `parseAllowlist`/`aiApplyAccess` units (case-insensitive email, empty allowlist → `not_allowed`). Then implement → green → commit `feat(api): add the AI Apply consent and allowlist`.

---

### Task 4: Greenhouse form reader

**Files:** `apps/api/src/features/ai-apply/greenhouse.ts` (+ test, with a fixture `apps/api/src/features/ai-apply/fixtures/greenhouse-stone.json` captured once from a real Stone job via `curl 'https://boards-api.greenhouse.io/v1/boards/stone/jobs/<id>?questions=true'`, plus hand-made variants), `apps/api/src/features/ai-apply/questions.ts` (sensitivity and kind classification).

**Interfaces:**

- `type FormField = { name: string; type: "text" | "textarea" | "file" | "hidden" | "single_select" | "multi_select"; options: { label: string; value: string }[] }`
- `type FormQuestion = { id: string; label: string; required: boolean; section: "questions" | "location" | "compliance" | "demographic"; fields: FormField[]; kind: QuestionKind; sensitive: boolean }`
  - `id` is the first field's `name`, or `demographic:<id>`.
  - `QuestionKind = "first_name" | "last_name" | "email" | "phone" | "resume" | "cover_letter" | "linkedin" | "website" | "cpf" | "birth_date" | "address" | "document" | "custom"`.
- `readGreenhouseForm(fetchImpl: typeof fetch, board: string, jobId: string): Promise<{ questions: FormQuestion[] } | { error: "not_found" | "unreadable" }>`
  - URL `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}?questions=true`, 10 s timeout, body read through `shared/response-body.ts`.
  - Validated with Zod, and labels stripped of HTML via `shared/html-text.ts`.
  - `kind` comes from Greenhouse standard names (`first_name`, `last_name`, `email`, `phone`, `resume`/`resume_text`, `cover_letter`/`cover_letter_text`) or label patterns: LinkedIn, website/portfólio, CPF, data de nascimento, CEP/endereço. Any other `input_file` is `document`.
- `isSensitive(label: string, section): boolean` per Global Constraints.

- [ ] Steps: failing tests are `reads a Greenhouse form`, covering:
  - the Stone fixture → standard kinds found, CPF and birth date detected, the PcD question sensitive, required flags kept;
  - demographic and compliance → sensitive;
  - a laudo `input_file` → `document`;
  - 404 → `not_found`; HTML or invalid JSON → `unreadable`; a network error → `unreadable`.

  Then implement → green → commit `feat(api): read Greenhouse application forms`.

---

### Task 5: Drafting and `POST /me/jobs/:jobId/ai-apply`

**Files:** `apps/api/src/shared/shared-resume.ts` (share-filtered résumé), `apps/api/src/features/ai-apply/{draft,repository,routes}.ts` (+ tests), `apps/api/src/repositories.ts`, `apps/api/src/app.ts` (composition, `fetch` injected like sources).

**Interfaces:**

- `shareFilteredResume(content: ResumeContent, fields: ReturnType<typeof toPreferences>["profileFields"]): ResumeContent` blanks `contact.phone` unless `phone.share`, `contact.city` unless `city.share`, and drops `contact.links` entries unless `linkedin.share` (links containing `linkedin.com`) or `portfolio.share` (other links). Part 2 uses it for the uploaded PDF.
- `type DraftAnswer = { questionId: string; value: string | string[] | null; source: "account" | "profile" | "library" | "resume" | "cover_letter" | null; inferred: boolean; status: "filled" | "blank" | "not_shared" | "sensitive" }`. File questions (`resume`, `cover_letter`) are drafted `filled` with `value: null` and `source: "resume"` or `"cover_letter"`. A cover letter is `blank` when the package has none and the field isn't required. A required cover letter with none stored → `blank`, and confirm requires a letter: the person generates one through the step 4 route first.
- `draftAnswers(generate: GenerateStructured, input: { questions: FormQuestion[]; account: { name: string; email: string }; fields: profileFields; library: { question: string; answer: string }[]; resume: ResumeContent; coverLetter: string | null }): Promise<DraftAnswer[]>`
  - Deterministic kinds first. The name is split into first token and rest. Profile kinds are `not_shared` when not shared, `blank` when unset.
  - Library answers are matched by `normalizeQuestion`. Select library answers are matched to an option by normalized label.
  - Then one structured call for the remaining non-sensitive `custom` questions, with output `{ answers: { questionId, value, source, inferred }[] }` and the prompt following `preferences/cover-letter.ts` untrusted-data rules. It is skipped when there are no remaining questions, and then no cap unit is spent.
  - Code validation per Global Constraints. Failures become `blank`.
- Repository `createAttempt(profileId, jobId, { form, draft, state, reason, resumeId }, now)` returns the attempt view, or `"in_progress"` on 23505.
- `POST /me/jobs/:jobId/ai-apply` → 201 `{ attempt }`, where `attempt = { id, job: { id, title, company, url }, state, reason, questions: FormQuestion[], answers: DraftAnswer[], rehearsal, preparedAt, confirmedAt }`.
  - Order: gate, job, preconditions, read form (no cap), document check (→ `assisted` attempt, 201), cap, draft, store.

- [ ] Steps: failing tests are the Review Focus 1, 2, 4 and 5 tests above, plus:
  - `prepares a draft for a Greenhouse job`: fake fetch serving the fixture and fake `generateStructured`; the draft has deterministic fields filled from shared profile values, library answers reused, inferred answers flagged; one cap unit.
  - `creates an assisted attempt when a document is required`: no LLM call.
  - `rejects jobs that can't be AI-applied`: lever source, closed job, bad source key → 404; each 409 precondition.
  - Gate: not allowlisted → 403, no consent → 403, no AI → 503.

  Then implement → green → commit `feat(api): draft AI applications from Greenhouse forms`.

---

### Task 6: Attempts: list, get, confirm, cancel, export

**Files:** `apps/api/src/features/ai-apply/{repository,routes,confirm}.ts` (+ tests), account export and delete (`features/account/*`).

**Interfaces:**

- `GET /me/ai-applications` → `{ items: attempt[] }`, newest first.
- `GET /me/ai-applications/:id` → `attempt`. Another person's attempt or a malformed id → 404 `{ error: "Attempt not found" }`.
- `POST /me/ai-applications/:id/confirm { answers: { questionId: string; value: string | string[] | null }[]; rehearsal?: boolean }` → 200 `attempt` (state `queued`).
  - Validation per Global Constraints. File questions are not part of `answers`.
  - Unknown question ids → 422.
  - The state change is a conditional `UPDATE … WHERE state = 'draft'`, so concurrent confirms leave exactly one `queued`. The loser gets 409 `{ error: "Already in progress" }`.
- `POST /me/ai-applications/:id/cancel` → 200 `attempt` from `draft`/`queued` (reason `cancelled_by_person`), else 409 `{ error: "Cannot cancel" }`.
- Export gains `aiApplications: { job: { id, title, company }, state, reason, answers: { question: string; value: string | string[] | null }[], preparedAt, confirmedAt, finishedAt }[]`, using confirmed answers when present, else the draft. Delete cascades.

- [ ] Steps: failing tests are Review Focus 3 `confirms once` (`Promise.all` of two confirms), plus:
  - `saves confirmed answers to the library`: a sensitive answer is saved and reused by the next draft for another job; a multi-select is joined with `"; "`.
  - `rejects incomplete or invalid answers`: a required blank → 422; a select not among options → 422.
  - `expires drafts after 7 days`.
  - Cancel paths, isolation, and the export shape.

  Then implement → full verification `npm test && npm run lint -- --force && npm run format:check && npm run build -w @offboard/web` → commit `feat(api): review, confirm and cancel AI applications`.

---

### Delivery

- [ ] Push `feat/talent-ai-apply-agent`; open a PR with base `feat/talent-preferences` (#104). Body:
  - migration 0020;
  - part 1 of step 6: confirmed attempts stay `queued` until part 2 adds the Browserbase runner;
  - in prod, the allowlist needs `OFFBOARD_AI_APPLY_CONFIGURED` in the deploy env, which is a workflow change that needs Samuel's authorization; local testing uses `AI_APPLY_ALLOWLIST`;
  - Lever is out until Lever boards are in the catalog.
