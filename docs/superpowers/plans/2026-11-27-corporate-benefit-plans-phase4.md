# Corporate Benefit Plans — Phase 4 (Billing Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the billing back-end for employee co-pay subscriptions via AbacatePay, process co-pay webhook events that upgrade `effectivePlanId`, auto-cancel co-pay when HR raises an assignment, generate company benefit invoices, and enable the disabled co-pay button in the employee PlanCard.

**Architecture:** Two billing streams share the existing AbacatePay gateway and webhook endpoint. Employee co-pay mirrors the Carreira Pro checkout pattern (`talent:` prefix → `copay:` prefix) and writes to `benefit_assignments.copaySubscriptionId / effectivePlanId`. Company benefit invoices are internal records (sum of `per_person_price_cents` for active assignments) generated on demand by HR — no cron. The existing webhook handler dispatches by `externalId` prefix: `talent:` for Carreira Pro, `copay:` for co-pay, everything else for the company subscription. A new `copay_products` table maps `(fromPlanId, toPlanId)` → `abacatePayProductId` so the checkout sends the correct product to AbacatePay. `cancelSubscription(id)` is added to the gateway for auto-cancel.

**Tech Stack:** TypeScript, Elysia, Drizzle ORM, AbacatePay SDK, Vitest, React, TanStack Query, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-11-26-corporate-benefit-plans-design.md`

## Global Constraints

- 100% test coverage on all new pure-logic code (enforced by vitest thresholds).
- CI workflow must not change.
- One PR per phase; merge to main before proceeding.
- No comments except where a linter demands it or a non-obvious constraint would be invisible.
- oxlint `anti-slop(require-readable-spacing)` rule requires blank lines before `const`/`let` and control-flow statements.
- oxfmt enforces formatting — run pre-commit hook before pushing.
- Branch from latest `origin/main`. Migration number: next free after 0022 (currently 0023).
- Co-pay AbacatePay products are pre-registered externally. The 6 product IDs are stored in `copay_products` and seeded via migration or env config.

## Review Focus

1. **Cancelled/failed event for a superseded co-pay subscription:** When HR upgrades an assignment and auto-cancels the co-pay, AbacatePay fires a `subscription.cancelled` event for the old subscription. The webhook must be a no-op when `copaySubscriptionId` on the assignment no longer matches the event's subscription ID. → Test in Task 3: `test_stale_copay_cancel_is_noop`.
2. **Checkout paid after HR already upgraded past the target:** If HR raises the assignment to Platinum while a Gold→Platinum co-pay checkout is pending, `subscription.completed` arrives for a tier the employee already has. The webhook must check that `effectivePlanId` is still below the target before upgrading. → Test in Task 3: `test_copay_completed_after_hr_upgrade_is_noop`.
3. **HR edit via POST or PUT resets effectivePlanId while copaySubscriptionId is set:** Both routes call `upsertAssignment` which overwrites `effectivePlanId`. The auto-cancel function must run inside both routes, cancelling the co-pay at AbacatePay before writing the new assignment. Gateway failure returns 502 without changing the DB. → Test in Task 4: `test_hr_post_cancels_active_copay`.
4. **Generate benefit invoice called twice in the same month:** `(org_id, period)` unique constraint on `benefit_invoices` makes the second call a no-op returning the existing invoice. → Test in Task 5: `test_generate_invoice_idempotent`.
5. **validUntil passes while co-pay keeps renewing:** The benefit expires, but the co-pay subscription at AbacatePay is still active. The renewal webhook must check `validUntil >= today` and auto-cancel via gateway if lapsed, then set `copaySubscriptionId = null`. → Test in Task 3: `test_copay_renewal_after_benefit_expiry_cancels`.

---

### Task 1: Extend AbacatePay gateway + schema migration + benefit repository co-pay helpers

**Files:**

- Modify: `apps/api/src/features/billing/abacatepay.ts`
- Modify: `apps/api/src/features/benefits/repository.ts`
- Create: `packages/db/drizzle/0023_add_copay_products.sql`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `apps/api/src/billing.test.ts` (gateway cancel tests)
- Modify: `apps/api/src/features/benefits/repository.test.ts`

**Interfaces:**

- Produces:
  - `cancelSubscription(providerSubscriptionId: string): Promise<void>` on the gateway
  - `copayProducts` table: `{ id, fromPlanId (FK plans), toPlanId (FK plans), abacatePayProductId (varchar) }` with unique `(fromPlanId, toPlanId)`
  - `benefitInvoices` table: `{ id (uuid PK), orgId, period (varchar "YYYY-MM"), totalCents (integer), status (enum: "draft", "sent"), createdAt, updatedAt }` with unique `(orgId, period)`
  - `getCopayProduct(fromPlanId: string, toPlanId: string): Promise<{ abacatePayProductId: string } | null>` on benefit repository
  - `findAssignmentByProfile(profileId: string): Promise<{ id, assignedPlanId, effectivePlanId, copaySubscriptionId, validUntil } | null>` on benefit repository
  - `updateCopayState(profileId: string, patch: { effectivePlanId?: string, copaySubscriptionId?: string | null }): Promise<void>` on benefit repository
  - `findAssignmentBySubscription(copaySubscriptionId: string): Promise<{ profileId, assignedPlanId, effectivePlanId, validUntil } | null>` on benefit repository
  - `tallyActiveAssignments(orgId: string): Promise<{ totalCents: number, count: number }>` on benefit repository
  - `createBenefitInvoice(orgId: string, period: string, totalCents: number): Promise<{ id, period, totalCents, status }>` on benefit repository (upsert, returns existing on conflict)
  - `listBenefitInvoices(orgId: string): Promise<Array<{ id, period, totalCents, status, createdAt }>>` on benefit repository

- [ ] **Step 1: Write migration `0023_add_copay_products.sql`**

Create two tables:

```sql
CREATE TABLE "copay_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "from_plan_id" uuid NOT NULL REFERENCES "plans"("id"),
  "to_plan_id" uuid NOT NULL REFERENCES "plans"("id"),
  "abacatepay_product_id" varchar(255) NOT NULL,
  CONSTRAINT "copay_products_pair_idx" UNIQUE("from_plan_id", "to_plan_id")
);

