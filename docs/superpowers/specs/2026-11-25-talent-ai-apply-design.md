# Talent AI Apply Design

Supersedes parts of `2026-11-24-talent-app-backend-design.md`: "Jobs" (HR sharing, Gupy adapter, partner recruiters), "Tailored versions and applying" (apply flow), "Individual plan" (tiers), and the remaining "Delivery order". Everything else in that spec (identity, résumé, scoring, matching, applications funnel, public page, HR aggregates, privacy) stands and is already built in PRs #77–#89.

## Intent

The app should feel like **AI Apply**: the person uploads a résumé once, sees every job we can find ranked by fit, and the product applies for them — with their approval or fully on its own — instead of only tracking applications they make elsewhere.

### Why

Today the app helps a person decide and prepare, but they still apply by hand on each company's site. The value of outplacement is getting many good applications out quickly. Applying on the person's behalf is also the clearest reason to pay for a higher plan ("Plano X").

## Goals

- One global job catalog, filled only by automated sources (public ATS APIs, aggregator APIs, scraping). Every person sees every open job, ranked by their match.
- Three application modes, chosen per person in Preferências (Samuel's screen, 2026-11-25):
  - **Modo automático**: the agent finds compatible jobs and applies by itself, without review.
  - **Modo híbrido**: the agent applies by itself to high-match jobs (75%+ by default) and asks the person about the rest.
  - **Modo de revisão**: nothing is sent without approval; the agent applies as soon as the person approves.
- **Assisted** stays only as the fallback for jobs the agent can't submit (login-required sites, a blocked or changed form): we prepare the package and the person submits on the company's site.
- Every AI application leaves evidence (what was submitted, screenshot of the confirmation) and lands in the existing applications funnel.
- Plans decide which modes and how many automatic applications a person gets.

## Non-goals

- HR or admins choosing companies or sharing job links. Removed.
- Applying on sites that require the person's login (Gupy, LinkedIn Easy Apply, Catho…) in the first version. Those jobs get the Assisted mode only.
- Building our own captcha or bot-protection workarounds. We rely on Browserbase's built-in handling; anything it can't get through falls back to Assisted.
- Recruiter-side features (sourcing candidates, talking to recruiters).

## Anti-goals

- Submitting anything the person didn't authorize: automatic sending only in the mode the person chose (automático, or híbrido above its threshold) and only for jobs that pass their preferences; no new facts in résumés, cover letters or answers.
- Applying twice to the same job, or to a job outside the person's rules.
- Sending data to an employer the person didn't consent to share (e.g. phone, salary expectation) — the application profile marks what may be shared.
- Hidden failures: every failed or skipped AI application is visible to the person with the reason.

## Constraints

- Everything in the original spec's Constraints still applies (Elysia slices, Drizzle, Worker runtime, 100% coverage, one PR per step, LGPD).
- The browser agent runs on Browserbase (decided by Samuel, 2026-11-25): Greenhouse and Lever apply forms load reCAPTCHA/hCaptcha, and Cloudflare Browser Rendering identifies itself as automation, so it can't submit them. Browserbase sessions are driven from the API (Worker) over its API; Browserbase becomes a processor of personal data (résumé, profile) and needs a DPA and a mention in the person's consent.
- Scraping carries legal/ToS risk that Samuel accepts for the sources he chooses; each scraper must respect rate limits and be removable without touching other sources.
- Cost: AI Apply makes several LLM calls and a browser session per application; limits and the existing per-person LLM cap must account for it.

## Approaches considered (for the agent)

1. **Agent on Cloudflare Browser Rendering.** Same platform as the API, but its traffic is signed as Cloudflare automation and the target forms carry captchas. Rejected after the builder check found reCAPTCHA (Greenhouse) and hCaptcha (Lever) on real apply pages.
2. **Browserbase (chosen by Samuel).** Hosted headless browsers with stealth and captcha handling, driven by our LLM: open the job's apply URL, read the form, map fields to the application package, upload the résumé PDF, submit, screenshot. A new vendor holding personal data (DPA, consent wording) and per-session cost.
3. **Official ATS apply APIs only.** Greenhouse and Lever application APIs require the employer's own API key, so they're unusable for us. Rejected.

## Design

### Job catalog and sources

- **Global catalog.** The `jobs` table stays; the `origin` enum is kept: `external` for every automated source, with `source` saying which provider; HR sharing (`POST /api/jobs/share`, origin `hr`, the share pipeline's HR use) is removed. Existing `hr` rows are closed by the migration.
- **Source registry, not admin-managed.** Sources are configured by the Offboard team (code + config/DB rows edited by us, not exposed in the customer portal). The PR 9 `job_feeds` table becomes `job_sources` with a `kind` (`greenhouse | lever` for now; aggregator and scraper kinds are added in their PRs) and a `target` (board slug, aggregator query set, scraper name); no portal admin routes. An empty catalog disables all sources and closes their jobs.
- **Adapters** behind the existing `JobSource`/`fetchFeed` shape:
  - ATS boards: Greenhouse, Lever (built in PR 9), later Ashby/Workable/SmartRecruiters — a large curated list of Brazilian company boards maintained by us.
  - Aggregator APIs: Jooble and/or Adzuna (Brazil coverage, API keys) — queries built from the catalog's demand (all people's headlines/roles), not per person.
  - Scrapers: one adapter per site (Gupy portal first), each with its own rate limit and kill switch.
- **Dedup across sources**: a fingerprint of normalized company + title + city (and the canonical apply URL when known); the richest source wins, others link to it.
- **Apply channel** stored per job: `greenhouse_form`, `lever_form` (AI Apply-capable in v1), `login_required` (Gupy, LinkedIn…), `external_unknown`. Only AI Apply-capable channels go to the agent; the rest use Assisted.
- Matching (PR 7) is unchanged; with a bigger catalog the prefilter moves to a stored tsvector column.

### Partner recruiters

- Removed for now (Samuel, 2026-11-25); the code is recoverable from commit `b1efcc7`.

### Preferences (Preferências screen)

The screen has five tabs; each maps to stored data the agent uses:

- **Configurações rápidas**: application mode (automático / híbrido / revisão; híbrido's threshold defaults to 75% match) and **target job titles** (chips). Titles feed matching (prefilter terms and the match prompt) and the aggregator/scraper queries.
- **Perfil e currículo**: the base résumé (existing) plus profile fields used in forms — phone, city, LinkedIn/portfolio links, work authorization, availability, notice period — each with a **may share** flag.
- **Preferências de vagas**: work models, locations, willingness to relocate, salary floor, seniority, companies to exclude. Jobs outside these are never applied to automatically and rank lower in Vagas.
- **Biblioteca de respostas** (answer library): questions employers ask, with the person's answers, reused across applications. Seeded with common questions (salary expectation, availability, PcD self-declaration, how you heard about us, notice period…); every new question the agent meets in a form is added (normalized text, dedup by similarity). Unanswered questions show as a count ("2 perguntas comuns sem resposta").
- **Motivos de rejeição**: when the person rejects a suggested job they pick a reason (salary, location, company, seniority, not interested…). Rejected jobs are never applied to; reasons are stored per person and shown here, and the most frequent ones can be turned into preferences with one tap.

Screening answers: the agent answers a form question from the answer library first, then from the résumé and profile; a question it can't answer from them is **unanswerable** (never invented) and is added to the library as pending.

### Applying

- **Package** per (person, job): the tailored résumé (PR 8 rules: no new facts), a cover letter (same rules), and answers to the job's questions. Visible in the app for every application, before sending in revisão (and híbrido below the threshold), after sending otherwise.
- **Selection** (background job): new matches for the person that pass their preferences, aren't rejected, aren't applied to, and are on an AI Apply-capable channel; up to the plan's daily limit.
- **Revisão**: selected jobs wait as "para revisar"; the person approves (optionally editing the package) or rejects with a reason; approval queues the agent.
- **Híbrido**: selected jobs with match ≥ threshold go straight to the agent; the rest wait as in revisão.
- **Automático**: every selected job goes straight to the agent.
- **Agent run**: Browserbase session fills and submits; success → application created with `channel = ai_apply` and evidence; an unanswerable question → the job waits for an answer (the question is added to the library; once answered, the job is retried); blocked or changed form → falls back to Assisted with the reason.
- **Assisted** (fallback and login-required jobs): package + "open the company's form" link; the person submits and marks it sent (existing apply route).
- No automatic sending for lapsed people, without the AI Apply consent, or below Plano X.
- **Evidence**: the submitted field values (minus file bytes), files used, final URL and a confirmation screenshot (R2); kept with the application and included in export/delete.
- **Never twice**: unique (person, job) stays; a job already applied to by hand is never auto-applied.

### Plans

Decided with Samuel (2026-11-25); numbers still open:

- **Two tiers**: **Base** — full catalog, match, score/suggestions, tailoring, Assisted mode; **Plano X** — Base plus the agent (modos automático, híbrido and revisão), up to N AI applications per day, priority in the queue. Base people see the modes as an upgrade.
- **Tier per person**: HR chooses Base or X when enabling each person (stored on `talent_profiles` with the sponsorship; the portal's enable dialog gains the choice — Davi). The company pays for what HR chose.
- **Individual purchase (AbacatePay)** of either tier: a sponsored Base person can upgrade to X; after sponsorship ends, the person can keep Base or buy X.
- Entitlement becomes `{ kind: "sponsored" | "individual" | "lapsed"; tier: "base" | "x" | null; until }`; the effective tier is the higher of sponsored and individual while each is valid.

### Consent and privacy

- Turning on the agent (any of the three modes) requires a specific consent: we submit the person's data to employers on their behalf, through Browserbase. Withdrawable at any time (stops all sending immediately).
- HR still sees only aggregates; AI Apply counts join the funnel aggregates under the same suppression.

## Delivery order (one PR each, stacked after #89)

1. Reshape PR 9: `job_sources` registry (no admin routes), Greenhouse/Lever adapters, remove HR job sharing.
2. Aggregator API source + cross-source dedup + stored tsvector + apply channel detection.
3. Gupy scraper source (login-required channel).
4. Preferences: modes, target titles, job preferences, answer library (seeded common questions), rejection reasons; cover letter + screening-answer generation; Assisted package.
5. Plans: entitlement tiers, per-person sponsorship tier, individual Base and Plano X billing (replaces original PR 11).
6. AI Apply agent on Browserbase: submits approved packages on Greenhouse/Lever forms, evidence, unanswerable-question loop, fallbacks.
7. Selection and modes: background selection, híbrido threshold, automático, daily limit, "para revisar" queue, notifications.
8. Portal swap of the HR aggregates page (with AI Apply counts) — or Davi.

## Open questions for Samuel

- Plan numbers: daily AI application limit for Plano X; prices for Base and X.
- Which scraping targets first (Gupy? others?) and which aggregator(s) to sign up for.

## Left to the builder

- Fingerprint details for dedup; per-source rate limits; agent prompt design and field-mapping heuristics; screenshot format; exact schema of the application profile beyond the fields named.
