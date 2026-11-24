# Talent App Backend Design

## Intent

Offboard today serves only the company side: HR, managers and viewers run offboarding cases in the portal. The person being let go has no account and no surface. Davi is designing a mobile-first app for that person (tabs Hoje, Vagas, Currículo, Turma, Saída). This design covers the backend for **Vagas**, **Candidaturas** and **Currículo** so the API is ready when the screens land.

### Why

The product promise is outplacement: the company pays so the person it let go finds the next job faster, and HR gets aggregate proof that it worked. The HR page "Candidaturas assistidas" already shows that funnel with fixture numbers and promises that HR sees only aggregates. This backend makes both real.

This is a real product, not a demo: jobs come from real sources, résumé scoring and tailoring use an LLM, access is paid.

## Goals

- A person whose offboarding case HR enabled can sign in to the app with a personal email.
- HR sponsors access for a period it chooses (typically 3–6 months) and can end it early; the person can keep access afterwards, or upgrade during sponsorship, with an individual paid plan.
- The person uploads a résumé (PDF or DOCX) and gets a structured base résumé with a 0–100 score and actionable suggestions, each with an estimated gain.
- The person sees a job catalog ranked by match % against their base résumé, filterable by work model (híbrido, remoto).
- Jobs come from scheduled external ingestion plus jobs shared by HR and partner recruiters.
- "Adaptar currículo e candidatar" produces a job-specific résumé version, records an application, and returns the job URL.
- The person tracks each application through a status funnel and logs interviews, which feed a weekly agenda.
- The person publishes a public résumé page with a toggle, a stable slug, daily visit counts (with recruiter visits split out) and a PDF download.
- HR reads aggregate funnel numbers for its people, never individual records.

## Non-goals

- Tabs Hoje, Turma and Saída. Turma (cohort sharing, "Da turma" filter, "Compartilhada pela Ana") is explicitly deferred.
- Submitting applications inside the target company's ATS. The app opens the job URL; the person applies there.
- Detecting application status changes from email or ATS callbacks. Status is updated by the person.
- Frontend screens. Davi owns them.
- Multi-tenant companies. The platform stays single-company like the rest of the schema.

## Anti-goals

- HR, managers or viewers reading any individual résumé, application, interview or page-visit record — through any endpoint, including error messages and counts small enough to identify a person.
- A talent session reaching any portal endpoint, or a portal session reaching any `/api/me` endpoint.
- LLM output silently overwriting what the person wrote. Suggestions are applied only when the person accepts them.
- The job catalog going empty because nobody shared anything.

## Constraints

- Elysia API in `apps/api`, composed in `app.ts`, one slice per feature under `features/<feature>` (AGENTS.md). Drizzle schema and hand-written migrations in `packages/db`.
- Production runs on a Cloudflare Worker (`app.off-board.xyz`) with Hyperdrive to Postgres; Vercel is paused but its entry point still exists. Code must run on Workers (`nodejs_compat`): no native modules, no headless Chrome in-process.
- Scheduled work runs through Worker cron triggers (`triggers.scheduled` in `apps/web/cloudflare.config.ts`) hitting `machine: "cron"` routes guarded by `CRON_SECRET`, like `/api/correios/check`.
- Auth is better-auth magic link (`features/auth/auth.ts`). Sessions carry `memberId` (NOT NULL) and the token is prefixed with the member id.
- Davi has an unmerged branch `codex/offboard-sign-in-email` touching `features/auth`. The identity PR must rebase on it or coordinate.
- 100% test coverage. Every LLM, storage and external-HTTP dependency sits behind an interface with a fake in tests.
- Each step below ships as its own PR, merged before the next starts.
- Personal data under LGPD: the person can export and delete everything.

## Approaches Considered

### A. Same API, second auth audience (chosen)

New feature slices in the existing Elysia app under `/api/me/*`. The same better-auth instance issues sessions for either a team member or a talent profile; a separate access macro guards talent routes. One deploy, one Eden client for Davi, and billing, email and Hyperdrive are reused. Isolation between HR and private data rests on access rules and tests.

### B. Separate talent API

`apps/talent-api` with its own auth, cookie and deploy. Physical isolation of private data, but auth, email, billing, Hyperdrive, CI and the API client would all be duplicated.

### Rejected: third-party résumé/job platform

Would put scoring and matching outside our control and move the privacy problem to another vendor.

Samuel picked **A**.

## Design

### Identity and access

