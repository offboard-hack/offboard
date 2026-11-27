# Corporate Benefit Plans — Phase 2 (HR Management UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HR portal UI for managing corporate benefit policies (default tier, duration, condition rules) and individual benefit assignments, with a cost summary.

**Architecture:** A new `/beneficios` portal route under the `_portal` layout, with a feature module at `apps/web/src/features/benefits/`. The page has three sections: policy config form (default plan, duration, condition rules), assignment DataTable with manual override dialog, and a cost summary panel. All data fetched from Phase 1 API endpoints via Eden treaty client. Pure logic (form defaults, cost calculation, rule validation) is extracted into testable `.ts` files; React components are thin wrappers.

**Tech Stack:** TanStack Router (file-based), TanStack Query, TanStack Form, TanStack Table (via `DataTable`), shadcn/ui, Eden treaty client, Vitest

**Spec:** `docs/superpowers/specs/2026-11-26-corporate-benefit-plans-design.md`

## Global Constraints

- `org_id` isolation: every API call goes through the portal session; the backend enforces org scoping.
- 100% test coverage on all new code (Vitest `v8` provider, thresholds at 100%).
- CI workflow must not change.
- One PR for this phase; merge to main before Phase 3.
- Labels in Portuguese (pt-BR): "Benefícios", "Política de benefícios", "Atribuições", etc.
- Condition rules support `contains` operator (in addition to `equals`/`notEquals` from checklist).
- Each rule also carries a `planId` (which tier to assign when the rule matches).
- Permission: `["read", "Billing"]` for viewing, `["manage", "Billing"]` for editing — only `admin` can manage.

## Review Focus

1. **Cost summary with zero assignments**: the page must render gracefully with no policy, no assignments, and no plans — empty states for each section. Add empty-state assertion in Task 3 test.
2. **Rule with `contains` operator and accented text**: the form must allow free-text input for `contains` and pass it unmodified to the API (the backend does NFD normalization). Add a test in Task 2 that the schema accepts a `contains` rule with accented value.
3. **Assignment list reflects plan name changes after policy save**: the assignment table reads plan names from the API, not from local state. After saving a policy, invalidating `benefit-assignments` query is essential. Add query invalidation assertion in Task 3.
4. **Manual override for a profile that already has an assignment**: POST /benefit-assignments upserts, so the dialog should work for both new and existing assignments. The test in Task 3 covers the happy path.
5. **Concurrent save of policy while viewing assignments**: the UI must not crash if the policy save returns while the assignment list is stale. TanStack Query staleness handles this, but verify the `staleTime` is short enough (30s).

---

### Task 1: Benefit entity queries and mutations

**Files:**

- Create: `apps/web/src/entities/benefits.ts`
- Test: `apps/web/src/entities/benefits.test.ts`
- Modify: `apps/web/vitest.config.ts` (add coverage entry)

**Interfaces:**

- Consumes: Eden treaty client (`getApiClient()`) from `@/shared/lib/api-client`
- Produces: `benefitPolicyQuery`, `benefitAssignmentsQuery`, `benefitPlansQuery`, `useSaveBenefitPolicy(onSuccess)`, `useAssignBenefit(onSuccess)`, `useUpdateAssignment(onSuccess)`, `BenefitPolicyData`, `BenefitAssignmentRow`, `BenefitPlanOption`

- [ ] **Step 1: Write failing tests for query factories and mutation hooks**

