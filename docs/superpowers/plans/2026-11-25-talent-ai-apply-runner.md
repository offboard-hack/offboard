# AI Apply Runner Implementation Plan (AI Apply step 6, part 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run confirmed AI applications. A background job opens the Greenhouse apply form in a Browserbase browser driven over raw CDP from our Worker and fills exactly the confirmed answers and files. A rehearsal stops before the click and screenshots the filled form. A real run submits, confirms, records the application (`channel = ai_apply`) and keeps evidence. Anything it can't do falls back to Assisted with a reason. A crash after the click becomes `needs_check`, never a second click.

**Architecture:** The new code lives under `apps/api/src/features/ai-apply/browser/`, in three layers:

- `browserbase.ts` (REST: session, upload, release) and `cdp.ts` (a minimal CDP client over an injected socket; the Worker adapter uses `fetch` with `Upgrade: websocket`, proven by the 2026-11-25 spike);
- `greenhouse-form.ts`, which drives the form through a small `Page` interface;
- `runner.ts`, the `ai_apply` job handler and state machine.

The scheduled drain runs ordinary jobs, then at most one `ai_apply` job with its own time budget.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, pdf-lib (existing `shared/resume-pdf.ts`), Browserbase REST + CDP, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-talent-ai-apply-agent-design.md`. This plan covers "Running the browser", "Evidence", the `needs_check` resolution in "Attempts", the Browserbase part of the gate, and the two findings parked from part 1 (#106 PR body).

## Global Constraints

- **Repo rules:** 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test-double libraries and cross-feature imports. Fakes are hand-written objects passed through injected interfaces, as `generateStructured` fakes are today. App-side `new Date()` timestamps. `.github/workflows` untouched.
- **Browserbase:**
  - Create sessions with `POST https://api.browserbase.com/v1/sessions` (header `X-BB-API-Key`) and body `{ projectId, region: "us-east-1", timeout: 240, browserSettings: { recordSession: false, logSession: false, solveCaptchas: true } }`.
  - Upload files with `POST /v1/sessions/{id}/uploads` (multipart field `file`). The file then appears in the browser at `/tmp/.uploads/<filename>`.
  - Release with `POST /v1/sessions/{id}` `{ projectId, status: "REQUEST_RELEASE" }`, **always**, including after errors.
  - Env vars are `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID`, both required for AI Apply to be "configured".
- **CDP:**
  - Connect to `session.connectUrl` with `wss:` replaced by `https:`, via `fetch(url, { headers: { Upgrade: "websocket" } })` and `response.webSocket.accept()`.
  - Attach to the page target with `Target.attachToTarget { flatten: true }`.
  - Every command has a 30 s timeout. Input goes through `Input.dispatchMouseEvent`, `Input.insertText` and `Input.dispatchKeyEvent`.
  - Files are set with `DOM.setFileInputFiles` using the input's `objectId`.
- **Run budget:** one attempt gets at most 200 s of wall clock from claim to finish. The queue lock is 5 min.
- **Files:**
  - **Résumé:** `curriculo.pdf`, rendered with `renderResumePdf` from the share-filtered résumé (`shared/shared-resume.ts`).
  - **Cover letter:** written into `cover_letter_text` when the question has a textarea field; otherwise uploaded as `carta-de-apresentacao.pdf`, rendered as a one-page PDF.
  - **Screenshot:** PNG at `ai-applications/<profileId>/<attemptId>.png` in object storage.
- **Never twice:**
  - Set the `submitting` state (a conditional `UPDATE … WHERE state = 'running'`) **before** the click.
  - A run that finds its attempt in `submitting` moves it to `needs_check` and never opens a browser.
  - The handler never throws after it sets `running`. Every failure becomes a state, so the queue's retry never re-runs a click.
