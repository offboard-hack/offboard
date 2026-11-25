# Talent HR Aggregates Implementation Plan (PR 12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR (admin and rh) reads real, privacy-preserving aggregates for the "Candidaturas assistidas" page — people enabled and activated, the application funnel, hires the people consented to share, the jobs with most applications and the jobs HR shared — with every figure that comes from fewer than 5 distinct people returned as `null`. People can now give (and withdraw) consent to share their hire outcome.

**Architecture:** A new `insights` feature computes aggregates in SQL over the talent tables (read via `@offboard/db/schema`), applying the funnel rules from PR 4 (`furthest_stage`, `closed_reason`) and a uniform suppression rule (distinct people < 5 → null). Access uses a new CASL subject `TalentAggregates`. The talent feature gains `PUT /api/me/consent` and exposes the consent flag on `GET /api/me`. The seed grows to enough people for the page to show numbers locally.

**Tech Stack:** Elysia 1.4, Drizzle 0.45 + PostgreSQL, CASL, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — "HR aggregates", "Applications and interviews" (funnel rules), "Identity and access" (`share_outcome_with_hr`), "Delivery order" item 12. The frontend swap of `apps/web/src/features/transition-insights/insights-pages.tsx` is not part of this PR.

## Global Constraints

- 100% coverage in `apps/api`, `packages/db` and `packages/access` (if it has tests); zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test doubles and cross-feature imports; `.github/workflows` untouched; app-side `new Date()` timestamps.
- Suppression threshold: 5 distinct talent profiles. Every person-derived figure carries its own distinct-people count; `< 5` → `null`. This applies to: `activated`, each funnel stage, `hiresShared`, and each row of `topJobs` (a job row is dropped entirely when fewer than 5 distinct people applied — not shown with null). `enabled` (people HR itself enabled) is not person-derived behaviour and is never suppressed. `sharedJobs` lists jobs HR shared (no personal data) and is never suppressed.
- Funnel (per application, counted as applications, people counted for suppression): `sent` = all; `responded` = `furthest_stage >= in_review` or `closed_reason in (rejected, hired)`; `interviews` = `furthest_stage >= interview`; `offers` = `furthest_stage = offer`. Stage order `sent < in_review < interview < offer` (enum order in Postgres matches; compare via an explicit `in (...)` list, not enum ordering).
- `hiresShared` counts applications closed as `hired` whose profile has `share_outcome_with_hr = true`.
- Response never contains names, emails, profile ids, application ids or any per-person row.
- Permission: CASL subject `TalentAggregates`; `admin` (manage all) and `rh` (`read TalentAggregates`) can read; `gestor`/`visualizador` → 403.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A stage reached by 4 people but 10 applications.** Must be null (suppression counts people, not applications). → Task 3 test `suppresses figures from fewer than five people`.
2. **A job applied to by 6 applications from 4 people.** Dropped from `topJobs`. → same test.
3. **Hires without consent** never counted, and withdrawing consent removes them. → Task 3 test `counts only consented hires`.
4. **gestor / visualizador / talent sessions** reading aggregates → 403. → Task 3 test `restricts aggregates to admin and rh`.
5. **Consent toggled by another profile or via a portal session** — impossible; `PUT /me/consent` is talent-only and scoped to `me.id`. → Task 2 test `stores the person's own consent`.

---

### Task 1: Seed for aggregates

**Files:**

