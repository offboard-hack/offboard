# Collaborator Career API Implementation Plan (PR A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the collaborator's existing session use every `/me/*` talent route. Let the person trigger an AI application run immediately and watch it live. Use the Anthropic API directly when no AI Gateway key is configured.

**Architecture:**

- **Session bridge:** the `talent` macro (`apps/api/src/shared/talent-access.ts`) also accepts collaborator (employee) sessions, resolved through `PortalAuth.resolveEmployee`. The first such request creates the case's talent profile.
- **Run now:** a new route runs the attempt's `ai_apply` job in the request, as a targeted drain.
- **Live view:** the runner stores the Browserbase live-view URL on the attempt while it runs.
- **AI provider:** `shared/ai.ts` gains an Anthropic model factory, chosen by config.

**Tech Stack:** Elysia 1.4, Drizzle 0.45, AI SDK 7 (`@ai-sdk/anthropic` new), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-collaborator-career-design.md`.

## Global Constraints

- 100% coverage in `apps/api` and `packages/db`; zero code comments; English commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Lint forbids explicit return types, `as` casts, `(x: unknown)` params (except `cause`), test-double libraries and cross-feature imports. App-side `new Date()` timestamps. `.github/workflows` untouched.
- **Collaborator bridge:**
  - A request whose principal is not a talent session but whose `resolveEmployee(headers)` returns a principal `{ id, caseId, grantId, name, email }` resolves to the talent profile with `case_id = caseId`. If none exists, one is created, with:
    - `org_id`: from `offboarding_cases`, read via `@offboard/db/schema`;
    - `personal_email`: `email`;
    - `name`: `name`;
    - `sponsored_until`: the São Paulo date of now;
    - `terms_accepted_at` and `first_signed_in_at`: now.
  - Races resolve through the unique `case_id` (insert … on conflict do nothing, then select).
  - If another profile already holds that email for a different case, answer 403 `{ error: "Forbidden" }`.
  - A collaborator-resolved request is always **active**, whatever the subscription or `sponsored_until`. Its entitlement is `{ kind: "sponsored", until: null }` (widen the type if needed).
  - Writes keep the same-origin check.
  - Talent magic-link sessions keep working unchanged.
  - Portal member sessions stay 403.
- **Run now:** `POST /me/ai-applications/:id/run`, with the full AI Apply gate:
  - If the attempt is `queued`, run its `ai_apply` job in the request with a targeted drain (`target: { kind: "ai_apply", subject: id }`, limit 1, budget 210 s), then return 200 with the attempt view.
  - If the job is already claimed elsewhere, or the attempt isn't `queued`, return 202 with the current view.
  - Foreign or malformed id → 404 `{ error: "Attempt not found" }`.
- **Live view:**
  - Migration `0014_add_ai_application_live_url.sql` adds `ai_applications.live_url varchar(2048) null`. Journal `idx: 14`, `when` later than 0013's, snapshot chained from 0013.
  - After `createSession`, the runner calls `GET https://api.browserbase.com/v1/sessions/{id}/debug` and stores `debuggerFullscreenUrl` (with `&navbar=false` appended) in `live_url`. A failure there is ignored: the run continues without a live URL.
  - `live_url` is cleared (null) by every terminal write.
  - The attempt view exposes `liveUrl` only while the state is `running` or `submitting`; otherwise it is null.
- **AI provider:**
  - `anthropicModel(apiKey: string, modelId = "claude-sonnet-5-5")` via `@ai-sdk/anthropic`.
  - Runtimes use `AI_GATEWAY_API_KEY` when set, else `ANTHROPIC_API_KEY`, else AI off.
  - `apps/web/cloudflare.config.ts`: `OFFBOARD_AI_CONFIGURED === "anthropic"` binds the `ANTHROPIC_API_KEY` secret; `"1"` keeps binding `AI_GATEWAY_API_KEY`.
  - README env rows.
- `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test` only.

## Review Focus

1. **A collaborator from org A reaching org B's data, or another case's profile.** Task 1 test: `isolates collaborators by case`.
2. **Two first requests at once** must create one profile, not fail. Task 1 test: `creates the profile once`.
3. **The live URL leaking** to anyone but the owner, or after the run ends. Task 2 test: `shows the live view only while running`.
4. **Run now while the cron already claimed the job** must give one run, not two. Task 2 test: `runs once when the cron got there first`.
5. **A member (portal) session** on `/me/*` stays 403, and a collaborator session on portal routes stays 403. Task 1 test.

---

### Task 1: Collaborator identity bridge

**Files:**