CREATE TYPE "benefit_invoice_status" AS ENUM ('draft', 'sent');

CREATE TABLE "benefit_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "period" varchar(7) NOT NULL,
  "total_cents" integer NOT NULL DEFAULT 0,
  "status" "benefit_invoice_status" NOT NULL DEFAULT 'draft',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "benefit_invoices_org_period_idx" UNIQUE("org_id", "period")
);
```

- [ ] **Step 2: Add `copayProducts` and `benefitInvoices` to Drizzle schema**

In `packages/db/src/schema/index.ts`, add:

- `benefitInvoiceStatusEnum` pgEnum with values `["draft", "sent"]`
- `copayProducts` table with columns matching the migration
- `benefitInvoices` table with columns matching the migration
- Export both tables and add relations

- [ ] **Step 3: Write failing tests for `cancelSubscription` on the gateway**

In `apps/api/src/billing.test.ts`, add a test in the `abacatepay gateway` describe:

- `"cancels a subscription"` — mock server accepts POST to `/subscriptions/cancel` with `{ id: "subs_123" }`, returns `{ success: true, data: { id: "subs_123" } }`. Assert `cancelSubscription("subs_123")` resolves.
- `"throws when cancel fails"` — mock returns `{ success: false, error: "not found" }`. Assert `cancelSubscription("subs_x")` rejects.
- `"throws when gateway not configured"` — create gateway with `undefined` key, assert throws.

- [ ] **Step 4: Implement `cancelSubscription` on the gateway**

In `abacatepay.ts`, add:

```ts
async function cancelSubscription(providerSubscriptionId: string) {
  if (!apiKey) throw new Error("ABACATEPAY_API_KEY is not configured");

  const result = await AbacatePay({ secret: apiKey, rest: { base } }).subscriptions.cancel({
    id: providerSubscriptionId,
  });

  if (!result.success) {
    throw new Error(`AbacatePay subscription cancel failed: ${result.error}`);
  }
}
```

Add `cancelSubscription` to the returned object.

- [ ] **Step 5: Run gateway tests**

Run: `cd apps/api && npx vitest run src/billing.test.ts -t "abacatepay gateway"`
Expected: PASS

- [ ] **Step 6: Write failing tests for benefit repository co-pay helpers**

In `apps/api/src/features/benefits/repository.test.ts`, add tests for:

- `getCopayProduct` — insert a row in `copayProducts`, query by from/to plan IDs, assert returns the product ID. Query with non-existent pair, assert null.
- `findAssignmentByProfile` — insert an assignment, query by profile ID, assert returns the row with `copaySubscriptionId` and `validUntil`.
- `updateCopayState` — insert an assignment, call with `{ effectivePlanId: platinumId, copaySubscriptionId: "subs_1" }`, assert DB row updated.
- `findAssignmentBySubscription` — insert assignment with `copaySubscriptionId: "subs_1"`, query, assert returns. Query with wrong ID, assert null.
- `tallyActiveAssignments` — insert 3 assignments with different plans, assert totalCents = sum of `per_person_price_cents` for the assigned plans, count = 3. Insert one with `validUntil` in the past, assert it's excluded.
- `createBenefitInvoice` — create for period "2026-12", assert returned. Call again with same org+period, assert returns existing (upsert idempotent).
- `listBenefitInvoices` — insert 2 invoices for different periods, assert ordered by period desc.

- [ ] **Step 7: Implement benefit repository co-pay helpers**

In `apps/api/src/features/benefits/repository.ts`, add:

- `getCopayProduct(fromPlanId, toPlanId)` — select from `copayProducts` where match
- `findAssignmentByProfile(profileId)` — select from `benefitAssignments` returning `id, assignedPlanId, effectivePlanId, copaySubscriptionId, validUntil`
- `updateCopayState(profileId, patch)` — update `benefitAssignments` set patch where profileId
- `findAssignmentBySubscription(copaySubscriptionId)` — select from `benefitAssignments` where `copaySubscriptionId` matches
- `tallyActiveAssignments(orgId)` — select sum of `plans.perPersonPriceCents` and count from `benefitAssignments` inner join `plans` on `assignedPlanId` where `orgId` matches and `validUntil >= today`
- `createBenefitInvoice(orgId, period, totalCents)` — insert into `benefitInvoices` on conflict `(orgId, period)` do nothing, return the row
- `listBenefitInvoices(orgId)` — select from `benefitInvoices` where orgId, order by period desc

Export all from the repository's return object.

- [ ] **Step 8: Run benefit repository tests**

Run: `cd apps/api && npx vitest run src/features/benefits/repository.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/db/drizzle/0023_add_copay_products.sql packages/db/src/schema/index.ts \
  apps/api/src/features/billing/abacatepay.ts apps/api/src/features/benefits/repository.ts \
  apps/api/src/billing.test.ts apps/api/src/features/benefits/repository.test.ts