- Modify: `packages/db/src/talent-profile.fixture.ts`, `packages/db/src/offboarding.fixture.ts` (if new cases are needed), `packages/db/src/application.fixture.ts`, `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Seed adds 7 more talent profiles (on existing or new seeded offboarding cases; terms accepted; sponsored; 5 of them signed in) each with a few applications on the 5 seeded jobs, so that: at least 6 distinct people applied; ≥ 5 people reached `in_review` or beyond; ≥ 5 reached `interview`; fewer than 5 reached `offer` (to show a suppressed figure locally); 2 hires with consent (`share_outcome_with_hr = true`) and 1 hire without. Applications need résumés: give each new profile a minimal base résumé (reuse a compact fixture content) and use it as `resume_id`. Events consistent with statuses.
- `testSeedFixtures` gets none of these.

- [ ] **Step 1: Failing test** `seeds enough people for HR aggregates`: counts of profiles, distinct applicants, consented hires as described; every new application references the applicant's own base résumé.
- [ ] **Step 2: Run** `npm test -w @offboard/db` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** db and api suites → PASS at 100% (adjust any api tests that counted seeded rows only if they use the default seed — most use `testSeedFixtures`).
- [ ] **Step 5: Commit** `feat(db): seed enough people for HR aggregates`

---

### Task 2: Permission and consent

**Files:**

- Modify: `packages/access/src/index.ts` (subject `TalentAggregates`; `rh` reads it), `apps/api/src/features/talent/repository.ts` (`setConsent`), `apps/api/src/features/talent/routes.ts` (`PUT /me/consent`; `GET /me` exposes `shareOutcomeWithHr`), `apps/api/src/shared/talent-profile.ts` (type field if needed)
- Test: `apps/api/src/features/talent/repository.test.ts`, `apps/api/src/app.test.ts`

**Interfaces:**

- `PortalPermission` subject union gains `"TalentAggregates"`; `createPortalAbility("rh")` can `read` it; `admin` via `manage all`.
- `setConsent(profileId: string, share: boolean, now: Date): Promise<TalentProfile>`.
- `PUT /me/consent { shareOutcomeWithHr: boolean }` (`talent: "active"`) → 200 me shape (now including `shareOutcomeWithHr`).

- [ ] **Step 1: Failing tests** — ability: rh/admin can read `TalentAggregates`, gestor/visualizador cannot; `stores the person's own consent` (PUT true then false; another profile unchanged; portal session → 403; GET /me shows the flag).
- [ ] **Step 2: Run** `npx vitest run src/features/talent src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** focused, then `npm test` (root) → 100%.
- [ ] **Step 5: Commit** `feat(api): let people share their hire outcome and add the aggregates permission`

---

### Task 3: Aggregates

**Files:**

- Create: `apps/api/src/features/insights/repository.ts`, `apps/api/src/features/insights/routes.ts`
- Modify: `apps/api/src/repositories.ts` (`insights`), `apps/api/src/app.ts`, `vercel.json` (rewrite `/api/talent/:path*`)
- Test: `apps/api/src/features/insights/repository.test.ts`, `apps/api/src/app.test.ts`

**Interfaces:**

- `type TalentAggregates = { enabled: number; activated: number | null; funnel: { sent: number | null; responded: number | null; interviews: number | null; offers: number | null }; hiresShared: number | null; topJobs: { title: string; company: string; applications: number }[]; sharedJobs: { title: string; company: string; sharedAt: string }[] }`
- `createInsightsRepository(db)` → `aggregates(): Promise<TalentAggregates>` — `topJobs`: up to 5 jobs by applications desc (ties by title), each with ≥ 5 distinct applicants; `sharedJobs`: up to 5 most recent `origin = 'hr'` jobs (open or closed), `sharedAt` = `posted_at` ISO.
- `GET /talent/aggregates` (`permit: ["read", "TalentAggregates"]`) → 200 `TalentAggregates` with `cache-control: no-store` (portal macro default).

- [ ] **Step 1: Failing tests** — repository with controlled data: `suppresses figures from fewer than five people` (4 people × many applications reaching offer → `offers: null`; 5 people → number; topJobs drops a job with 4 distinct applicants and 6 applications); `counts only consented hires` (consent off → not counted; on → counted; < 5 consenting hirees → null); activated suppression; enabled never suppressed; response has no ids/names (assert keys deep); route: `restricts aggregates to admin and rh` (admin 200, rh 200, gestor 403, visualizador 403, talent session 403, anonymous 401).
- [ ] **Step 2: Run** `npx vitest run src/features/insights src/app.test.ts` → FAIL.
- [ ] **Step 3: Implement** (SQL aggregates with `count(distinct profile_id)` alongside each `count(*)`).
- [ ] **Step 4: Verify** `npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`.
- [ ] **Step 5: Commit** `feat(api): serve privacy-preserving HR aggregates`

---

### Delivery

- [ ] Push `feat/talent-hr-aggregates`; open a PR with base `feat/talent-public-page` (stack … → #88 → this). Body: no migration; the portal page swap is a follow-up (Davi or a small web PR); differencing over time (counts changing by one) can still leak at the threshold edge — the threshold limits but doesn't eliminate it.
