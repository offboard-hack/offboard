# Talent Identity Implementation Plan (PR 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person whose offboarding case HR enabled can sign in to the app with a fixed personal email, accept the terms, and read `GET /api/me` with a sponsored or lapsed entitlement — fully isolated from portal endpoints.

**Architecture:** A new `talent` feature slice owns `talent_profiles`, HR-side access routes and `/api/me` routes. The existing better-auth instance gains a second audience: the sign-in request picks `member` or `talent`, an `AsyncLocalStorage` scope carries that audience into `generateToken`, and the session row stores either `member_id` or `talent_profile_id`. `resolvePrincipal` returns a new `talent` kind that the portal macro rejects and a new talent macro accepts.

**Tech Stack:** Elysia 1.4, better-auth 1.7 (magic link), Drizzle 0.45 + PostgreSQL, Vitest with v8 coverage.

**Spec:** `docs/superpowers/specs/2026-11-24-talent-app-backend-design.md` — sections "Identity and access" and "Delivery order" item 2.

## Global Constraints

- 100% line/branch/function coverage in `apps/api` (`vitest.config.ts` thresholds). No code comments unless a linter demands it; one line max.
- Feature code under `apps/api/src/features/talent/`; schema, migration and seeds under `packages/db`. Cross-feature data (company subscription) is passed in from `app.ts`, never imported from `features/billing`.
- The person's email is fixed. HR can change it only while `first_signed_in_at` is null.
- HR has no disable action. HR sets `sponsored_until` (any date, past allowed) and nothing else.
- Deleting a case sets `talent_profiles.case_id` to null; deleting a profile cascades to its sessions.
- Entitlement this PR: `sponsored` when today (America/Sao_Paulo) ≤ `sponsored_until` and the latest company subscription status is `active` or `trialing`; otherwise `lapsed`. (`individual` arrives in PR 11.)
- Until `terms_accepted_at` is set, only `GET /api/me` and `POST /api/me/terms` answer for a talent session.
- Magic links: 10-minute expiry, single use, hashed storage, email lookups case-insensitive — unchanged.
- Commit messages in English, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests run with `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_test` (create it once with `docker compose up -d` and `createdb`); never point it at the dev database because the seed wipes tables.

## Review Focus

1. **One email that is both a team member and a talent profile.** Portal sign-in must yield the member session and app sign-in the talent session; neither leaks into the other. → Task 3 test `separates audiences for the same email`.
2. **HR corrects the email after the person signed in.** Must be 409; before first sign-in it succeeds and any link already sent to the old address stops working. → Task 5 test `fixes the email only before first sign-in`.
3. **Talent session on any portal route (read and write) and on `/api/session`.** Must be 403; a portal session on `/api/me` must be 403. → Task 5 test `isolates talent and portal sessions`.
4. **Sponsorship boundary at local midnight.** At 23:30 in São Paulo on the `sponsored_until` day (02:30 UTC the next day) the person is still sponsored. → Task 2 test `uses the São Paulo calendar day`.
5. **Company subscription canceled or missing while the person is within `sponsored_until`.** Must be `lapsed`. → Task 2 test `lapses without an active company subscription`.

---

### Task 1: Schema, migration and seed

**Files:**

