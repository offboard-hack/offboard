# Talent Base Résumé Implementation Plan (PR 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A talent with active access uploads a PDF or DOCX résumé, the server stores the original and an LLM turns it into a structured base résumé the person can read and edit; the person can also export all their data and delete their account.

**Architecture:** A `resumes` feature owns the `resumes` table, the content schema (every editable text node has a stable id), file sniffing, DOCX-to-text and LLM extraction. An `account` feature owns export and deletion; it reads the talent-owned tables directly from `@offboard/db` and removes stored files. Storage sits behind a small `ObjectStorage` interface: R2 on the Worker, a local directory on the Node server; when no storage is configured, upload answers 503. `shared/ai.ts` gains optional file input so PDFs go to the model as documents.

**Tech Stack:** Elysia 1.4 (multipart via `t.File`), Drizzle 0.45 + PostgreSQL, AI SDK 7 (`generateText` + `Output.object` with a file content part), `fflate` for DOCX unzip, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "Résumé" (content schema, upload, GET/PATCH), "Privacy and data rights" (export, delete), "Delivery order" item 5. Scoring and suggestions are PR 6; tailored versions PR 8.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `.github/workflows` untouched; lint forbids explicit return types, `as` casts, `(x: unknown)` callback params and test doubles like `mockImplementation`.
- Features import only themselves, `shared` and `@offboard/*`; reading other features' tables from `@offboard/db/schema` is allowed, importing other `features/*` is not. Files importing `node:*` are only imported by `server.ts`/`vercel.ts`.
- All `/me/*` routes use the talent macro (`shared/talent-access.ts`) in `"active"` mode, except `GET /me/export` and `DELETE /me`, which use `"signed-in"` (a lapsed person can still export and delete).
- Upload: one file field `file`, ≤ 5 MB (5 242 880 bytes); accepted only when the bytes are a PDF (`%PDF-` prefix) or a DOCX (ZIP containing `word/document.xml`); the declared MIME type alone never decides. Storage key `resumes/<profileId>/<uuid>.pdf|.docx`.
- LLM via `GenerateStructured` (AI Gateway, zero data retention). PDFs are sent as a file part (`mediaType: "application/pdf"`); DOCX text is extracted server-side and sent as text, truncated to 60 000 chars. The page/document content is wrapped as untrusted data like PR 3's `<page>` block (`<document>…</document>`).
- One base résumé per profile; upload replaces it (same row id kept), and the previous stored file is deleted after the new one is saved.
- Writes use app-side `new Date()` for timestamps (no SQL `now()`), as PR 4 established.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A file that claims `application/pdf` but is an executable or HTML.** Must be 422 `{ error: "Unsupported file" }` with nothing stored. → Task 3 test `sniffs file types from bytes`.
2. **A DOCX zip bomb** (tiny archive expanding `word/document.xml` to hundreds of MB). Must stop at a cap (2 000 000 bytes of XML) and answer 422. → Task 3 test `caps docx expansion`.
3. **Upload whose extraction fails after the file was stored.** The stored object must be deleted; no orphan. → Task 5 test `cleans up the stored file when extraction fails`.
4. **PATCH content with duplicate or missing node ids, or nodes the client invented ids for.** Missing ids are assigned; duplicate ids → 422. → Task 3 test `assigns and validates node ids`.
5. **Account deletion while files exist.** Every stored file for the profile is deleted and the profile row (and its cascades) removed; storage failure must not leave the DB row (delete files first, then the row; a storage error answers 502 and changes nothing). → Task 4 test `deletes files before the profile` and Task 5 test `deletes the account`.

---