- **Never send unconfirmed data:** the runner fills only the confirmed answers, the files and the deterministic name/email from the account. Before filling, it compares the live form to the confirmed `form.questions`; any missing or extra required field, or a select whose confirmed value is no longer an option, gives `assisted` with reason `form_changed` and no click.
- **Rehearsal:** fill, screenshot, release, state `rehearsed`. It never clicks submit, never creates an application, and never consumes the attempt: the person can confirm again for a real run.
- **Outcomes** (`reason` values):
  - `submitted`;
  - `rehearsed`;
  - `needs_check` (confirmation not seen within 30 s after the click, or a challenge visible after it);
  - `assisted`, with reason `blocked` (captcha challenge visible or access denied), `form_changed`, `login_required`, `job_closed` (the form page says the job is closed, or 404), `upload_failed`, or `error` (anything else, logged with `logFailure` name and message only);
  - `cancelled`, with reason `consent_withdrawn` / `not_allowed` / `applied_manually` when the gate or preconditions fail at run time.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A crash or timeout right after the click** must leave `needs_check`, with no second click on the next claim. Task 4 test: `never clicks twice after a crash`.
2. **A rehearsal never clicks submit**, not even when every check passes. Task 4 test: `rehearses without submitting`.
3. **A form that changed** between confirm and run (new required question, removed option) → `assisted`/`form_changed` with nothing submitted. Task 3 test: `reports a changed form`, and Task 4 test: `falls back when the form changed`.
4. **A session leak:** every path, including thrown errors in the middle of filling, releases the Browserbase session. Task 4 test: `always releases the session`.
5. **Run-time gate changes:** withdrawn consent, removal from the allowlist, a manual application or a closed job between confirm and run each give `cancelled` with no browser opened (a closed job gives `assisted`/`job_closed`). Task 4 test: `re-checks the gate before opening a browser`.

---

### Task 1: Configuration and parked fixes

**Files:** `apps/api/src/worker.ts` (`runtimeConfig` gains optional `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`), `server.ts`, `vercel.ts`, `apps/web/cloudflare.config.ts` (bind both as secrets when `OFFBOARD_AI_APPLY_CONFIGURED === "1"`), `apps/api/src/app.ts` (`AppOptions.browserbase?: { apiKey: string; projectId: string }`), `apps/api/README.md` env rows, `apps/api/src/features/ai-apply/routes.ts` (confirm needs Browserbase configured → 503 `{ error: "AI Apply not configured" }`; `GET /me` `aiApply.available` also requires it), and the parked fixes:

- **`onError` in `app.ts`:** pass through only Elysia's own codes (`VALIDATION`, `PARSE`, `NOT_FOUND`, `INVALID_COOKIE_SIGNATURE`, `INVALID_FILE_TYPE`) and status responses. Everything else, including errors with their own `code` such as `ECONNREFUSED` or a `DOMException`, becomes 500 `{ error: "Internal error" }`, logged with name plus `cause.code`/`code` only.
- **City label pattern** in `features/ai-apply/questions.ts` and `draft.ts`: one shared constant; `location` as a whole word; exclude `natal`, `nascimento`, `relocat\w*`, `mudar`, `gostaria`. Test that "Are you open to relocation?", "Cidade natal", "Disponibilidade para mudar de cidade?" and "Em qual cidade gostaria de trabalhar?" stay `custom`, while "Cidade", "Localização (Cidade)" and the standard `location` field are `city`.

- [ ] Steps: failing tests (a coded error → generic 500 body without the message; config absent → confirm 503 and `available: false`; city cases) → implement → gates → commit `feat(api): configure Browserbase and tighten AI Apply errors and city detection`.

---

### Task 2: Browserbase and CDP clients

**Files:** create `apps/api/src/features/ai-apply/browser/{browserbase,cdp}.ts` (+ tests).

**Interfaces:**