git commit -m "feat(api): add copay products table, benefit invoices, and gateway cancel"
```

---

### Task 2: Co-pay checkout API route

**Files:**

- Modify: `apps/api/src/features/career-plan/routes.ts`
- Modify: `apps/api/src/features/career-plan/repository.ts`
- Modify: `apps/api/src/billing.test.ts` (integration tests for the co-pay checkout route)

**Interfaces:**

- Consumes: `getCopayProduct` and `findAssignmentByProfile` from Task 1, `AbacatePayGateway.createSubscriptionCheckout` from existing gateway
- Produces:
  - `POST /me/plan/copay-checkout` — body `{ targetPlanId: string }`, returns `{ url: string }` or 409/422/503
  - `startCopayCheckout(profileId: string, now: Date): Promise<{ assignmentId: string } | null>` on career-plan repository (sets a pending lock on the assignment, similar to `startCheckout` for talent)
  - `releaseCopayCheckout(profileId: string): Promise<void>` on career-plan repository

- [ ] **Step 1: Write failing integration tests for `POST /me/plan/copay-checkout`**

In `apps/api/src/billing.test.ts`, add a describe block for co-pay checkout. Seed a benefit assignment with `assignedPlanId: goldId, effectivePlanId: goldId` and a `copayProducts` row for `(goldId, platinumId) → "prod_gold_platinum"`. Tests:

- `"starts co-pay checkout for a valid upgrade"` — POST with `{ targetPlanId: platinumId }`, assert 200 with `url` field. Assert the mock server received `items: [{ id: "prod_gold_platinum", quantity: 1 }]` and `externalId` starts with `"copay:"`.
- `"rejects when no benefit assignment"` — POST for a profile with no assignment, assert 404.
- `"rejects when target is same or lower tier"` — POST with `{ targetPlanId: goldId }` (same as assigned), assert 422.
- `"rejects when no copay product registered"` — POST with a target that has no copay_products row, assert 422.
- `"rejects when gateway not configured"` — create app with unconfigured gateway, assert 503.
- `"rejects when co-pay already active"` — set `copaySubscriptionId` on the assignment, assert 409.

- [ ] **Step 2: Implement `startCopayCheckout` and `releaseCopayCheckout` on career-plan repository**

`startCopayCheckout(profileId, now)`: select the assignment where profileId and validUntil >= today and copaySubscriptionId is null and updatedAt is stale (using `checkoutRetryMs`). If found, set updatedAt = now (advisory lock). Return `{ assignmentId }` or null.

`releaseCopayCheckout(profileId)`: reset updatedAt to epoch on the assignment where profileId and copaySubscriptionId is null.

- [ ] **Step 3: Implement `POST /me/plan/copay-checkout` route**

In `career-plan/routes.ts`, add route:

1. Check `gateway.configured`; return 503 if not.
2. Find assignment by profile (`repos.benefits.findAssignmentByProfile(me.id)`); return 404 if none.
3. If `copaySubscriptionId` is set, return 409 ("Co-pay already active").
4. If `targetPlanId === assignedPlanId` or target plan's `perPersonPriceCents <= assigned plan's`, return 422.
5. Get copay product (`repos.benefits.getCopayProduct(assignedPlanId, targetPlanId)`); return 422 if none.
6. Lock checkout (`repos.careerPlan.startCopayCheckout(me.id, now)`); return 409 if null.
7. Call `gateway.createSubscriptionCheckout` with `externalId: "copay:<profileId>:<targetPlanId>"`, `planSlug: copayProduct.abacatePayProductId`, returnUrl/completionUrl pointing to `${webOrigin}/colaborador?tela=carreira`.
8. On error, release checkout and return 502.
9. Return `{ url }`.