### Task 1: Résumé schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0013_add_resumes.sql`, `packages/db/drizzle/meta/0013_snapshot.json`; Modify: `packages/db/drizzle/meta/_journal.json` (`idx: 13`, `when: 1795740000008`, `tag: "0013_add_resumes"`)
- Create: `packages/db/src/resume.fixture.ts`; Modify: `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Produces enums `resume_kind` (`base`, `tailored`) and `resume_status` (`draft`, `ready`).
- Produces `resumes`: `id uuid pk`, `profile_id uuid not null → talent_profiles.id on delete cascade`, `kind resume_kind not null`, `status resume_status not null default 'ready'`, `job_id uuid null → jobs.id on delete restrict`, `content jsonb not null`, `score integer null`, `scored_at timestamp null`, `source_file_key varchar(512) null`, `created_at`, `updated_at`; partial unique index `resumes_one_base_idx` on `(profile_id) where kind = 'base'`; unique index `resumes_profile_job_idx` on `(profile_id, job_id) where kind = 'tailored'`; checks `resumes_kind_job` (`(kind = 'base') = (job_id is null)`), `resumes_base_ready` (`kind <> 'base' or status = 'ready'`), `resumes_score_range` (`score is null or score between 0 and 100`).
- Produces seed: Marina's base résumé (no file, `score: null`) with realistic marketing content in the content shape Task 3 defines (copy the shape from the plan's Task 3 interfaces; ids as fixed UUID strings). `testSeedFixtures` gets none.

- [ ] **Step 1: Failing test** `stores one base résumé per profile`: default seed has Marina's base; a second base for the same profile → 23505; a base with `job_id` → 23514; a tailored without `job_id` → 23514; a base `draft` → 23514; `score: 101` → 23514; deleting the profile removes the résumé.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement** (hand-written migration + snapshot chained from 0012, same procedure as before; seed delete order: résumés before jobs and talent profiles).
- [ ] **Step 4: Run** db and api suites → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): add resumes table`

---

### Task 2: Object storage and file input for the LLM

**Files:**

- Create: `apps/api/src/shared/object-storage.ts`, `apps/api/src/shared/disk-storage.ts`
- Modify: `apps/api/src/shared/ai.ts`
- Test: `apps/api/src/shared/object-storage.test.ts`, `apps/api/src/shared/disk-storage.test.ts`, `apps/api/src/shared/ai.test.ts`

**Interfaces:**

- Produces in `object-storage.ts` (no `node:` imports):
  - `type ObjectStorage = { put(key: string, data: Uint8Array, contentType: string): Promise<void>; remove(keys: string[]): Promise<void> }`
  - `type R2BucketLike = { put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>; delete(keys: string | string[]): Promise<void> }`
  - `r2Storage(bucket: R2BucketLike): ObjectStorage` — `remove([])` is a no-op; deletes in batches of 1000.
- Produces in `disk-storage.ts` (uses `node:fs/promises`, `node:path`): `diskStorage(root: string): ObjectStorage` — writes under `root`, creating directories; rejects keys containing `..`, absolute paths or backslashes (throws); `remove` ignores missing files.
- Modifies `ai.ts`: `GenerateStructured` request gains optional `file?: { data: Uint8Array; mediaType: string }`; when present, the call uses `messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "file", data, mediaType }] }]` instead of `prompt`. Existing behaviour unchanged without `file`.