```ts
// benefits.test.ts
import { describe, it, expect } from "vitest";
import { policyDefaults, costSummary, type BenefitPlanOption } from "./benefits";

describe("policyDefaults", () => {
  it("returns empty policy when input is null", () => {
    expect(policyDefaults(null)).toEqual({
      defaultPlanId: null,
      benefitDurationMonths: 6,
      rules: [],
    });
  });

  it("passes through existing policy", () => {
    const policy = {
      defaultPlanId: "abc",
      benefitDurationMonths: 3,
      rules: [
        {
          id: "r1",
          field: "department" as const,
          operator: "equals" as const,
          value: "Eng",
          planId: "p1",
        },
      ],
    };
    expect(policyDefaults(policy)).toEqual(policy);
  });
});

describe("costSummary", () => {
  const plans: BenefitPlanOption[] = [
    { id: "s", name: "Silver", slug: "silver", perPersonPriceCents: 0 },
    { id: "g", name: "Gold", slug: "gold", perPersonPriceCents: 2900 },
    { id: "p", name: "Platinum", slug: "platinum", perPersonPriceCents: 5900 },
  ];

  it("returns zero for empty assignments", () => {
    expect(costSummary([], plans)).toEqual({ totalCents: 0, tiers: [] });
  });

  it("sums assigned plan prices and groups by tier", () => {
    const assignments = [
      { assignedPlanName: "Gold" },
      { assignedPlanName: "Gold" },
      { assignedPlanName: "Platinum" },
    ];
    const result = costSummary(assignments as any, plans);
    expect(result.totalCents).toBe(2900 + 2900 + 5900);
    expect(result.tiers).toEqual([
      { name: "Gold", count: 2, subtotalCents: 5800 },
      { name: "Platinum", count: 1, subtotalCents: 5900 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/entities/benefits.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `entities/benefits.ts`**

Export:

- `benefitPolicyQuery: QueryOptions` — calls `getApiClient().api["benefit-policy"].get()`, returns data or `null` on 404
- `benefitAssignmentsQuery: QueryOptions` — calls `getApiClient().api["benefit-assignments"].get()`
- `benefitPlansQuery: QueryOptions` — reuses `plansQuery` from `@/entities/billing` (same endpoint, same plans)
- `useSaveBenefitPolicy(onSuccess): UseMutationResult` — PUT to `api["benefit-policy"].put()`
- `useAssignBenefit(onSuccess): UseMutationResult` — POST to `api["benefit-assignments"].post()`
- `useUpdateAssignment(onSuccess): UseMutationResult` — PUT to `api["benefit-assignments"][":id"].put()`
- `policyDefaults(data: PolicyData | null): PolicyFormValues` — pure function
- `costSummary(assignments, plans): { totalCents, tiers: { name, count, subtotalCents }[] }` — pure function
- `type BenefitPolicyData`, `type BenefitAssignmentRow`, `type BenefitPlanOption`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/entities/benefits.test.ts`
Expected: PASS

- [ ] **Step 5: Add coverage entry to vitest config**

Add `"src/entities/benefits.ts"` to `coverage.include` in `apps/web/vitest.config.ts`.

- [ ] **Step 6: Run all web tests**

Run: `cd apps/web && npx vitest run`
Expected: PASS (pre-existing failures in query-client.test.ts and action-config.test.ts are known and unrelated)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/entities/benefits.ts apps/web/src/entities/benefits.test.ts apps/web/vitest.config.ts
git commit -m "feat(web): benefit entity queries, mutations, and cost summary"
```

---

### Task 2: Benefit policy form logic

**Files:**

- Create: `apps/web/src/features/benefits/policy-form.ts`
- Test: `apps/web/src/features/benefits/policy-form.test.ts`
- Modify: `apps/web/vitest.config.ts` (add coverage entry)

**Interfaces:**

- Consumes: `BenefitPlanOption` from Task 1
- Produces: `benefitPolicySchema: ZodSchema`, `durationOptions: { value, label }[]`, `ruleFieldOptions`, `ruleOperatorOptions`, `emptyRule(plans): RuleFormRow`

- [ ] **Step 1: Write failing tests**

```ts
// policy-form.test.ts
import { describe, it, expect } from "vitest";
import {
  benefitPolicySchema,
  durationOptions,
  ruleOperatorOptions,
  emptyRule,
} from "./policy-form";