Wire `repos.benefits` into career-plan routes (pass as parameter alongside existing deps).

- [ ] **Step 4: Wire benefit repository into career-plan routes in `app.ts`**

Add `repos.benefits` to the `careerPlanRoutes` call in `app.ts`.

- [ ] **Step 5: Run integration tests**

Run: `cd apps/api && npx vitest run src/billing.test.ts -t "co-pay checkout"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/career-plan/routes.ts apps/api/src/features/career-plan/repository.ts \
  apps/api/src/app.ts apps/api/src/billing.test.ts
git commit -m "feat(api): add co-pay checkout route for benefit tier upgrade"
```

---

### Task 3: Webhook handling for co-pay events

**Files:**

- Modify: `apps/api/src/features/billing/webhook.ts`
- Modify: `apps/api/src/billing.test.ts` (webhook integration tests)

**Interfaces:**

- Consumes: `findAssignmentBySubscription`, `updateCopayState`, `cancelSubscription` from Tasks 1-2, `BenefitRepository` type
- Produces: Extended `applyWebhookEvent` that handles `copay:` prefix events

The webhook handler receives events with `externalId: "copay:<profileId>:<targetPlanId>"`. It routes by prefix. For renewals/cancels without `checkout.externalId`, it falls back to `findAssignmentBySubscription(providerSubscriptionId)`.