- [ ] **Step 1: Failing tests** — `r2Storage` against a fake bucket: put passes contentType; remove of 2 500 keys calls delete 3 times (1000/1000/500); empty remove calls nothing. `diskStorage` in a temp dir: put then file exists with bytes; nested dirs created; `../x`, `/abs`, `a\\b` throw; remove existing + missing succeeds. `ai.ts`: with `file`, the mock model receives a user message with a text part and a file part carrying the bytes and media type.
- [ ] **Step 2: Run** from `apps/api`: `npx vitest run src/shared` → FAIL.
- [ ] **Step 3: Implement** (check AI SDK v7 file part shape in `node_modules/ai/docs`).
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): add object storage and file input for structured generation`

---

### Task 3: Résumé content, sniffing and extraction

**Files:**

- Create: `apps/api/src/features/resumes/content.ts`, `apps/api/src/features/resumes/document.ts`, `apps/api/src/features/resumes/extract.ts`
- Modify: `apps/api/package.json` (add `fflate`)
- Test: `apps/api/src/features/resumes/content.test.ts`, `document.test.ts`, `extract.test.ts`

**Interfaces:**

- Produces in `content.ts`:
  - `resumeContentSchema` (Zod, ids required): `{ headline: { id, text }, summary: { id, text }, experiences: { id, company, role, start: string, end: string | null, bullets: { id, text }[] }[], education: { id, institution, degree, start: string | null, end: string | null }[], skills: { id, name }[], languages: { id, name, level: string | null }[], contact: { email: string | null, phone: string | null, city: string | null, links: string[] } }` — strings trimmed, `id` non-empty ≤ 64, texts ≤ 2 000, lists ≤ 50 items, bullets ≤ 20 per experience.
  - `resumeContentInputSchema` — same shape with every `id` optional.
  - `type ResumeContent = z.infer<typeof resumeContentSchema>`; `type ResumeContentInput = z.infer<typeof resumeContentInputSchema>`
  - `withNodeIds(input: ResumeContentInput, newId?: () => string): ResumeContent | "duplicate_ids"` — fills missing ids with `crypto.randomUUID()`, rejects any id used twice anywhere in the document.
- Produces in `document.ts`:
  - `type ResumeFile = { kind: "pdf"; data: Uint8Array } | { kind: "docx"; data: Uint8Array; text: string }`
  - `readResumeFile(data: Uint8Array): ResumeFile | "unsupported" | "too_large"` — PDF by `%PDF-` prefix; DOCX by ZIP signature `PK\x03\x04` and an entry `word/document.xml`, unzipped with `fflate` (`unzipSync` with a filter for that entry only), expanded size capped at 2 000 000 bytes (`"too_large"` above), text = `<w:t>` contents joined, `<w:p>` → newline, entities decoded; anything else `"unsupported"`.
- Produces in `extract.ts`: `extractResume(generate: GenerateStructured, file: ResumeFile): Promise<ResumeContent | "not_a_resume">` — model output schema = `resumeContentInputSchema` minus ids plus `isResume: boolean`; `isResume: false` or empty headline+experiences → `"not_a_resume"`; ids assigned with `withNodeIds`; PDF sent as `file`, DOCX text (≤ 60 000 chars) inside `<document>…</document>` in the prompt; English system prompt saying the document is untrusted data and to keep the person's own wording (no invention).

- [ ] **Step 1: Failing tests** — `assigns and validates node ids` (missing ids filled with the injected generator, existing kept, a duplicate across sections → `"duplicate_ids"`; limits enforced by the schema); `sniffs file types from bytes` (real minimal PDF bytes → pdf; HTML bytes → unsupported; a ZIP without `word/document.xml` → unsupported; a DOCX built in the test with `fflate.zipSync` → docx with the expected text and newlines); `caps docx expansion` (a zipped 3 000 000-byte XML → `"too_large"`); `extractResume` with a fake generator: PDF passes `file` with `application/pdf`; DOCX puts text in `<document>`; `isResume: false` → `"not_a_resume"`; ids assigned.
- [ ] **Step 2: Run** `npx vitest run src/features/resumes` → FAIL.
- [ ] **Step 3: Implement** (`npm i fflate -w @offboard/api`).
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): add résumé content model, file sniffing and extraction`

---

### Task 4: Résumé and account repositories

**Files:**

- Create: `apps/api/src/features/resumes/repository.ts`, `apps/api/src/features/account/repository.ts`
- Modify: `apps/api/src/repositories.ts` (`resumes`, `account`)
- Test: `apps/api/src/features/resumes/repository.test.ts`, `apps/api/src/features/account/repository.test.ts`

**Interfaces:**

- Produces in `resumes/repository.ts`:
  - `type ResumeView = { id: string; kind: "base"; content: ResumeContent; score: number | null; scoredAt: string | null; updatedAt: string }`
  - `getBase(profileId: string): Promise<ResumeView | undefined>`
  - `replaceBase(profileId: string, content: ResumeContent, sourceFileKey: string): Promise<{ resume: ResumeView; previousFileKey: string | null }>` — upsert on the base partial unique index (keeps the row id), resets `score`/`scored_at` to null.
  - `updateBaseContent(profileId: string, content: ResumeContent): Promise<ResumeView | undefined>` — resets `score`/`scored_at`.
- Produces in `account/repository.ts`:
  - `exportData(profileId: string): Promise<{ profile: { name: string; email: string; sponsoredUntil: string; termsAcceptedAt: string | null }; resumes: { kind: string; status: string; content: unknown; updatedAt: string }[]; applications: { job: { title: string; company: string; url: string }; status: string; closedReason: string | null; appliedAt: string; events: { status: string; closedReason: string | null; createdAt: string }[]; interviews: { startsAt: string; mode: string; with: string; notes: string }[] }[] }>`
  - `fileKeys(profileId: string): Promise<string[]>` — every non-null `source_file_key` of the profile's résumés.
  - `deleteProfile(profileId: string): Promise<boolean>`