- Modify: `packages/db/src/schema/index.ts` (add `talentProfiles`, relation from `offboardingCases`)
- Modify: `packages/db/src/schema/auth.ts` (`authSession.memberId` nullable, add `talentProfileId`, check constraint)
- Create: `packages/db/drizzle/0010_add_talent_profiles.sql`, `packages/db/drizzle/meta/0010_snapshot.json`; Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/src/talent-profile.fixture.ts`; Modify: `packages/db/src/seed-database.ts`
- Test: `packages/db/test/database.test.ts`

**Interfaces:**

- Produces: `talentProfiles` table export with columns `id uuid pk`, `caseId uuid null unique → offboarding_cases.id on delete set null`, `personalEmail varchar(255) not null` + unique index on `lower(personal_email)` named `talent_profiles_email_lower_idx`, `name varchar(255) not null`, `sponsoredUntil date not null`, `termsAcceptedAt timestamp null`, `firstSignedInAt timestamp null`, `shareOutcomeWithHr boolean not null default false`, `createdAt`, `updatedAt`.
- Produces: `authSession.memberId` nullable uuid, `authSession.talentProfileId` nullable uuid → `talent_profiles.id on delete cascade`, check `auth_session_one_audience`: `num_nonnulls(member_id, talent_profile_id) = 1`.
- Produces: seed fixture `seedTalentProfiles: { caseName: string; personalEmail: string; name: string; sponsoredForDays: number }[]` with one entry for a seeded case, email `marina.lopes@exemplo.com`, 120 days; `seedDatabase` deletes `talentProfiles` before cases and inserts fixtures with `sponsoredUntil` = today + days. `testSeedFixtures` gets no talent profiles.

- [ ] **Step 1: Write the failing test** in `packages/db/test/database.test.ts`

```ts
it.skipIf(!url)(
  "detaches talent profiles from deleted cases and enforces one session audience",
  async () => {
    // migrate + seedDatabase(db) with default fixtures
    // expect(await db.select().from(talentProfiles)).toHaveLength(seedTalentProfiles.length)
    // delete the profile's case → profile still exists with caseId === null
    // inserting auth_session with both member_id and talent_profile_id null rejects (check violation 23514)
    // inserting a second profile with the same email in different case rejects (23505)
  },
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TEST_DATABASE_URL=… npm test -w @offboard/db`
Expected: FAIL — `talentProfiles` is not exported.

- [ ] **Step 3: Add the schema, generate the migration, add the seed**

Try `npm run generate -w @offboard/db -- --name add_talent_profiles`; if drizzle-kit prompts (no TTY), hand-write the SQL following `0009_add_billing.sql` style, append the journal entry (`idx: 10`, `when: 1795740000005`, `tag: "0010_add_talent_profiles"`), and copy `0009_snapshot.json` to `0010_snapshot.json` updated with the new table and columns. Existing `auth_session` rows all have `member_id`, so the check constraint applies cleanly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=… npm test -w @offboard/db`
Expected: PASS, coverage thresholds met.

- [ ] **Step 5: Commit** — `feat(db): add talent profiles and session audience`

---

### Task 2: Talent repository and entitlement

**Files:**

- Create: `apps/api/src/features/talent/repository.ts`, `apps/api/src/features/talent/entitlement.ts`
- Modify: `apps/api/src/repositories.ts` (add `talent: createTalentRepository(db)`)
- Test: `apps/api/src/features/talent/repository.test.ts`, `apps/api/src/features/talent/entitlement.test.ts`

**Interfaces:**

- Produces in `entitlement.ts`:
  - `type Entitlement = { kind: "sponsored"; until: string } | { kind: "lapsed"; until: null }`
  - `entitlementOf(input: { sponsoredUntil: string; companyActive: boolean; now: Date }): Entitlement`
  - `companySponsors(status: string | null | undefined): boolean` → true only for `"active"` and `"trialing"`.
- Produces in `repository.ts` (`createTalentRepository(db)`), every email lowercased and trimmed on write and compared via `lower()`:
  - `type TalentProfile = { id: string; caseId: string | null; name: string; email: string; sponsoredUntil: string; termsAcceptedAt: string | null; firstSignedInAt: string | null }` (timestamps as ISO strings)
  - `enable(input: { caseId: string; personalEmail: string; sponsoredUntil: string }): Promise<TalentProfile | "case_not_found" | "already_enabled" | "email_taken">` — name copied from the case.
  - `findByCase(caseId: string): Promise<TalentProfile | undefined>`
  - `updateAccess(caseId: string, patch: { personalEmail?: string; sponsoredUntil?: string }): Promise<TalentProfile | "not_found" | "email_locked" | "email_taken">` — `email_locked` when `personalEmail` differs and `firstSignedInAt` is set.
  - `findForSignIn(email: string, id?: string): Promise<{ id: string; name: string } | undefined>`
  - `markSignedIn(id: string): Promise<void>` — sets `firstSignedInAt` only if null.
  - `findById(id: string): Promise<TalentProfile | undefined>`
  - `acceptTerms(id: string): Promise<TalentProfile>` — sets `termsAcceptedAt` only if null.
  - `type TalentRepository = ReturnType<typeof createTalentRepository>`

- [ ] **Step 1: Write the failing tests**

`entitlement.test.ts`:

```ts
it("uses the São Paulo calendar day", () => {
  expect(
    entitlementOf({
      sponsoredUntil: "2026-12-01",
      companyActive: true,
      now: new Date("2026-12-02T02:30:00Z"),
    }),
  ).toEqual({ kind: "sponsored", until: "2026-12-01" });
  expect(
    entitlementOf({
      sponsoredUntil: "2026-12-01",
      companyActive: true,
      now: new Date("2026-12-02T03:30:00Z"),
    }),
  ).toEqual({ kind: "lapsed", until: null });
});
it("lapses without an active company subscription", () => {
  expect(
    entitlementOf({ sponsoredUntil: "2099-01-01", companyActive: false, now: new Date() }),
  ).toEqual({ kind: "lapsed", until: null });
  expect([
    companySponsors("active"),
    companySponsors("trialing"),
    companySponsors("past_due"),
    companySponsors("canceled"),
    companySponsors(null),
  ]).toEqual([true, true, false, false, false]);
});
```

`repository.test.ts` (PostgreSQL, `describe.skipIf(!url)`, seed with `testSeedFixtures`):

- `enable` normalizes `"  Pessoa@Exemplo.COM "` to `pessoa@exemplo.com` and copies the case name; second `enable` on the same case → `"already_enabled"`; same email on another case → `"email_taken"`; unknown case id → `"case_not_found"`.
- `updateAccess` changes email before sign-in; after `markSignedIn` → `"email_locked"`; same email (different case) → `"email_taken"`; `sponsoredUntil` alone still updates after sign-in; unknown case → `"not_found"`.
- `markSignedIn` and `acceptTerms` are idempotent (second call keeps the first timestamp).
- `findForSignIn` matches case-insensitively and returns undefined when the id doesn't match.

- [ ] **Step 2: Run to verify failure** — `TEST_DATABASE_URL=… npx vitest run src/features/talent -w @offboard/api` → FAIL, modules missing.

- [ ] **Step 3: Implement** `entitlement.ts` (today via `Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })`, string compare against `sponsoredUntil`) and `repository.ts` (map unique violations with `uniqueViolation` from `shared/http.ts`; FK violation `23503` on insert → `case_not_found`; unique on `case_id` → `already_enabled`, on email index → `email_taken` — distinguish by `cause.constraint`).

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit** — `feat(api): add talent profile repository and entitlement`

---

### Task 3: Second auth audience

**Files:**

- Modify: `apps/api/src/features/auth/auth.ts`
- Modify: `apps/api/src/shared/portal-auth.ts`
- Modify: `apps/api/src/shared/access.ts`, `apps/api/src/features/auth/routes.ts` (reject `talent` kind)
- Test: `apps/api/src/features/auth/auth.test.ts`

**Interfaces:**

- Consumes: `TalentRepository.findForSignIn`, `markSignedIn`, `findById` (Task 2) — `createAuth` receives `talent: Pick<TalentRepository, "findForSignIn" | "markSignedIn" | "findById">`.
- Produces in `portal-auth.ts`:
  - `type TalentPrincipal = { id: string; name: string; email: string }`
  - `PortalAccess` gains `| { kind: "talent"; profile: TalentPrincipal }`
  - `PortalAuth` gains `inviteTalent(email: string): Promise<void>`
- Produces: audience rule — a `POST /api/auth/sign-in/magic-link` whose JSON `callbackURL` starts with `/app` is the `talent` audience, everything else `member`. Token format `<m|t>.<id|uninvited>.<random>`; `memberLinkToken` becomes a parser returning `{ audience: "member" | "talent"; id: string }`.
- Produces: `inviteTalent` sends the link with `callbackURL: "/app"`, `errorCallbackURL: "/app/entrar"` by calling the internal handler with `origin` set to the auth origin.
- Session hooks: `user.create.before` names the user from the member or profile; `session.create.before` sets `memberId` or `talentProfileId` (session `additionalFields` both `required: false`) and calls `markSignedIn` for talent.
- `resolvePrincipal`: session with `talentProfileId` → `findById` + email match → `{ kind: "talent", profile }`, else `forbidden`. Portal macro and `GET /api/session` answer 403 for `talent`.

- [ ] **Step 1: Write the failing tests** in `auth.test.ts` (reuse its `requestLink`/`verify`/`sessionHeaders` helpers; add a `callbackURL` parameter to `magicLinkRequest`):
  - `signs a talent profile in through the app callback`: enable a profile via `repos.talent.enable`; `requestLink(email, "/app")` delivers; verify redirects to `${origin}/app`; `resolvePrincipal` → `{ kind: "talent", profile: { id, name, email } }`; `findById(id).firstSignedInAt` is set.
  - `separates audiences for the same email`: the same email is a team member and a talent profile; portal link → `kind: "authenticated"`, app link → `kind: "talent"`.
  - `does not send app links to unknown or member-only emails`: `requestLink(memberOnlyEmail, "/app")` delivers nothing and returns the same body as for an unknown email.
  - `revokes the session when the profile email changes or the profile is deleted`: after `db.delete(talentProfiles)` → `forbidden`.
  - `invites a talent profile`: `auth.inviteTalent(email)` delivers a URL whose `callbackURL` is `/app`.
  - Existing member tests keep passing with the new token format.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/features/auth` → FAIL.

- [ ] **Step 3: Implement** the audience scope (`AsyncLocalStorage<"member" | "talent">` module-local in `auth.ts`; `handler` reads `callbackURL` from a cloned request body only for the sign-in path and runs `auth.handler` inside the scope), the token parser, hooks and `resolvePrincipal`. Update the portal macro (`access.kind !== "authenticated"` → 401 for anonymous, else 403) and `/session`.

- [ ] **Step 4: Run to verify pass** — `TEST_DATABASE_URL=… npm test -w @offboard/api` → PASS with 100% coverage (the fake `PortalAuth` in `app.test.ts` gets `inviteTalent` and an `x-test-session: talent` branch returning `{ kind: "talent", profile: { id: <seeded profile id>, … } }`).

- [ ] **Step 5: Commit** — `feat(auth): add talent sign-in audience`

---

### Task 4: Talent access macro

**Files:**

- Create: `apps/api/src/features/talent/access.ts`
- Test: `apps/api/src/features/talent/access.test.ts`

**Interfaces:**

- Consumes: `PortalAuth.resolvePrincipal` (Task 3), `TalentRepository.findById`, `entitlementOf` (Task 2).
- Produces: `talentAccess(deps: { auth: PortalAuth; webOrigin: string; talent: Pick<TalentRepository, "findById">; companyActive: () => Promise<boolean>; now?: () => Date })` → Elysia plugin named `offboard:talent-access` with macro `talent: "signed-in" | "active"` that resolves `{ me: TalentProfile; entitlement: Entitlement }` into the handler context.
- Rules, in order: `cache-control: no-store`; anonymous → 401; any non-`talent` kind → 403; non-GET/HEAD without `origin === webOrigin` → 403; profile missing → 403; mode `"active"` with `termsAcceptedAt === null` → 403 `{ error: "Terms not accepted" }`; mode `"active"` with `lapsed` → 402 `{ error: "Access lapsed" }`.
- `type TalentAccessPlugin = ReturnType<typeof talentAccess>`

- [ ] **Step 1: Write the failing test** — build a test Elysia app with `.use(talentAccess(...))` and two routes (`/signed-in` with `talent: "signed-in"`, `/active` with `talent: "active"`) returning `{ id: me.id, kind: entitlement.kind }`, using a stub `PortalAuth` and stub repo. Assert each rule above with its status code, plus a POST from a foreign origin → 403, and that `/signed-in` answers 200 for a lapsed profile without terms.

- [ ] **Step 2: Run to verify failure** → FAIL, module missing.

- [ ] **Step 3: Implement** with a macro `resolve` that returns `status(...)` to short-circuit (verify Elysia 1.4 short-circuits on a returned status from `resolve`; if not, compute in `beforeHandle` and pass the profile through `resolve`).

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** — `feat(api): add talent access macro`

---

### Task 5: Routes, composition and isolation

**Files:**

- Create: `apps/api/src/features/talent/routes.ts`
- Modify: `apps/api/src/app.ts`, `vercel.json` (rewrites `/api/me` and `/api/me/:path*` to `/api/offboard`)
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: `TalentRepository` (Task 2), `PortalAccessPlugin`, `TalentAccessPlugin` (Task 4), `PortalAuth.inviteTalent` (Task 3).
- Produces `talentRoutes(repos: TalentRepository, access: PortalAccessPlugin, talentAccess: TalentAccessPlugin, inviteTalent: (email: string) => Promise<void>)`:
  - `POST /offboardings/:id/talent-access { personalEmail (email, ≤255), sponsoredUntil (YYYY-MM-DD) }` — `permit: ["update", "Offboarding"]`; 201 `TalentAccess`, 404 case, 409 `already_enabled`/`email_taken`; calls `inviteTalent` after creation.
  - `GET /offboardings/:id/talent-access` — `permit: ["read", "Offboarding"]`; 200 `TalentAccess` or 404.
  - `PATCH /offboardings/:id/talent-access { personalEmail?, sponsoredUntil? }` — `permit: ["update", "Offboarding"]`; 200, 404, 409 (`email_locked`, `email_taken`); re-sends the invite when the email changed.
  - `TalentAccess = { personalEmail: string; sponsoredUntil: string; signedIn: boolean }` — HR never sees terms or anything else.
  - `GET /me` — `talent: "signed-in"`; 200 `{ id, name, email, termsAccepted: boolean, entitlement: { kind: "sponsored" | "lapsed", until: string | null } }`.
  - `POST /me/terms` — `talent: "signed-in"`; 200 same shape with `termsAccepted: true`.
- `app.ts` builds `companyActive = async () => companySponsors((await repos.billing.getSubscription())?.status)` and wires `talentRoutes`.

- [ ] **Step 1: Write the failing tests** in `app.test.ts` (extend the `Payload` type with `personalEmail` and `sponsoredUntil`; seed a profile in the test or via a helper using `repos.talent.enable`):
  - `enables talent access from a case and invites the person`: rh → 201, invite captured by the fake `inviteTalent`; `visualizador` → 403; repeat → 409; missing case → 404; GET returns `{ personalEmail, sponsoredUntil, signedIn: false }`.
  - `fixes the email only before first sign-in`: PATCH email → 200 and a second invite; after `repos.talent.markSignedIn` → 409; PATCH `sponsoredUntil` → 200.
  - `isolates talent and portal sessions`: with `x-test-session: talent`, `GET /team`, `GET /offboardings`, `POST /team`, `GET /session` → 403; with an admin session `GET /me` → 403; anonymous `GET /me` → 401.
  - `serves the profile and records terms`: talent `GET /me` → `termsAccepted: false`, `entitlement.kind` `"sponsored"` when the seeded subscription is active; `POST /me/terms` → `termsAccepted: true`; after setting the subscription to `canceled` → `"lapsed"`.

- [ ] **Step 2: Run to verify failure** → FAIL, routes missing.

- [ ] **Step 3: Implement** `routes.ts` and the composition.

- [ ] **Step 4: Verify the whole workspace**

Run: `TEST_DATABASE_URL=… npm test && npm run lint && npm run format:check && npm run build -w @offboard/web`
Expected: all pass, API coverage 100%.

- [ ] **Step 5: Commit** — `feat(api): expose talent access and /api/me`

---

### Delivery

- [ ] Branch `feat/talent-identity` from `main` after PR #76 merges; rebase on Davi's `codex/offboard-sign-in-email` if it has merged.
- [ ] Push and open the PR. The body names the token-format change: links sent before deploy stop working, and they expire in 10 minutes anyway.