- `apps/api/src/shared/talent-access.ts`
- the talent repository (find-or-create by case)
- `apps/api/src/shared/entitlement.ts` (type)
- `apps/api/src/app.ts` (wiring `resolveEmployee`)
- tests in `shared/talent-access.test.ts` and `app.test.ts`

**Interfaces:** the talent repository gains `ensureForCollaborator(principal: { caseId: string; name: string; email: string }, now: Date)` → `TalentProfile | "email_taken"`.

- [ ] Steps: failing tests:
  - a collaborator session reaches `GET /me`, `GET /me/jobs` and `GET /me/applications`, and the profile is created once with the case's org;
  - concurrent first requests give one profile;
  - an email held by another case's profile → 403;
  - the collaborator is active even with no subscription and an old `sponsored_until`;
  - a member session gets 403 on `/me`;
  - a collaborator session gets 403 on a portal route;
  - writes from another origin get 403.

  Then implement → gates → commit `feat(api): let collaborators use the career routes with their session`.

---

### Task 2: Run now and live view

**Files:**

- `packages/db/src/schema/index.ts` and migration 0014 (+ snapshot, journal)
- `features/ai-apply/{routes,repository,view,runner}.ts`
- `features/ai-apply/browser/browserbase.ts` (`liveUrl(sessionId)`)
- `features/background/*` if the targeted drain needs an export
- tests

- [ ] Steps: failing tests:
  - `shows the live view only while running`: the URL is set after session creation, cleared on every terminal state, and never returned for another person's attempt;
  - a debug-endpoint failure still runs;
  - run now on a queued rehearsal → 200 with state `rehearsed`;
  - `runs once when the cron got there first` → 202 and one session;
  - a non-queued attempt → 202;
  - gate 403/503;
  - 404s.

  Then implement → gates (cross-check 0014 with `npx drizzle-kit export`) → commit `feat(api): run AI applications on demand and expose the live view`.

---

### Task 3: Anthropic provider

**Files:** `apps/api/src/shared/ai.ts` (+ test), `apps/api/package.json` (`@ai-sdk/anthropic`, the version matching the installed `ai` major), `worker.ts`, `server.ts`, `vercel.ts`, `apps/web/cloudflare.config.ts`, `apps/api/README.md`.

- [ ] Steps: failing tests (the provider choice: gateway first, then Anthropic, then none; the factory builds the model id `claude-sonnet-5-5`) → implement → full verification `npm test && npm run lint -- --force && npm run format:check && npm run build -w @offboard/web` → commit `feat(api): call Anthropic directly when no gateway key is set`.

---

### Task 4: Top plan instead of the allowlist

Samuel, 2026-11-26: AI Apply goes to whoever has the top plan, not an allowlist.

**Files:** `apps/api/src/shared/ai-apply-access.ts` (+ test), the AI Apply gate in `features/ai-apply/routes.ts`, `GET /me` `aiApply.available` in `features/talent/routes.ts`, the runner's run-time gate re-check (`features/ai-apply/runner.ts`), `app.ts`, `worker.ts`, `server.ts`, `vercel.ts`, `apps/web/cloudflare.config.ts` (stop binding `AI_APPLY_ALLOWLIST`), `apps/api/README.md`.

**Interfaces:**

- `topPlanSlug = "platinum-premium"`.
- `aiApplyAccess(profile: { aiApplyConsentAt: string | null }, plan: { slug: string; status: string } | null)` returns `"allowed"` only when consent is given **and** the profile's org has an `active` or `trialing` subscription to `topPlanSlug`. The plan is read via `@offboard/db/schema` (`subscriptions` joined to `plans` by the profile's `org_id`).
- The allowlist, `parseAllowlist` and every `AI_APPLY_ALLOWLIST` reference are removed.
- A run-time re-check failure cancels with reason `not_allowed` (unchanged).

- [ ] Steps: failing tests:
  - top-plan org plus consent → allowed;
  - Gold org → 403 `{ error: "AI Apply not available" }`;
  - canceled top-plan subscription → 403;
  - no consent → 403;
  - a collaborator in a top-plan org → allowed;
  - the runner cancels a queued attempt when the org dropped from the top plan.

  Then implement → gates → commit `feat(api): offer AI Apply to the top plan instead of an allowlist`.

---

### Delivery

- [ ] Apply 0014 to production (with Samuel's OK), then push `feat/collaborator-career-api` and open a PR against `main`. The body notes: the collaborator session now reaches `/me/*`; profiles are created on first use; migration 0014; run-now and live view; the Anthropic provider.