**Event handling:**

- `subscription.completed` → set `effectivePlanId` to the target plan, set `copaySubscriptionId` to the provider subscription ID. Guard: only if current `effectivePlanId` price < target plan price (HR may have already upgraded).
- `subscription.renewed` → no-op if `copaySubscriptionId` matches and `validUntil >= today`. If `validUntil < today`, cancel the subscription via gateway and clear `copaySubscriptionId`.
- `subscription.payment_failed` → log warning, no state change (keep current effective tier; AbacatePay retries).
- `subscription.cancelled` → if `copaySubscriptionId` matches the event's subscription ID, revert `effectivePlanId` to `assignedPlanId` and clear `copaySubscriptionId`. If doesn't match, no-op (stale event).

- [ ] **Step 1: Write failing integration tests for co-pay webhook events**

In `apps/api/src/billing.test.ts`, add a describe block for co-pay webhooks. Seed: a benefit assignment with `assignedPlanId: goldId, effectivePlanId: goldId`, a `copayProducts` row for `(goldId, platinumId)`. Tests:

- `"subscription.completed upgrades effectivePlanId"` — send webhook with `externalId: "copay:<profileId>:<platinumId>"`, assert assignment's `effectivePlanId` changed to platinumId and `copaySubscriptionId` set.
- `"subscription.completed is noop when HR already upgraded"` — set `effectivePlanId: platinumId` beforehand, send completed event, assert no change.
- `"subscription.cancelled reverts effectivePlanId"` — set `copaySubscriptionId: "subs_1"` and `effectivePlanId: platinumId`, send cancelled event for `subs_1`, assert `effectivePlanId` reverted to `assignedPlanId` and `copaySubscriptionId` cleared.
- `"stale cancel for wrong subscription is noop"` — `copaySubscriptionId: "subs_2"`, send cancelled for `subs_1`, assert no change.
- `"renewal after benefit expiry cancels subscription"` — `validUntil` in the past, `copaySubscriptionId: "subs_1"`, send renewed event. Assert the mock server received a cancel call and `copaySubscriptionId` cleared.
- `"renewal within validity is noop"` — `validUntil` in the future, send renewed, assert no state change.
- `"fallback lookup by provider subscription ID"` — send event without `checkout.externalId` but with matching `data.subscription.id`. Assert it still finds the assignment.

- [ ] **Step 2: Pass benefit repository and gateway to `applyWebhookEvent`**

Change signature: `applyWebhookEvent(repos: BillingRepository, benefits: BenefitRepository, gateway: AbacatePayGateway, event, deliveryId)`. Update the caller in `billing/routes.ts` and all existing test calls.

- [ ] **Step 3: Implement co-pay event handling in `webhook.ts`**

Add `copayPrefix = "copay:"` constant. In `applyWebhookEvent`, after the `talentPrefix` check, check for `copayPrefix`:

1. Parse profileId and targetPlanId from `externalId.slice(copayPrefix.length).split(":")`.
2. Find assignment by profile. If none, log and return.
3. For `subscription.completed`: compare plan prices; if target > current effective, update `effectivePlanId` and `copaySubscriptionId`.
4. For `subscription.cancelled`: if `copaySubscriptionId` matches, revert to `assignedPlanId` and clear.
5. For `subscription.renewed`: check `validUntil >= today`; if lapsed, cancel via gateway and clear.
6. For events without `copayPrefix` in externalId but not matching talent or company: try `findAssignmentBySubscription(providerSubscriptionId)` as fallback.

- [ ] **Step 4: Run webhook tests**