- **`talent_profiles`**: `case_id` (unique, nullable, FK `on delete set null`), `personal_email` (unique, case-insensitive), `name`, `sponsored_until` (date), `terms_accepted_at`, `first_signed_in_at`, `share_outcome_with_hr` (consent for hire outcome in aggregates, default false).
- HR enables the app from the case: `POST /api/offboardings/:id/talent-access { personalEmail, sponsoredUntil }` (permission `update Offboarding`). That sends the first magic link.
- **The email is fixed.** The person can never change it. HR can correct a typo only before the first sign-in (_builder's call: after the first sign-in HR can't change it either, so HR can never redirect the magic link to an address it controls_).
- **HR controls only sponsorship.** It can extend `sponsored_until` or end it today (`PATCH .../talent-access`). HR has no "disable" action that removes the person's own access, data or paid plan.
- **Deleting the case detaches the profile instead of deleting it**, so a person who pays keeps their account.
- **Terms consent.** Until `terms_accepted_at` is set, the `talent` macro allows only `GET /api/me` and `POST /api/me/terms`. The terms disclose that résumé data is processed by an external AI provider.
- **Auth audience.** A session belongs to exactly one of: a team member, a talent profile. `auth_session.member_id` becomes nullable, `talent_profile_id` is added, and a check constraint enforces exactly one. The magic-link token prefix carries the audience and the id, so the same email can be both a member and a talent profile without ambiguity. The audience is chosen by the entry point: portal sign-in versus app sign-in (`/app/entrar`).
- `resolvePrincipal` returns a discriminated result. The existing `permit` macro rejects talent sessions with 403. A new `talent` macro resolves the profile, checks entitlement and exposes `profileId` to handlers. Every talent repository function takes `profileId` as its first argument and filters by it. No talent route accepts a profile id from the client.
- **Entitlement**:
  - `individual` when the profile has an active individual subscription whose period has not ended. This takes precedence, so a sponsored person who upgrades gets their plan's tier.
  - Otherwise `sponsored` when today ≤ `sponsored_until` and the company subscription is `active` or `trialing`.
  - Otherwise `lapsed`. On `lapsed`, talent routes return 402 except entitlement, billing, export and delete, and the public page is served as unavailable. Data is kept.
- `GET /api/me` returns profile, entitlement kind and period end.

### Résumé

- **`resumes`**: `id`, `profile_id`, `kind` (`base` | `tailored`), `job_id` (nullable, set for tailored), `content` (jsonb, schema below), `score` (nullable int 0–100), `scored_at`, `source_file_key` (R2 key of the upload, base only), timestamps. One `base` per profile (partial unique index).
- `content` schema (validated with Zod on write): `headline`, `summary`, `experiences[]` (`company`, `role`, `start`, `end?`, `bullets[]`), `education[]`, `skills[]`, `languages[]`, `contact` (`email`, `phone?`, `city?`, `links[]`). Every editable text node has a stable id so suggestions can target it.
- `POST /api/me/resume/upload` (multipart, ≤ 5 MB, PDF or DOCX): store the file in R2, extract text, ask the LLM for `content`, create or replace the base résumé, enqueue scoring. The upload response returns once `content` exists; the score arrives later.
- `GET /api/me/resume`, `PATCH /api/me/resume` (person edits; enqueues rescoring).
- **`resume_suggestions`**: `id`, `resume_id`, `target_node_id`, `original_text`, `suggested_text`, `rationale`, `estimated_gain` (int), `status` (`open` | `applied` | `dismissed`). The screen's "Revisar · +4" opens one suggestion. `POST .../suggestions/:id/apply` writes `suggested_text` into the node (rejecting with 409 if `original_text` no longer matches) and enqueues rescoring. A dismiss route also exists.
- **Scoring** is one LLM call returning a score and up to five suggestions, so the score and the suggestions stay consistent. Rescoring replaces open suggestions and keeps applied or dismissed ones as history.

### Jobs

- **`jobs`**: `id`, `origin` (`external` | `hr` | `recruiter`), `source` (provider name), `source_key` (unique per source, used for dedup), `title`, `company`, `work_model` (`remote` | `hybrid` | `onsite` | null), `city`, `state`, `salary_min_cents`, `salary_max_cents` (nullable; null renders "Faixa não informada"), `url`, `description`, `shared_by_member_id` or `recruiter_partner_id` (nullable), `posted_at`, `closed_at`, timestamps.
- **External ingestion**: a `JobSource` interface (`search(query) → normalized jobs`). The first adapter is Gupy's public job portal endpoint. It is unofficial: the adapter must tolerate schema drift and failures without breaking the run. A cron route runs every few hours, builds queries from active profiles' base-résumé headlines and recent roles, upserts by `(source, source_key)`, and closes jobs missing from their source for N days.
- **HR sharing**: `POST /api/jobs/share { url }` in the portal (permission `create Offboarding`). The server fetches the page (https only, timeout, size cap), the LLM extracts the job fields, and the job is stored with `origin = hr`.
- **Partner recruiters**: `recruiter_partners` (`id`, `name`, `company`, `token_hash`, `revoked_at`), managed by admin in the portal. A recruiter gets a URL containing a token and posts jobs through `POST /api/recruiters/jobs` (token auth, no login, rate-limited). The jobs carry `origin = recruiter`, which renders "Indicada por uma recrutadora parceira".