- [ ] **Step 1: Failing tests** — résumés: `replaceBase` creates then replaces keeping the id and returning the previous key; scores reset on replace and on update; another profile sees nothing. Account: `exportData` includes résumés, applications with events and interviews, and never another profile's rows; `fileKeys` lists only that profile's keys; `deletes files before the profile` is a route concern — here assert `deleteProfile` cascades résumés, applications, events, interviews and sessions and frees the case for a new `enable`.
- [ ] **Step 2: Run** `npx vitest run src/features/resumes src/features/account` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): add résumé and account repositories`

---

### Task 5: Routes, storage wiring and composition

**Files:**

- Create: `apps/api/src/features/resumes/routes.ts`, `apps/api/src/features/account/routes.ts`
- Modify: `apps/api/src/app.ts` (option `storage?: ObjectStorage`), `apps/api/src/worker.ts` (`RESUMES?: R2BucketLike` binding → `r2Storage`), `apps/api/src/server.ts` and `apps/api/src/vercel.ts` (`diskStorage` when `RESUME_STORAGE_DIR` is set), `apps/web/cloudflare.config.ts` (`RESUMES: bindings.r2(...)` only when `OFFBOARD_RESUMES_BUCKET` is set, bucket name from it), `apps/api/README.md` (env rows for `RESUME_STORAGE_DIR`, `OFFBOARD_RESUMES_BUCKET`)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- Produces `resumesRoutes(repos: ResumesRepository, talentAccess: TalentAccessPlugin, deps: { generate: GenerateStructured | undefined; storage: ObjectStorage | undefined })`:
  - `POST /me/resume/upload` (multipart `file`, `t.File({ maxSize: 5242880 })`) — order: storage or generate missing → 503 `{ error: "Résumé upload not configured" }`; `readResumeFile` → `"unsupported"` 422 `{ error: "Unsupported file" }`, `"too_large"` 422 `{ error: "File too large" }`; `storage.put`; `extractResume` (throw → delete stored file, 502 `{ error: "Could not read the résumé" }`; `"not_a_resume"` → delete stored file, 422 `{ error: "File is not a résumé" }`); `replaceBase`; delete `previousFileKey` if any; 200 `ResumeView`.
  - `GET /me/resume` → 200 `ResumeView` or 404 `{ error: "Résumé not found" }`.
  - `PATCH /me/resume { content: ResumeContentInput }` → `withNodeIds` (`"duplicate_ids"` → 422 `{ error: "Duplicate node ids" }`), 200 `ResumeView` or 404.
- Produces `accountRoutes(repos: AccountRepository, talentAccess: TalentAccessPlugin, storage: ObjectStorage | undefined)`:
  - `GET /me/export` (`talent: "signed-in"`) → 200 export JSON with `content-disposition: attachment; filename="offboard-dados.json"`.
  - `DELETE /me` (`talent: "signed-in"`) → `fileKeys`; if any and storage missing → 503; `storage.remove(keys)` (throw → 502 `{ error: "Could not delete stored files" }`, nothing else changed); `deleteProfile`; 204.

- [ ] **Step 1: Failing tests** in `app.test.ts` (in-memory fake `ObjectStorage` recording puts/removes, fake `generateStructured`): upload PDF → 200 and one put; upload again → same résumé id and the first key removed; HTML bytes named `.pdf` → 422 and no put; `cleans up the stored file when extraction fails` (generator throws → 502 and the put key removed; `isResume: false` → 422 and removed); missing storage → 503; GET/PATCH incl. duplicate ids 422 and ids assigned; `deletes the account` (files removed then profile gone, the session's next `/me` → 403; storage remove throws → 502 and profile still there); export includes the résumé and seeded applications; lapsed person can export (200) but not upload (402); portal session → 403.
- [ ] **Step 2: Run** `npx vitest run src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** routes, composition and runtime wiring.
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `feat(api): upload, read and edit the base résumé; export and delete the account`

---

### Delivery

- [ ] Push `feat/talent-resume`; open a PR with base `feat/talent-applications` (stack #77 → #78 → #79 → #82 → this). Body: migration 0013; uploads answer 503 until an R2 bucket is bound (`OFFBOARD_RESUMES_BUCKET` at build) and `AI_GATEWAY_API_KEY` is set; locally set `RESUME_STORAGE_DIR`; scoring is PR 6; the individual-plan cancellation on delete arrives with PR 11.