Run: `cd apps/api && npx vitest run src/billing.test.ts -t "co-pay webhook"`
Expected: PASS

- [ ] **Step 5: Run full billing test suite**

Run: `cd apps/api && npx vitest run src/billing.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/billing/webhook.ts apps/api/src/features/billing/routes.ts \
  apps/api/src/billing.test.ts
git commit -m "feat(api): handle co-pay subscription webhooks with auto-cancel on expiry"
```

---

### Task 4: Auto-cancel co-pay on HR assignment change

**Files:**

- Modify: `apps/api/src/features/benefits/routes.ts`
- Modify: `apps/api/src/features/benefits/routes.test.ts`

**Interfaces:**

- Consumes: `findAssignmentByProfile`, `cancelSubscription` from gateway, `updateCopayState` from benefit repo
- Produces: Both POST and PUT on `/benefit-assignments` auto-cancel any active co-pay subscription when the new assignment tier >= the co-pay target tier

The logic: when HR assigns/changes a benefit, check if there's an active `copaySubscriptionId`. If the new plan's price >= the co-pay target plan's price (or any change at all — simpler: always cancel on reassignment), cancel at AbacatePay first, then write the new assignment with `copaySubscriptionId: null, effectivePlanId: newPlanId`. On gateway failure, return 502.

- [ ] **Step 1: Write failing tests for auto-cancel on POST and PUT**

In `apps/api/src/features/benefits/routes.test.ts`, add:

- `"POST benefit-assignments cancels active copay"` — seed assignment with `copaySubscriptionId: "subs_1"` and `effectivePlanId: platinumId`, POST a new assignment with `planId: platinumId`. Assert the mock AbacatePay received a cancel for `subs_1` and the DB row has `copaySubscriptionId: null`.
- `"PUT benefit-assignments cancels active copay"` — same but via PUT `:id`.
- `"POST returns 502 when cancel fails"` — mock server returns error on cancel, assert 502 and DB unchanged.

- [ ] **Step 2: Pass gateway to `benefitRoutes`**

Change signature: `benefitRoutes(repos: BenefitRepository, access: PortalAccessPlugin, gateway: AbacatePayGateway)`. Update `app.ts` to pass `abacatepay` to benefit routes.

- [ ] **Step 3: Add auto-cancel logic to POST and PUT handlers**

Extract a shared helper `cancelActiveCopay(repos, gateway, profileId)`:

1. `findAssignmentByProfile(profileId)`.
2. If `copaySubscriptionId` is set, call `gateway.cancelSubscription(copaySubscriptionId)`.
3. Clear `copaySubscriptionId` via `updateCopayState`.

Call before `upsertAssignment` in both POST and PUT. On gateway error, return 502. After cancel, `upsertAssignment` writes `effectivePlanId: body.planId` (the new company assignment), which is correct since the co-pay is cancelled.

- [ ] **Step 4: Run benefit routes tests**

Run: `cd apps/api && npx vitest run src/features/benefits/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Run full API test suite**

Run: `cd apps/api && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/benefits/routes.ts apps/api/src/features/benefits/routes.test.ts \
  apps/api/src/app.ts