describe("benefitPolicySchema", () => {
  it("accepts a valid policy", () => {
    const result = benefitPolicySchema.safeParse({
      defaultPlanId: "uuid-here",
      benefitDurationMonths: 6,
      rules: [
        {
          id: "r1",
          field: "department",
          operator: "contains",
          value: "Engenharia",
          planId: "uuid-plan",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts null defaultPlanId", () => {
    expect(
      benefitPolicySchema.safeParse({
        defaultPlanId: null,
        benefitDurationMonths: 3,
        rules: [],
      }).success,
    ).toBe(true);
  });

  it("rejects duration outside 1-24", () => {
    expect(
      benefitPolicySchema.safeParse({
        defaultPlanId: null,
        benefitDurationMonths: 0,
        rules: [],
      }).success,
    ).toBe(false);
    expect(
      benefitPolicySchema.safeParse({
        defaultPlanId: null,
        benefitDurationMonths: 25,
        rules: [],
      }).success,
    ).toBe(false);
  });

  it("rejects rule with empty value", () => {
    expect(
      benefitPolicySchema.safeParse({
        defaultPlanId: null,
        benefitDurationMonths: 6,
        rules: [
          {
            id: "r1",
            field: "role",
            operator: "equals",
            value: "",
            planId: "p1",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts contains rule with accented value", () => {
    const result = benefitPolicySchema.safeParse({
      defaultPlanId: null,
      benefitDurationMonths: 6,
      rules: [
        {
          id: "r1",
          field: "role",
          operator: "contains",
          value: "Gerência",
          planId: "p1",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("durationOptions", () => {
  it("contains 3, 6, and 12 months", () => {
    const values = durationOptions.map((o) => o.value);
    expect(values).toContain("3");
    expect(values).toContain("6");
    expect(values).toContain("12");
  });
});

describe("ruleOperatorOptions", () => {
  it("includes contains", () => {
    expect(ruleOperatorOptions.some((o) => o.value === "contains")).toBe(true);
  });
});

describe("emptyRule", () => {
  it("returns a rule with generated id and first plan", () => {
    const rule = emptyRule([{ id: "p1", name: "Gold", slug: "gold", perPersonPriceCents: 2900 }]);
    expect(rule.id).toBeTruthy();
    expect(rule.planId).toBe("p1");
    expect(rule.field).toBe("department");
    expect(rule.operator).toBe("equals");
    expect(rule.value).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/features/benefits/policy-form.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `policy-form.ts`**

Export:

- `benefitPolicySchema` — Zod schema: `{ defaultPlanId: string | null, benefitDurationMonths: z.number().int().min(1).max(24), rules: z.array(ruleSchema).max(100) }` where `ruleSchema` has `{ id, field: "department"|"role", operator: "equals"|"notEquals"|"contains", value: z.string().trim().min(1).max(120), planId: z.string().min(1) }`
- `durationOptions` — `[{ value: "1", label: "1 mês" }, ..., { value: "24", label: "24 meses" }]` for all 1-24, with `mês`/`meses` plural
- `ruleFieldOptions` — `[{ value: "department", label: "Área" }, { value: "role", label: "Cargo" }]`
- `ruleOperatorOptions` — `[{ value: "equals", label: "É igual a" }, { value: "notEquals", label: "É diferente de" }, { value: "contains", label: "Contém" }]`
- `emptyRule(plans: BenefitPlanOption[]): RuleFormRow` — creates a rule with `createLocalId()`, default field/operator, empty value, first plan's id

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/features/benefits/policy-form.test.ts`
Expected: PASS

- [ ] **Step 5: Add coverage entry**

Add `"src/features/benefits/policy-form.ts"` to `coverage.include`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benefits/policy-form.ts apps/web/src/features/benefits/policy-form.test.ts apps/web/vitest.config.ts
git commit -m "feat(web): benefit policy form schema and options"
```

---

### Task 3: Benefits page (route, policy form UI, assignments table, cost summary, override dialog)

**Files:**

- Create: `apps/web/src/app/routes/_portal.beneficios.tsx`
- Create: `apps/web/src/features/benefits/benefits-page.tsx`
- Modify: `apps/web/src/app/portal.tsx` (add sidebar link to `/beneficios`)

**Interfaces:**

- Consumes: all exports from Task 1 (`benefitPolicyQuery`, `benefitAssignmentsQuery`, `useSaveBenefitPolicy`, `useAssignBenefit`, `useUpdateAssignment`, `costSummary`, `policyDefaults`, `BenefitPlanOption`) and Task 2 (`benefitPolicySchema`, `durationOptions`, `ruleFieldOptions`, `ruleOperatorOptions`, `emptyRule`)
- Produces: `BenefitsPage` component (lazy-loaded from route), rendered at `/beneficios`

- [ ] **Step 1: Create the route file**

`apps/web/src/app/routes/_portal.beneficios.tsx`:

- `createFileRoute("/_portal/beneficios")`
- `beforeLoad`: `requirePortalAccess(context.principal, "read", "Billing")`
- `loader`: `Promise.all([ensureQueryData(benefitPolicyQuery), ensureQueryData(benefitAssignmentsQuery), ensureQueryData(plansQuery)])`
- `component`: `lazyRouteComponent(() => import("@/features/benefits/benefits-page"), "BenefitsPage")`
- `head`: `{ meta: [{ title: "Benefícios · Offboard" }] }`

- [ ] **Step 2: Create the page component**

`apps/web/src/features/benefits/benefits-page.tsx`:

The page uses `ListPage` with metrics:

- "Custo mensal" = `formatCents(costSummary.totalCents)` (tone: warning)
- "Atribuições ativas" = assignments.length (tone: success)
- "Duração padrão" = `${policy.benefitDurationMonths} meses` (tone: primary)
- "Plano padrão" = defaultPlan?.name ?? "Nenhum" (tone: primary)

Three sections in a grid:

**Section A — Policy config form** (card):

- Uses `@tanstack/react-form` with `benefitPolicySchema` as validator
- Default plan: `PortalFilter` with plan options + "Nenhum" (null)
- Duration: `PortalFilter` with `durationOptions`
- Rules list: reuses the checklist condition pattern — each rule row has field select, operator select, value input (free text for `role`/`contains`, department select for `department`+`equals`/`notEquals`), and a **plan select** (which tier this rule assigns)
- Save button calls `useSaveBenefitPolicy` → invalidates both queries on success
- Only shown/editable for `admin` role (check ability `["manage", "Billing"]`); `gestor`/`rh` see it read-only

**Section B — Assignment list** (DataTable):

- Columns: Nome, Plano atribuído, Plano efetivo, Fonte (badge: "Padrão"/"Regra"/"Manual"), Válido até
- "Atribuir benefício" button opens the override dialog
- Each row has an "Alterar" button for the update dialog
- Only `admin` sees action buttons

**Section C — Cost summary** (small card):

- Per-tier breakdown: tier name, count, subtotal
- Total at the bottom

**Override dialog** (Sheet or Dialog):

- Profile select (from assignment list or search)
- Plan select
- Calls `useAssignBenefit` on submit

**Update dialog** (Sheet):

- Shows profile name (read-only)
- Plan select
- Calls `useUpdateAssignment` on submit

- [ ] **Step 3: Add sidebar navigation link**

In `apps/web/src/app/portal.tsx`, add to the "Administração" group:

```ts
{
  to: "/beneficios",
  label: "Benefícios",
  subject: "Billing",
  icon: "M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z",
}
```

- [ ] **Step 4: Regenerate the route tree**

Run: `cd apps/web && npx tsr generate`

- [ ] **Step 5: Run the full web test suite**

Run: `cd apps/web && npx vitest run`
Expected: PASS

- [ ] **Step 6: Run the full project CI check**

Run: `pnpm run verify` (or the equivalent lint + typecheck + test command)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/routes/_portal.beneficios.tsx apps/web/src/features/benefits/benefits-page.tsx apps/web/src/app/portal.tsx apps/web/src/app/routeTree.gen.ts
git commit -m "feat(web): benefits page with policy config, assignments table, and cost summary"
```

---
