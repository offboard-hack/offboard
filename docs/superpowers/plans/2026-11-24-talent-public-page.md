# Talent Public Page Implementation Plan (PR 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person publishes a public résumé page (toggle + slug), sees this week's visits with recruiter visits split out, shares a per-application link that marks recruiter visits, and downloads a PDF of any of their résumés — the "Sua página do currículo" block of Davi's Currículo screen.

**Architecture:** A new `pages` feature owns `public_pages` (one per profile: slug, enabled, which résumé is public) and `public_page_daily_views` (counters per São Paulo day; no per-visitor rows, no IPs). An unauthenticated `GET /api/public/pages/:slug` returns the public view (phone never included) and increments today's counter; a valid `?a=<token>` — a random token stored on each application at apply time — also increments recruiter visits. PDFs are rendered server-side with `pdf-lib` (pure JS, Worker-compatible) by a shared renderer used by both the public PDF and the person's own PDF download. Apply now also returns `publicPageUrl` (composed in `app.ts`, no cross-feature import).

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, `pdf-lib` 1.17, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "Public page", "Tailored versions and applying" (`publicPageUrl`), "Delivery order" item 10.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params (except the `cause` naming exception), test doubles and cross-feature imports (reading tables via `@offboard/db/schema` allowed; composition in `app.ts`); `.github/workflows` untouched; app-side `new Date()` timestamps.
- Privacy: the public view and public PDF contain name, headline, summary, experiences (company, role, dates, bullets), education, skills, languages, contact email and links — never the phone or city, never ids or internal keys. The person's own PDF (`/me/resume/:id/pdf`) may include phone and city. Visit counters store only `(profile, day, visits, recruiter_visits)`.
- A page is publicly visible only when `enabled`, the profile's entitlement is not `lapsed` (same rule as the talent macro: company subscription active and `sponsored_until >= SP today`, via the shared entitlement helpers), and the chosen résumé exists and is `ready` (default: the base résumé). Otherwise 404 `{ error: "Page not found" }` — identical for unknown, disabled and lapsed.
- Slug: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–40 chars, not in the reserved list (`admin`, `api`, `app`, `entrar`, `p`, `public`, `offboard`, `www`, `static`, `assets`, `me`, `login`, `logout`, `help`, `suporte`); suggestion from the person's name: lowercased, accents stripped (NFD + remove marks), non-alphanumerics → `-`, trimmed, cut to 40; taken/reserved → append `-2`, `-3`, ….
- Days are São Paulo calendar days; reuse one shared helper `saoPauloDate(now: Date): string` (YYYY-MM-DD) and switch `shared/entitlement.ts` and `shared/llm-usage.ts` to it (behaviour unchanged).
- Visits: only `GET /api/public/pages/:slug` counts (the PDF route does not). Recruiter visit = `?a=<token>` matching an application of that same profile; invalid tokens count as plain visits. Response header `cache-control: private, max-age=60`.
- Public page URL: `${PUBLIC_PAGE_ORIGIN ?? webOrigin}/p/<slug>`; per-application link adds `?a=<token>`. Apply returns `publicPageUrl: string | null` (null when the page is disabled or doesn't exist).
- PDF: A4, Helvetica (standard font), text wrapped and paginated; characters outside WinAnsi replaced with `?`; `content-type: application/pdf`, `content-disposition: attachment; filename="<slug-or-curriculo>.pdf"`.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **Lapsed person or disabled page reached by slug.** Must be the same 404 as an unknown slug and must not count a visit. → Task 3 test `hides unpublishable pages without counting`.
2. **Phone or city leaking publicly** (JSON or PDF). → Task 2 test `renders the public view without phone or city` and Task 4 test `public PDF never contains the phone`.
3. **A recruiter token from another person's application** used on this page. Counts as a plain visit only. → Task 3 test `counts recruiter visits only for this profile's tokens`.
4. **Slug collisions and reserved words** (`admin`, an already-taken slug, uppercase, `--`, 2-char). 409 for taken, 422 for invalid/reserved. → Task 3 test `validates and reserves slugs`.
5. **Public page pointing to a résumé that became a draft or was deleted.** Falls back to 404 (draft) / base (deleted → resume_id null). → Task 3 test `serves only a ready résumé`.

---

### Task 1: Schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts`; Create: `packages/db/drizzle/0017_add_public_pages.sql`, `meta/0017_snapshot.json`; Modify: `meta/_journal.json` (`idx: 17`, `when: 1795740000012`, `tag: "0017_add_public_pages"`)
- Create: `packages/db/src/public-page.fixture.ts`; Modify: `packages/db/src/application.fixture.ts`, `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- `public_pages`: `profile_id uuid pk → talent_profiles.id on delete cascade`, `slug varchar(40) not null` (unique index `public_pages_slug_idx`), `enabled boolean not null default false`, `resume_id uuid null → resumes.id on delete set null`, `created_at`, `updated_at`; check `public_pages_slug_format` (`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40`).
- `public_page_daily_views`: `profile_id uuid not null → talent_profiles.id on delete cascade`, `day date not null`, `visits integer not null default 0`, `recruiter_visits integer not null default 0`; primary key `(profile_id, day)`; check `public_page_daily_views_counts` (`visits >= 0 and recruiter_visits >= 0 and recruiter_visits <= visits`).
- `applications.public_token varchar(64) null` with unique index `applications_public_token_idx`.
- Seed: Marina's page `marina-lopes`, enabled, `resume_id` null (base); 7 São Paulo days ending today with visits `[3, 4, 7, 4, 8, 2, 3]` (total 31) and recruiter visits summing to 6; each of her applications gets a random 32-char base64url token. `testSeedFixtures` gets none.

- [ ] **Step 1: Failing test** `stores public pages and daily counters`: seed has Marina's enabled page and 7 day rows totalling 31/6; duplicate slug → 23505; `Marina` (uppercase) and `ab` → 23514; `recruiter_visits > visits` → 23514; duplicate public token → 23505; deleting the profile removes page and counters; deleting the chosen résumé sets `resume_id` null.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement** (hand-written migration + snapshot chained from 0016).
- [ ] **Step 4: Run** db and api suites → PASS at 100%.
- [ ] **Step 5: Commit** `feat(db): add public résumé pages and visit counters`

---

### Task 2: Slugs, public view and PDF rendering

**Files:**

- Create: `apps/api/src/shared/sao-paulo-date.ts` (+ test); Modify: `apps/api/src/shared/entitlement.ts`, `apps/api/src/shared/llm-usage.ts` (use it; behaviour unchanged)
- Create: `apps/api/src/features/pages/slug.ts`, `apps/api/src/features/pages/public-view.ts`, `apps/api/src/shared/resume-pdf.ts`
- Modify: `apps/api/package.json` (add `pdf-lib`)
- Test: `slug.test.ts`, `public-view.test.ts`, `apps/api/src/shared/resume-pdf.test.ts`

**Interfaces:**

- `saoPauloDate(now: Date): string`.
- `slug.ts`: `reservedSlugs: ReadonlySet<string>`; `isValidSlug(slug: string): boolean`; `suggestSlug(name: string, taken: (slug: string) => boolean | Promise<boolean>): Promise<string>` (per Global Constraints; never returns a reserved or taken slug; a name with no usable characters → `curriculo`).
- `public-view.ts`: `type PublicResume = { name: string; headline: string; summary: string; experiences: { company: string; role: string; start: string; end: string | null; bullets: string[] }[]; education: { institution: string; degree: string; start: string | null; end: string | null }[]; skills: string[]; languages: { name: string; level: string | null }[]; contact: { email: string | null; links: string[] } }`; `toPublicResume(name: string, content: ResumeContent): PublicResume`.
- `resume-pdf.ts`: `type PdfResume = PublicResume & { contact: PublicResume["contact"] & { phone?: string | null; city?: string | null } }`; `renderResumePdf(resume: PdfResume): Promise<Uint8Array>` — A4, Helvetica/Helvetica-Bold, wrapped and paginated, WinAnsi-safe.

- [ ] **Step 1: Failing tests** — `saoPauloDate` boundary at 02:59/03:00Z and existing entitlement/usage tests unchanged; `isValidSlug` cases (valid, uppercase, `--`, leading `-`, 2 chars, 41 chars, reserved); `suggestSlug("Marina Lopes", …)` → `marina-lopes`, accents (`José Ação` → `jose-acao`), taken → `-2`, `-3`, reserved base name → `-2`, symbols only → `curriculo`; `renders the public view without phone or city` (no phone/city/ids in the JSON); `renderResumePdf` returns bytes starting with `%PDF-`, paginates a 60-bullet résumé to ≥ 2 pages (parse with `pdf-lib` `PDFDocument.load` and count pages), survives emoji/CJK (replaced), includes the phone only when given (extract text is hard — assert via a test-only flag-free approach: render twice and assert the byte length differs and that the phone string bytes appear in the uncompressed content stream when `useObjectStreams: false` and no compression, or assert via `pdf-lib`'s page content — implementer's call, but the public-PDF-without-phone property must be tested).
- [ ] **Step 2: Run** from `apps/api`: `npx vitest run src/features/pages src/shared/resume-pdf.test.ts src/shared/sao-paulo-date.test.ts` → FAIL.
- [ ] **Step 3: Implement** (`npm i pdf-lib -w @offboard/api`).
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): render public résumé views and PDFs`

---

### Task 3: Pages repository and application tokens

**Files:**

- Create: `apps/api/src/features/pages/repository.ts`
- Modify: `apps/api/src/features/applications/repository.ts` (generate `public_token` at apply; return it), `apps/api/src/repositories.ts` (`pages`)
- Test: `apps/api/src/features/pages/repository.test.ts`, `apps/api/src/features/applications/repository.test.ts`

**Interfaces:**

- `createPagesRepository(db)`:
  - `type PageSettings = { slug: string; enabled: boolean; resumeId: string | null; exists: boolean }`
  - `settings(profileId: string): Promise<PageSettings>` — existing row, or `{ slug: suggested, enabled: false, resumeId: null, exists: false }` (suggestion avoids taken/reserved slugs; nothing written).
  - `save(profileId: string, patch: { enabled?: boolean; slug?: string; resumeId?: string | null }, now: Date): Promise<PageSettings | "invalid_slug" | "slug_taken" | "resume_not_ready">` — upsert; slug validated (`isValidSlug`); unique violation on slug → `slug_taken`; `resumeId` must be the profile's `ready` résumé (base or tailored) or null.
  - `publicPage(slug: string): Promise<{ profileId: string; name: string; sponsoredUntil: string; content: ResumeContent } | undefined>` — enabled page; résumé = chosen (must be `ready`, else undefined) or base when `resume_id` is null; profile name from `talent_profiles`.
  - `recordVisit(profileId: string, token: string | null, now: Date): Promise<void>` — upsert today's row incrementing `visits`, and `recruiter_visits` when `token` matches an application of this profile.
  - `week(profileId: string, now: Date): Promise<{ days: { day: string; visits: number; recruiterVisits: number }[]; visits: number; recruiterVisits: number }>` — the 7 São Paulo days ending today, zero-filled, oldest first.
  - `urlFor(profileId: string): Promise<string | null>` — the enabled page's slug or null (the origin is added in composition).
- `applications.apply(...)` → result gains `publicToken: string` (32 random base64url chars via `crypto.getRandomValues`), stored on the row.

- [ ] **Step 1: Failing tests** — `validates and reserves slugs` (invalid → `invalid_slug`; reserved → `invalid_slug`; another profile's slug → `slug_taken`; uppercase input normalized? → no: invalid); settings default suggestion without writing; `serves only a ready résumé` (chosen tailored ready → served; set to draft → undefined; chosen deleted → falls back to base); `hides unpublishable pages without counting` is a route concern — here: disabled → undefined; `counts recruiter visits only for this profile's tokens` (own token → recruiter +1; another profile's token → plain); `week` zero-fills and orders; apply stores a unique 32-char token.
- [ ] **Step 2: Run** `npx vitest run src/features/pages src/features/applications` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test -w @offboard/api` → 100%.
- [ ] **Step 5: Commit** `feat(api): store public pages, visits and application tokens`

---

### Task 4: Routes and composition

**Files:**

- Create: `apps/api/src/features/pages/routes.ts`
- Modify: `apps/api/src/features/resumes/routes.ts` (`GET /me/resume/:id/pdf`), `apps/api/src/features/applications/routes.ts` (apply response), `apps/api/src/app.ts` (option `publicPageOrigin?: string`; `publicPageUrl` composition; entitlement check for public pages via the existing `companyActive` + `entitlementOf`), `apps/api/src/worker.ts`, `server.ts`, `vercel.ts` (`PUBLIC_PAGE_ORIGIN` optional), `vercel.json` (rewrite `/api/public/:path*`), `apps/api/README.md` (env row)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- `GET /public/pages/:slug?a=` (no auth): publishable → 200 `PublicResume` + `recordVisit`; else 404 `{ error: "Page not found" }` (no visit). Header `cache-control: private, max-age=60`.
- `GET /public/pages/:slug/pdf` (no auth): same publishability; PDF of the public view (no phone/city); no visit.
- `GET /me/page` (`talent: "active"`) → 200 `{ slug, enabled, resumeId, url, week }` where `url = origin/p/slug`.
- `PATCH /me/page { enabled?, slug?, resumeId? }` (≥ 1 property) → 200 same shape; 409 `{ error: "Slug taken" }`; 422 `{ error: "Invalid slug" }` / `{ error: "Résumé not ready" }`.
- `GET /me/resume/:id/pdf` (`talent: "active"`): the profile's base or tailored résumé (any status) → PDF including phone and city; 404 otherwise.
- Apply → 201 `{ applicationId, jobUrl, publicPageUrl }` with `publicPageUrl = origin/p/slug?a=<token>` or null.

- [ ] **Step 1: Failing tests** in `app.test.ts`: publish flow (PATCH enable + slug → GET public → visit counted in `/me/page` week); `hides unpublishable pages without counting` (unknown, disabled, lapsed — all identical 404, counters unchanged); recruiter link from apply increments recruiter visits; `public PDF never contains the phone` and own PDF contains it; slug 409/422; apply returns `publicPageUrl` null before publishing and the tokenized URL after; portal session → 403 on `/me/page`; PDF headers.
- [ ] **Step 2: Run** `npx vitest run src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `feat(api): publish the résumé page and serve PDFs`

---

### Delivery

- [ ] Push `feat/talent-public-page`; open a PR with base `feat/talent-tailored-resumes` (stack … → #87 → this). Body: migration 0017; `PUBLIC_PAGE_ORIGIN` (default web origin; `offboard.me` isn't wired); the web `/p/:slug` page is Davi's; visits counted per page view with a 60 s private cache.