### Matching

- **`job_matches`**: `profile_id`, `job_id`, `score` (0–100), `reasons` (jsonb, short strings), `resume_scored_at` (the base résumé version it was computed against), `computed_at`. Primary key `(profile_id, job_id)`.
- Computed asynchronously in two stages: a cheap prefilter narrows each profile to the top K open jobs (K ≈ 30), then the LLM scores only those. A match is stale when the base résumé changed after it was computed; stale matches are recomputed by the queue.
- `GET /api/me/jobs?workModel=&page=` returns open jobs sorted by match score, with `match: null` when there is no fresh match yet (no base résumé, or the queue hasn't reached the job). Unmatched jobs come after matched ones, newest first, so the catalog is never empty. Each job also says whether the person already applied.

### Tailored versions and applying

- **Draft, then review.** "Adaptar currículo e candidatar" is two steps.
  - `POST /api/me/jobs/:jobId/tailor` creates or regenerates a tailored résumé in status `draft` from the base résumé and the job description. The response includes a per-node diff against the base and the version's match score.
  - The person can edit the draft (`PATCH /api/me/resumes/:id`) and then mark it `ready`.
- **The LLM may only rephrase, reorder and emphasize facts already in the base résumé.** It never adds skills, employers, dates or numbers. The tailoring output is validated against this: every experience and skill must exist in the base.
- `resumes` gains `status` (`draft` | `ready`); a base résumé is always `ready`. "Uma versão para cada vaga" lists tailored versions as `rascunho`, or with the application that used them.
- `POST /api/me/jobs/:jobId/apply { resumeId }` requires a `ready` résumé (base or tailored for this job). It creates the application in status `sent` and returns `{ applicationId, jobUrl, publicPageUrl }`. The person can apply only once per job (unique `(profile_id, job_id)`).

### Applications and interviews

- **`applications`**: `id`, `profile_id`, `job_id`, `resume_id`, `status` (`sent` | `in_review` | `interview` | `offer` | `closed`), `closed_reason` (`rejected` | `withdrawn` | `hired` | null), `applied_at`, `status_changed_at`.
- **`application_events`**: an append-only history of status changes.
- **The funnel counts "ever reached", not "currently in".** Reaching a stage implies every earlier stage, so jumping from `sent` to `offer` counts as responded, interview and offer.
  - `enviadas`: all applications.
  - `responderam`: reached `in_review` or later, or closed as `rejected` or `hired`. Closing as `withdrawn` straight from `sent` is not a response.
  - `entrevistas`: reached `interview` or later.
  - `ofertas`: reached `offer`.
  - An application that went from interview to rejected still counts as an interview.
- `PATCH /api/me/applications/:id { status, closedReason? }` enforces forward transitions plus `closed` from any state.
- **`interviews`**: `id`, `application_id`, `starts_at` (timestamptz), `mode` (`video` | `in_person` | `phone`), `with` (free text, e.g. "RH da Lumen Cosméticos"), `notes`. Creating one moves the application to `interview` if it is earlier in the funnel.
- `GET /api/me/applications` (list with job, company, status, applied_at), `GET /api/me/applications/summary` (funnel counts), `GET /api/me/interviews?from=&to=` (week agenda, dates resolved in America/Sao_Paulo).

### Public page

- **`public_pages`**: `profile_id` (pk), `slug` (unique, lowercase), `enabled`, `resume_id` (which version is public; defaults to base).
- **`public_page_daily_views`**: `profile_id`, `day`, `visits`, `recruiter_visits`. Only these counters are kept, never per-visitor rows or IPs.
- `GET /api/public/pages/:slug` (unauthenticated, cacheable briefly) returns the public résumé, or 404 when the page is disabled, lapsed or unknown. It shows name, headline, summary, experience, education, skills, contact email and links. The phone number is never public. `GET /api/public/pages/:slug/pdf` serves the same content as a PDF. Each call increments today's `visits`. A recruiter visit is one carrying a valid `?a=<token>`; the application flow embeds a per-application token in `publicPageUrl`, and such visits also increment `recruiter_visits`.
- `GET /api/me/page` (settings + last 7 days of counts), `PATCH /api/me/page { enabled, slug }`, `GET /api/me/resume/:id/pdf` (rendered server-side, Worker-compatible).

### Individual plan

- **`talent_subscriptions`**: `profile_id`, `plan_slug`, `status`, `current_period_start`, `current_period_end`, `abacatepay_billing_id`. Checkout and webhook reuse the AbacatePay gateway and webhook verification in `features/billing`.
- Individual plans are tiers defined in config, not in `plans`, which describes company plans (`max_employees`). A sponsored person can buy a tier, which applies immediately, or buy one when sponsorship ends.
- **Open product item, needed before PR 11:** what a higher tier unlocks beyond continued access (for example more tailored versions per month, or a higher AI budget).

### HR aggregates

- `GET /api/talent/aggregates` (new permission `read TalentAggregates`, granted to admin and rh) returns app activations, funnel counts using the funnel rules above, hires with consent, and the jobs with the most applications. Any figure derived from fewer than 5 distinct people returns null, including each job's row in the job ranking. This replaces the fixtures in `features/transition-insights/insights-pages.tsx`; the frontend swap is Davi's or a follow-up PR.

### Background work

- **`background_jobs`** table: `id`, `kind`, `payload`, `status`, `attempts`, `run_after`, `last_error`. Rows are claimed with `FOR UPDATE SKIP LOCKED`.
- Kinds: `score_resume`, `compute_matches`, `ingest_jobs`. Enqueueing is idempotent per `(kind, subject)`.
- A cron route drains the table in bounded batches so one run fits the Worker's limits. It runs every 15 minutes, and `scheduled()` in the worker must call it alongside Correios. Enqueueing also starts one bounded drain through `waitUntil`, so a score usually appears within seconds and cron is only the safety net.
- **Prerequisites Samuel provisions:** `OFFBOARD_ENABLE_CRON=1` in production, an R2 bucket binding, and an AI Gateway key with zero data retention.

### LLM

- AI SDK behind a small `TalentAi` interface: `extractResume`, `scoreResume`, `extractJob`, `scoreMatch`, `tailorResume`. All outputs are structured and schema-validated. The model is called through Vercel AI Gateway with zero data retention (`AI_GATEWAY_API_KEY` Worker secret). Prompts stay in the slice that uses them.
- PDFs go to the model as document input, so the Worker doesn't parse them. DOCX is converted to text with a pure-JS library.
- Cost guard: each profile has a daily cap on LLM calls, set in config, and the queue defers matches once the cap is hit.

### Privacy and data rights

- `GET /api/me/export` returns all of the person's data as JSON.
- `DELETE /api/me` does the following:
  - deletes the profile and everything hanging from it, including R2 objects;
  - revokes sessions;
  - cancels any individual subscription.
- After deletion:
  - Invoice rows are kept for fiscal records, with no link to personal data.
  - The person drops out of HR aggregates.
  - HR can invite the same case again, which creates a new, empty profile.

## Delivery order (one PR each)

1. This spec.
2. Identity: `talent_profiles`, HR enable and sponsorship, session audience, `talent` macro, terms consent, sponsored entitlement, `GET /api/me`, isolation tests in both directions. better-auth's `generateToken(email)` receives only the email, so carrying the audience into the token needs its own mechanism.
3. Jobs catalog: `jobs`, HR share-by-link with LLM extraction, `TalentAi` scaffold, plain `GET /api/me/jobs` without match.
4. Applications and interviews: apply (without tailoring), status funnel, events, summary, week agenda. This unblocks the Candidaturas screen.
5. Base résumé: R2 binding, upload, extraction, read and edit, export and delete.
6. Background jobs plus scoring and suggestions.
7. Matching: prefilter, `job_matches`, ranked `GET /api/me/jobs`.
8. Tailored versions, wired into apply.
9. External ingestion (Gupy adapter) and partner recruiters.
10. Public page, view counters, PDF.
11. Individual plan and lapsed entitlement.
12. HR aggregates endpoint.

## Left to the builder

- Exact response shapes and route names beyond those fixed above. Keep them Eden-friendly for Davi.
- PDF rendering and DOCX text-extraction libraries, within the Worker constraint.
- Prefilter method for matching (keyword/trigram vs. embeddings), as long as it is cheap per profile and LLM calls per profile stay bounded.
- Prompt design and the exact suggestion count.
- Ingestion cadence and the N-day close window.
- Slug generation and the reserved-word list.
