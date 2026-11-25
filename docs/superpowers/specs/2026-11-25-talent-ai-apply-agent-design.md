# Talent AI Apply Agent Design (AI Apply step 6)

Implements "Agent run", "Evidence", "Never twice" and the agent half of "Consent and privacy" from `2026-11-25-talent-ai-apply-design.md` (PR #97). Builds on step 4 (PR #104): preferences, profile fields with share flags, answer library, rejections, cover letter and the Assisted package.

## Intent

A person approves one job, and the product submits the application for them on the company's own form, the way they would by hand. They see what was sent and a screenshot of the confirmation, and the application appears in their funnel.

### Why

Applying by hand is the bottleneck for someone in outplacement. Submitting on the person's behalf is what Plano X will sell (spec #97). Step 6 proves the agent on real Greenhouse forms before selection and automatic modes (step 7) and plans (step 5) exist.

## Goals

- `POST /me/jobs/:jobId/ai-apply` prepares an AI application for one Greenhouse job the person picked. It reads the form's questions from Greenhouse's public API and drafts every answer. The person then reviews the draft, edits it and fills the blanks. `POST /me/ai-applications/:id/confirm` queues the submission. In this step that is the only trigger: Modo de revisão, one job at a time.
- The agent fills and submits the Greenhouse form with exactly the confirmed answers and the person's files. It records an application with `channel = ai_apply` plus the evidence.
- A **rehearsal** (`ensaio`) does everything except the final click: it fills the real form and screenshots it. That lets the allowlist test on real jobs without applying.
- Answers the person confirms are saved to the answer library, so the next job asks less.
- A blocked, changed or unrecognized form falls back to Assisted with a visible reason.
- The person sees every attempt and its state, including failures and the reason for each.

## Non-goals

- Lever. The catalog has no Lever boards yet, so the Lever adapter comes once boards are added. Other ATSs are out too.
- Selection, automatic and hybrid modes, sending without review, the daily limit from plans, the "para revisar" queue, and notifications. These are step 7.
- Plano X gating and billing (step 5). Until then, an allowlist gates access (below).
- Sites that need the person's login (Gupy, LinkedIn…).
- Our own captcha solving. Browserbase's built-in solving is used, and anything it can't solve falls back to Assisted.
- Uploading medical reports (laudo) or other personal documents. A form that requires one goes to Assisted with reason `document_required`.

## Anti-goals

- **Submitting twice to the same job.** This covers a retry after a crash and a job the person already applied to by hand.
- **Submitting anything the person didn't see and confirm.** Every value sent is one shown in the confirmation step, unchanged.
- **Sending data the person marked not-to-share.** This holds even through a library answer to the same question or the contact block of the uploaded résumé.
- **Presenting an invented fact as the person's own.** Drafted answers are inferred only from the person's data. Each carries its source, and inferred ones are flagged as such. Sensitive questions are never inferred.
- **Hidden failures.** Every attempt ends in a state the person can see, with a reason.

## Constraints

- Everything in spec #97 still applies: Elysia feature slices, Drizzle, the Cloudflare Worker runtime, 100% coverage, zero code comments, app-side timestamps, LGPD, and no cross-feature imports.
- **Access (Samuel, 2026-11-25):** until plans exist, only people whose account email is in an allowlist we configure (`AI_APPLY_ALLOWLIST`, comma-separated emails) **and** who gave the AI Apply consent can use the agent. Everyone else gets 403. When step 5 lands, the allowlist check becomes "has Plano X".
- **Decisions (Samuel, 2026-11-25):**
  - The agent infers answers and shows them before sending. Confirmed answers are saved to the library.
  - CPF, date of birth and address become share-flagged profile fields.
  - Sensitive questions are asked once and saved permanently.
  - There is a rehearsal mode, and this step is Greenhouse only.
- **Approach A (Samuel, 2026-11-25):** the browser is driven from our own Worker code over CDP, with no Browserbase Function and no Stagehand-hosted agent. Fields are filled deterministically by their form ids, and the LLM only chooses answers.
- Browserbase has no Brazilian region (US West/East, Frankfurt, Singapore), and its DPA is only offered on the Scale plan. The consent text states the processor and the international transfer. Before the agent goes beyond the test allowlist, Samuel needs the DPA. This is a commercial step, not a code task.
- Worker limits: `waitUntil` lasts at most 30 seconds after the response. A cron invocation can run 15 minutes of wall-clock time, and waiting on the network doesn't count toward CPU time. So the browser run happens inside the cron-driven drain, not in a request. Preparing the draft (one Greenhouse API call plus one LLM call) runs inline in the request, as tailoring does today.

## Approaches considered

1. **Worker drives the browser over CDP from our background queue (chosen).** Everything stays in our code, tests and deploy. The open risk is whether a CDP client library runs in the Worker. The first task proves it on a real Browserbase session (see "Spike first").
2. **Browserbase Function invoked from the Worker.** No Worker limits. But it adds a second deploy target outside our pipeline, runs in us-west-2 only, and its secrets would be stored at Browserbase. Not chosen.
3. **Stagehand-hosted autonomous agent.** The least code, but we lose field-by-field control over what is sent, and file upload and AI Gateway use are unclear. Rejected against the anti-goals.

## Design

### Access and consent

- New talent consent: `ai_apply_consent_at` (timestamp, null means none) and `ai_apply_consent_version`. The routes are `PUT /me/ai-apply/consent { accept: boolean }` (`talent: "signed-in"`, the same as the outcome consent), and `GET /me` exposes the consent state.
- **Withdrawing consent stops all sending immediately.** Attempts not yet submitting are cancelled with reason `consent_withdrawn`. An attempt already in `submitting` can't be stopped and ends normally.
- **Gate on every agent route and when the job runs:** an active talent session, an allowlisted email, consent given, and `BROWSERBASE_API_KEY` plus `BROWSERBASE_PROJECT_ID` configured (503 otherwise). The run re-checks the gate. If the person lost access in the meantime, the attempt is cancelled.

### Profile fields (extends step 4)

- `profileFields` gains three share-flagged fields, stored in the same jsonb, so no migration is needed:
  - `cpf`: 11 digits with a valid check digit. Stored digits-only and filled in the form's expected mask.
  - `birthDate`: an ISO date, and the person must be at least 14.
  - `address`: `{ cep (8 digits), street, number, complement | null, neighborhood, city, state (UF) }`, with one share flag for the whole address.
- They follow the step 4 rules. They are sent only with `share: true`, appear in the Assisted package, and are included in export and delete. `PUT /me/preferences` validates them.
- **The uploaded résumé respects share flags.** The PDF the agent uploads, and the résumé text the LLM sees, omit phone, city and links when the matching profile field (`phone`, `city`, `linkedin`/`portfolio`) is marked not-to-share. (My call, 2026-11-25: without this, the résumé file would leak what the flags withhold.)

### What can be applied to

- A job is AI-capable when it is open, comes from a `greenhouse` source, and its Greenhouse board/job id can be derived from its source key. Step 2 will replace this with a stored apply channel.
- Before preparing, the person must have:
  - a base résumé;
  - not applied to the job already (any channel);
  - not rejected the job;
  - no attempt for the job that hasn't ended.
- A cover letter is optional. If the package has one and the form has a cover-letter field, it is used.

### Attempts

- A new table, `ai_applications`, holds one row per (person, job) attempt: `state`, `reason`, the draft and the confirmed answers, timestamps, the résumé used, and evidence keys.
- The states are:
  - `draft`: answers prepared and waiting for the person's confirmation.
  - `queued`
  - `running`: the browser is filling the form.
  - `submitting`: set immediately before the click that submits.
  - Final states:
    - `submitted`
    - `rehearsed`: the rehearsal finished; the person can confirm again for real.
    - `assisted`: fallback, with a reason.
    - `needs_check`
    - `cancelled`
- **Never twice:**
  - A unique index allows one non-final attempt per (person, job).
  - An existing application for the job blocks preparing and confirming, and is re-checked right before `submitting`.
  - A job that finds its attempt already in `submitting` (a crash or timeout after the click) never clicks again. It moves the attempt to `needs_check`, and the person is asked to confirm on the company's side whether it went through. Confirming creates the application. Denying turns the attempt into Assisted.
  - The queue's retry and "stopped while running" handling must not re-run an attempt past `submitting`.
- **Routes** (all gated as above):
  - `POST /me/jobs/:jobId/ai-apply` prepares the draft and returns it.
  - `GET /me/ai-applications` lists attempts newest first. `GET /me/ai-applications/:id` returns one attempt with its draft or evidence.
  - `POST /me/ai-applications/:id/confirm { answers, rehearsal?: boolean }` moves a `draft` (or a `rehearsed` attempt) to `queued`.
  - `POST /me/ai-applications/:id/cancel` cancels a `draft` or `queued` attempt.
  - `POST /me/ai-applications/:id/check { sent: boolean }` resolves `needs_check`.
- A draft older than 7 days, or one whose job closed, can't be confirmed. The person prepares it again.

### Preparing the draft

- **Questions:** `GET boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true` returns `questions`, `location_questions`, `compliance` and `demographic_questions`, with field names, types (`input_text`, `textarea`, `input_file`, `input_hidden`, single and multi select), options and the required flag. No browser opens to prepare.
- **Deterministic fields:**
  - name and email (account)
  - phone
  - LinkedIn and website
  - CPF, birth date and address
  - the résumé file
  - the cover letter file or text

  Each is drafted only if its profile field is shared (name and email always). Otherwise it is drafted blank, marked `not_shared`.

- **Other questions:** one LLM call per draft. It receives the question list and the person's allowed data: library answers, shared profile fields, the share-filtered résumé and the cover letter. For each question it returns an answer with its source (`library`, `profile`, `resume`, `cover_letter`) and whether it is **inferred**, or `blank`. It may infer from the résumé (e.g. pick "3 a 5 anos" of experience in sales from the experience dates). It never infers the sensitive kinds below.
- **Validation (code, not the model):**
  - Select answers must be among the options.
  - Text answers that cite `library`/`profile` must equal the stored value.
  - Every text answer passes the step 4 digit guard against the person's data.
  - An answer that fails validation is drafted blank.
  - **Library answers overlapping a not-shared field are not used:** salary expectation, start availability, notice period, LinkedIn.
- **Sensitive questions** cover disability/PcD, race or ethnicity, gender, sexual orientation, and diversity or data-processing consents. The ATS demographic and compliance sections count, and so do regular questions the LLM classifies as sensitive.
  - **Never inferred.** If the person already has a saved answer for that question in the library, it is used. Otherwise the question is drafted blank, and the person answers it once in the confirmation step (Samuel: ask once, save permanently).
  - A required medical-report upload or other document upload makes the attempt `assisted` with reason `document_required`.
- **Confirming:** the person may edit any drafted answer. Every required question must be filled, and selects must still be among the options.
  - Confirmed answers to text and select questions are saved to the answer library with `ensureQuestion` + `answer`, so they are offered next time.
  - The library entry belongs to the person. A question the person answered shows up in their library even when it isn't a common one.
- The drafting call counts one unit against the person's daily LLM cap (429 like tailoring).

### Running the browser

- **Drain:** the existing Postgres background queue gets a new kind, `ai_apply`, run by the cron drain. Each drain runs at most one apply and gives it its own time budget. Expect a delay of up to the cron interval (15 minutes today). A shorter cron for `ai_apply` alone is the builder's call.
- **Session:**
  - Created through Browserbase's REST API: region `us-east-1`, `solveCaptchas` on, `recordSession` and `logSession` off, a timeout of a few minutes, and no persistent context.
  - The share-filtered résumé PDF (from `shared/resume-pdf.ts`) and the cover letter go through the session uploads API.
  - The session is always ended, even on failure.
- **Fill:**
  - Open the job's Greenhouse apply form and fill every confirmed answer by its field name. Masks for CPF, date and CEP follow the field.
  - Before clicking, check that the form's fields match the confirmed questions: same required set, and options still present. On any mismatch, the attempt falls back to Assisted with reason `form_changed`. The agent never answers a question the person didn't see.
- **Rehearsal:** after filling, take a screenshot of the filled form, end the session and mark `rehearsed`. No click and no application.
- **Submit and confirm:** mark `submitting`, click, then wait for Greenhouse's confirmation (the confirmation URL or text).
  - **Confirmed:** take a screenshot, create the application (`channel = ai_apply`, résumé used), and mark the attempt `submitted`.
  - **Not confirmed within the timeout:** `needs_check`.
- **Fallbacks to Assisted, with reasons:** `blocked` (captcha unsolved, access denied), `form_changed`, `login_required`, `job_closed` (the ATS says it's closed), `document_required` and `error` (anything else, logged with `logFailure`).

### Evidence

- **Stored per attempt:**
  - The submitted field values: question text plus value, without file bytes.
  - The names of the files used.
  - The final URL.
  - A PNG screenshot (the confirmation, or the filled form for a rehearsal) in R2 under the person's prefix.
- **Visible in `GET /me/ai-applications/:id`;** the screenshot is served by an authenticated route.
- **Account export and delete include attempts and evidence;** screenshots are deleted along with the person's files.

### Applications

- `applications` gains `channel` (`manual` | `ai_apply`, default `manual`). The funnel and HR aggregates count both. Counting AI Apply separately is step 8.

## Spike first

The first task is a throwaway check, run once against a real Browserbase session from a local Worker (`wrangler dev`). It needs a Browserbase API key and project ID from Samuel. It must show:

- that a CDP client connects from the Worker runtime;
- that it can navigate to a public Greenhouse form (e.g. a Stone job) and set a file input through the uploads API;
- that it can fill a field and take a screenshot.

Submitting is not part of the spike. If no CDP library works in the Worker, the fallback is a minimal CDP client over the Worker's WebSocket, and the plan is adjusted before any other task.

## Left to the builder

- **Libraries:** the CDP client (a Cloudflare fork, playwright-core, puppeteer-core or minimal CDP), chosen by the spike.
- **Selectors and confirmation signals:** the exact Greenhouse field selectors and confirmation signals.
- **Sensitive-question classification:** the keyword list or classifier for sensitive questions, as long as it errs toward "sensitive".
- **Timeouts:** session and step timeouts.
- **Prompt:** the answer prompt wording, following the cover letter's untrusted-data rules.
- **Cron:** the `ai_apply` cron interval.
- **Internals:** the state machine's transition table, and the screenshot size and format.

## Open for Samuel

- Browserbase account: the API key and project ID for the spike and tests, and the plan.
- The DPA and Scale plan before opening beyond the allowlist.