- `createBrowserbase(fetchImpl: typeof fetch, config: { apiKey: string; projectId: string })` → `{ createSession(): Promise<{ id: string; connectUrl: string }>; upload(sessionId: string, file: { name: string; bytes: Uint8Array; type: string }): Promise<void>; release(sessionId: string): Promise<void> }`. Non-2xx responses throw `BrowserbaseError` with the status (a 429 or 402 from Browserbase means a plan limit).
- `type Socket = { send(data: string): void; onMessage(listener: (data: string) => void): void; onClose(listener: () => void): void; close(): void }`; `workerSocket(fetchImpl: typeof fetch, url: string): Promise<Socket>` is the Worker adapter.
- `connectPage(socket: Socket, options?: { commandTimeoutMs?: number })` → `Page`:
  - `navigate(url)`;
  - `evaluate<T>(expression)`, returning the value or throwing on `exceptionDetails`;
  - `waitFor(expression, timeoutMs)`, which polls every 250 ms until truthy;
  - `click(selector)`, which scrolls into view and clicks the element's box center;
  - `type(text)`;
  - `press(key: "Enter" | "ArrowDown" | "Tab" | "Escape")`;
  - `setFiles(selector, paths)`;
  - `screenshot()` → `Uint8Array` (PNG);
  - `url()`;
  - `close()`.

- [ ] Steps: failing tests with a hand-written fake socket that answers CDP ids (a command timeout → throws; a CDP error → throws with the method name; attach picks the first `page` target; `click` dispatches pressed+released at the box center; `setFiles` passes `objectId`; a closed socket rejects pending commands; fake `fetchImpl` for the REST calls and `workerSocket`) → implement → green → commit `feat(api): drive Browserbase sessions over CDP`.

---

### Task 3: Greenhouse form driver

**Files:** create `apps/api/src/features/ai-apply/browser/greenhouse-form.ts` (+ test). Before writing selectors, capture the live Stone form's DOM once (`job-boards.greenhouse.io/stone/jobs/8201530003`; `curl` the page HTML into a fixture for reference only) and note in the report the markup it relies on.

**Interfaces:**

- `readLiveForm(page: Page)` → `{ fields: { name: string; required: boolean; options: string[] }[]; closed: boolean; loginRequired: boolean }`.
- `checkForm(live, questions: FormQuestion[], confirmed: ConfirmedAnswer[])` → `"ok" | "form_changed"` (pure).
- `fillGreenhouse(page, { questions, confirmed, account: { firstName; lastName; email }, files: { resume: string; coverLetter: string | null; coverLetterText: string | null }, phoneCountry: "BR" })` → `void | { failed: "upload_failed" | "form_changed"; field: string }`:
  - text and textarea: click, then `type`;
  - React comboboxes for single selects: click the control, type the confirmed option's **label**, press Enter, and verify the shown value; a mismatch gives `form_changed`;
  - multi-select checkbox groups: click each confirmed option's checkbox;
  - phone country combobox: Brazil;
  - location autocomplete: type the confirmed city, choose the first suggestion, and verify the hidden latitude/longitude got values;
  - files: `setFiles`, then verify the "attached" view shows the file name, else `upload_failed`.
- `submitGreenhouse(page)` clicks the submit button. `awaitOutcome(page, timeoutMs)` → `"confirmed" | "blocked" | "invalid" | "timeout"`:
  - `confirmed`: a confirmation URL or a confirmation message;
  - `blocked`: a visible reCAPTCHA/hCaptcha challenge iframe;
  - `invalid`: visible field errors.

- [ ] Steps: failing tests with a scripted fake `Page`: `reports a changed form` (a new required field; a removed option), `fills each field kind` (the call sequence per kind, including the label typed for a combobox), `verifies uploads`, and `classifies the outcome` → implement → green → commit `feat(api): fill Greenhouse application forms`.

---

### Task 4: Runner job and state machine

**Files:** create `apps/api/src/features/ai-apply/runner.ts` (+ test). Modify `features/ai-apply/repository.ts` (`claimForRun`, `markSubmitting`, `finish`, `submittedWithApplication` in one transaction creating the `applications` row with `channel: "ai_apply"` and `resume_id`), `features/ai-apply/routes.ts` (confirm enqueues `ai_apply` with subject = attempt id after commit, with enqueue failures logged; `beforeDrain` also enqueues any `queued` attempt without a pending job), `features/background/{drain,repository,routes}.ts` (claims can include or exclude kinds; the scheduled drain runs other kinds with the existing budget, then at most one `ai_apply` with a 210 s budget), `apps/web/src/cron-schedules.ts` (`drain: "*/5 * * * *"`), and `app.ts` composition.

**Interfaces:** `runAiApplication(deps, attemptId, now)` follows this order:

1. Load the attempt.
2. In `submitting` → `needs_check`, done. Otherwise, in anything but `queued`/`running` → done.
3. Re-check the gate and preconditions. A failure gives `cancelled` with its reason, or `assisted`/`job_closed`.
4. Set `running`, then render the files.
5. Create the session (Browserbase 429/402 puts the attempt back in `queued` and postpones the job 5 min; any other Browserbase error gives `assisted`/`error`), upload the files, connect, navigate to `https://job-boards.greenhouse.io/<board>/jobs/<id>` from `jobs.source_key`, and `readLiveForm`.
6. Closed → `job_closed`; login required → `login_required`; then `checkForm`.
7. Fill.
8. **Rehearsal:** screenshot → `rehearsed`.
9. **Real run:**
   - `markSubmitting` (if 0 rows → stop);
   - submit, then `awaitOutcome`;
   - `confirmed` → screenshot → `submittedWithApplication`;
   - `blocked` → `needs_check` (the click happened; a visible challenge does not prove nothing was accepted);
   - `invalid` → `assisted`/`form_changed`;
   - `timeout` → `needs_check`.
10. **Always:** store evidence (`fields`: the question labels with the values sent; `files`: the file names; `finalUrl`) and release the session.

- [ ] Steps: failing tests with fake Browserbase, socket and `Page` (Review Focus 1, 2, 4, 5, plus `falls back when the form changed`, `records evidence and the application`, `treats a visible captcha as blocked`, and `moves a timeout to needs_check`) → implement → green → commit `feat(api): run confirmed AI applications in the background`.

---

### Task 5: Evidence routes, needs_check and export

**Files:** `features/ai-apply/{routes,repository,view}.ts`, account export and delete (`features/account/*`).

**Interfaces:**

- **Screenshot:** `GET /me/ai-applications/:id/screenshot` → `image/png`, `cache-control: private, no-store`. A foreign or missing attempt, or no screenshot, gives 404 `{ error: "Screenshot not found" }`. Reading the bytes needs `ObjectStorage.get(key)`; add it to the interface (R2 `get`, disk read).
- **needs_check:** `POST /me/ai-applications/:id/check { sent: boolean }` from `needs_check` only (else 409 `{ error: "Nothing to check" }`).
  - `sent: true` → creates the application (`ai_apply`) and sets `submitted`;
  - `sent: false` → `assisted` with reason `not_sent`.
- **Confirm again:** `POST /me/ai-applications/:id/confirm` is also accepted from `rehearsed`, with the same validation and the 7-day window counted from the rehearsal's `finishedAt`.
- **View:** the attempt view gains `evidence` and `hasScreenshot`.
- **Export and delete:** the export includes evidence. Delete removes the `ai-applications/<profileId>/` prefix.

- [ ] Steps: failing tests (screenshot isolation and headers; check transitions; confirm from rehearsed; export and delete of screenshots) → implement → full verification `npm test && npm run lint -- --force && npm run format:check && npm run build -w @offboard/web` → commit `feat(api): show AI application evidence and resolve unconfirmed submissions`.

---

### Task 6 (controller): live rehearsal

The controller runs this, not a subagent, and nothing from it is committed. Run the API locally (`server.ts` against the test DB, `AI_APPLY_ALLOWLIST` set to a seeded talent email, `BROWSERBASE_*` from `~/.config/offboard/browserbase.env`, AI gateway key if available or a draft prepared through the test helpers). Then prepare, edit and confirm a draft for the real Stone job with **rehearsal: true**, trigger the drain and inspect the screenshot. Every field must show the confirmed value, and nothing may be submitted. Mismatches go back to the Task 3 implementer as a fix round.

---

### Delivery

- [ ] Push `feat/ai-apply-runner` and open a PR against `main` (after #106 merges; until then the base is `feat/talent-app`). The body must cover:
  - real submissions need a Browserbase plan with captcha solving (the account is on Free);
  - the drain now runs every 5 min;
  - the live rehearsal result and screenshot;
  - a confirmation after a real submit has not been observed yet. The first allowlisted real application is the test.