git commit -m "feat(api): auto-cancel co-pay when HR changes benefit assignment"
```

---

### Task 5: Company benefit invoice generation

**Files:**

- Modify: `apps/api/src/features/billing/routes.ts`
- Modify: `apps/api/src/billing.test.ts`

**Interfaces:**

- Consumes: `tallyActiveAssignments`, `createBenefitInvoice`, `listBenefitInvoices` from Task 1
- Produces:
  - `POST /billing/benefit-invoices/generate` — HR triggers monthly tally, returns the invoice. Idempotent per `(orgId, period)`.
  - `GET /billing/benefit-invoices` — list of company benefit invoices for the org.

- [ ] **Step 1: Write failing integration tests for benefit invoice routes**

In `apps/api/src/billing.test.ts`, add a describe block for benefit invoices. Seed: 3 benefit assignments with known plans. Tests:

- `"generates a benefit invoice for the current month"` — POST, assert 200 with `{ id, period: "YYYY-MM", totalCents, status: "draft" }`. Assert totalCents = sum of `per_person_price_cents` for the 3 assignments.
- `"generate is idempotent"` — POST twice, assert same id returned.
- `"generate excludes expired assignments"` — set one assignment's `validUntil` to past, POST, assert totalCents excludes it.
- `"lists benefit invoices"` — generate 2 invoices (different periods by inserting directly), GET, assert ordered by period desc.
- `"returns empty when no invoices"` — GET for org with no invoices, assert empty array.

- [ ] **Step 2: Implement benefit invoice routes**

In `billing/routes.ts`, add:

- `POST /billing/benefit-invoices/generate` — permit `["manage", "Billing"]`. Compute period as `YYYY-MM` from `saoPauloDate(new Date())`. Call `repos.benefits.tallyActiveAssignments(orgId)`. Call `repos.benefits.createBenefitInvoice(orgId, period, totalCents)`. Return the invoice.
- `GET /billing/benefit-invoices` — permit `["read", "Billing"]`. Call `repos.benefits.listBenefitInvoices(orgId)`. Return the list.

Wire `repos.benefits` into `billingRoutes` (add parameter to signature and `app.ts` call).

- [ ] **Step 3: Run integration tests**

Run: `cd apps/api && npx vitest run src/billing.test.ts -t "benefit invoice"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/features/billing/routes.ts apps/api/src/billing.test.ts apps/api/src/app.ts
git commit -m "feat(api): add benefit invoice generation and listing routes"
```

---

### Task 6: Enable co-pay button in PlanCard + API co-pay field

**Files:**

- Modify: `apps/api/src/features/career-plan/routes.ts` (extend response type)
- Modify: `apps/api/src/shared/career-pro.ts` (add `copay` to `careerPlanOf` return)
- Modify: `apps/web/src/features/employee/career/plan-card.ts` (add `copay` to `CareerPlan` type and view model)
- Modify: `apps/web/src/features/employee/career/plan-card.test.ts`
- Modify: `apps/web/src/features/employee/career/plan.tsx` (enable co-pay button with checkout mutation)
- Modify: `apps/web/src/entities/career/index.ts` (add `useCopayCheckout` mutation)

**Interfaces:**

- Consumes: `POST /me/plan/copay-checkout` from Task 2, `getCopayProduct`, `findAssignmentByProfile` from Task 1
- Produces: Extended `CareerPlan` type with `copay: { offered: boolean; targetPlanId: string; targetPlanName: string; priceCents: number; active: boolean } | null`. PlanCard renders an enabled co-pay button that opens checkout.

The API's `/me/plan` response gains a `copay` field computed server-side from the assignment: if a next tier exists and a `copayProducts` row exists for `(assignedPlanId, nextTierPlanId)`, `copay.offered = true`. If `copaySubscriptionId` is set, `copay.active = true`. The web reads `copay` and replaces the disabled "Em breve" button with a working checkout.

- [ ] **Step 1: Extend `careerPlanOf` to include `copay` field**

In `apps/api/src/shared/career-pro.ts`, the `copay` field cannot be computed from `careerPlanOf` alone since it needs DB lookups (`getCopayProduct`, plan names). Instead, compute it in the career-plan repository's `plan()` method and append it to the return value.

In `career-plan/repository.ts`, after calling `careerPlanOf(...)`, look up:

1. The assignment via `benefits.findAssignmentByProfile(profileId)`.
2. If assignment exists: find the next tier plan by joining `copayProducts` where `fromPlanId = assignedPlanId`. If found: `copay = { offered: gateway.configured && !copaySubscriptionId, targetPlanId, targetPlanName, priceCents: targetPerPersonPriceCents - assignedPerPersonPriceCents, active: Boolean(copaySubscriptionId) }`.
3. If no assignment or no copay product: `copay = null`.

- [ ] **Step 2: Add `copay` to the API response schema in career-plan routes**

In `career-plan/routes.ts`, extend `careerPlanResponse` with:

```ts
copay: t.Union([
  t.Object({
    offered: t.Boolean(),
    targetPlanId: t.String(),
    targetPlanName: t.String(),
    priceCents: t.Number(),
    active: t.Boolean(),
  }),
  t.Null(),
]);
```

- [ ] **Step 3: Write failing tests for the extended plan-card view model**

In `apps/web/src/features/employee/career/plan-card.test.ts`, add `copay` to the `CareerPlan` type:

- `"shows co-pay button when offered"` — `copay: { offered: true, targetPlanId: "x", targetPlanName: "Platinum", priceCents: 3000, active: false }` → view model has `copayButton: "available"` and `copayLabel: "Upgrade para Platinum · R$ 30/mês"`.
- `"hides co-pay button when not offered"` — `copay: null` → `copayButton: "hidden"`.
- `"shows co-pay active state"` — `copay: { ..., active: true }` → `copayButton: "active"` and `copayActiveLabel: "Upgrade ativo · Platinum"`.
- `"replaces disabled Em breve button"` — benefit with comparison, copay offered → both comparison and copay button shown, no "Em breve".

- [ ] **Step 4: Extend `CareerPlan` type and `planCardView` in plan-card.ts**

Add `copay` field to `CareerPlan`. Add to `planCardView` return:

- `copayButton: "hidden" | "available" | "active"` — "available" when `copay?.offered`, "active" when `copay?.active`, "hidden" otherwise.
- `copayLabel: string | null` — `"Upgrade para ${copay.targetPlanName} · ${planPrice(copay.priceCents)}"` when offered.
- `copayActiveLabel: string | null` — `"Upgrade ativo · ${copay.targetPlanName}"` when active.

- [ ] **Step 5: Run plan-card tests**

Run: `cd apps/web && npx vitest run src/features/employee/career/plan-card.test.ts`
Expected: PASS

- [ ] **Step 6: Add `useCopayCheckout` mutation in entities/career**

In `apps/web/src/entities/career/index.ts`, add:

```ts
export function useCopayCheckout(account: EmployeeAccount) {
  return useMutation({
    async mutationFn(targetPlanId: string) {
      const result = await client()["plan"]["copay-checkout"].post(
        { targetPlanId },
        { headers: employeeAccessHeaders(account) },
      );

      return settle(result, "Não foi possível abrir o pagamento. Tente de novo.");
    },
    onSuccess(checkout) {
      window.location.assign(checkout.url);
    },
  });
}
```

- [ ] **Step 7: Update PlanCard component to use co-pay checkout**

In `plan.tsx`:

1. Replace the disabled `<Button>` that shows `{comparison.copayLabel} · Em breve` with a live button.
2. When `view.copayButton === "available"`: render `<Button onClick={() => copayCheckout.mutate(plan.copay!.targetPlanId)} disabled={copayCheckout.isPending}>{view.copayLabel}</Button>`.
3. When `view.copayButton === "active"`: render `<Badge variant="status-success">{view.copayActiveLabel}</Badge>`.
4. When `view.copayButton === "hidden"`: render nothing (removes the "Em breve" button entirely).

- [ ] **Step 8: Run full web test suite**

Run: `cd apps/web && npx vitest run`
Expected: PASS with 100% coverage.

- [ ] **Step 9: Run full API test suite**

Run: `cd apps/api && npx vitest run`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/features/career-plan/routes.ts apps/api/src/features/career-plan/repository.ts \
  apps/api/src/shared/career-pro.ts \
  apps/web/src/features/employee/career/plan-card.ts apps/web/src/features/employee/career/plan-card.test.ts \
  apps/web/src/features/employee/career/plan.tsx apps/web/src/entities/career/index.ts
git commit -m "feat(web): enable co-pay checkout button in PlanCard"
```
