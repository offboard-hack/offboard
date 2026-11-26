# Career Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This plan delivers three things. The collaborator sees their plan (the company plan, what it includes, and the sponsorship date HR set) and can buy Carreira Pro (R$ 79/month, AI Apply with 10 real sends a day) through AbacatePay. HR sets "Carreira patrocinada até" on the case.

**Spec:** `docs/superpowers/specs/2026-11-26-career-plans-design.md`.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test-double libraries and cross-feature imports (read tables via `@offboard/db/schema`, compose in `app.ts`). Timestamps are set app-side. `.github/workflows` stays untouched.
- All values are as written in the spec (Rules, Data, Portal). `careerPro` is a constant in `apps/api/src/shared/career-pro.ts`.
- Migration 0015 is hand-written: SQL, then the snapshot copied from 0014 with a new `id` and `prevId` set to 0014's id, then the journal entry. Cross-check with `npx drizzle-kit export`.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **AI Apply after the sponsorship date** with no Carreira Pro → 403. With an active Carreira Pro and no company plan → allowed. Task 1 test `grants AI Apply by company sponsorship or Carreira Pro`.
2. **The 11th real send in a São Paulo day** → 429. Rehearsals don't count. Task 1 test.
3. **A webhook for a talent subscription** must never touch company subscriptions, and the reverse holds too. An unknown `externalId` → 200 ignored. Task 2 test.
4. **HR from another org** can't set another org's sponsorship date. Task 2 test.
5. **The card** for: no company plan, company top plan with a date in the future, an expired date, and Pro active. Task 3 view-model test.

---

### Task 1: Data, entitlement, daily limit and `GET /me/plan`

**Files:** migration 0015 plus the schema; `apps/api/src/shared/career-pro.ts`; the AI Apply gate (`shared/ai-apply-access.ts` and its callers: routes, runner re-check, `GET /me` `aiApply`); the confirm route's daily limit; `features/talent` or a new `features/career-plan` for `GET /me/plan` and the repository; the export; tests.

**Interfaces:**

- `GET /me/plan` (talent "active") returns:

  ```
  {
    company: { name: string | null, includesAiApply: boolean, sponsoredUntil: string },
    individual: { plan: "carreira-pro", status, currentPeriodEnd: string | null } | null,
    aiApply: { allowedBy: "company" | "individual" | null },
    upgrade: { offered: boolean, priceCents: 7900, dailyLimit: 10 }
  }
  ```

  `sponsoredUntil` is the access row's `career_sponsored_until` if set, otherwise the case deadline + 3 months. Profiles that were not bridged through a collaborator use `talent_profiles.sponsored_until`.

- [ ] Steps: failing tests (Review Focus 1 and 2; every shape of the plan response) → implement → gates → commit `feat(api): show the person's career plan and limit AI sends per day`.

### Task 2: Carreira Pro checkout, webhook and the HR date

**Files:** `features/billing/abacatepay.ts` (reused as-is, product id `carreira-pro`); new route `POST /me/plan/checkout`; `features/billing/webhook.ts` and the repository (route `externalId` to talent subscriptions); the employee-access settings route and schema gain `careerSponsoredUntil` (org-scoped); the portal case UI field (`apps/web/src/...` where the collaborator access email is edited); tests.

- [ ] Steps:
  - Failing tests:
    - Review Focus 3 and 4;
    - checkout 503 without AbacatePay;
    - checkout creates a `pending` subscription row and returns the URL;
    - webhook `subscription.completed` → `active` with the period end set;
    - `renewed` → the period is extended;
    - `cancelled` → `canceled`.
  - Implement, run the gates, then commit `feat: sell Carreira Pro and let HR set the career sponsorship date`.

### Task 3: "Seu plano" card in Carreira

**Files:** `apps/web/src/entities/career/index.ts` (plan query, checkout mutation); `apps/web/src/features/employee/career/plan.tsx` (card) and a pure view-model helper with tests at 100%; shown at the top of Carreira, in Vagas and Candidaturas; `?plano=ok` shows "Pagamento recebido. O Carreira Pro é ativado assim que o pagamento for confirmado." and polls the plan until it is active.

- [ ] Steps: failing tests for the view model (Review Focus 5) → implement → gates (`npm run lint -- --force`, format, web build, root `npm test`) → commit `feat(web): show the career plan and offer Carreira Pro`.

### Delivery

- [ ] Apply 0015 to production (with Samuel's OK), push, open one PR, and merge once CI passes. In the PR body, list the AbacatePay ops steps: the `carreira-pro` product, the keys and the webhook URL.
