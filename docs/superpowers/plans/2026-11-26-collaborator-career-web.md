# Collaborator Career Web Implementation Plan (PR B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Carreira tab of the collaborator app (`https://app.off-board.xyz/colaborador`, `apps/web/src/app/employee.tsx`, `features/employee/career.tsx`) runs on the real talent API. It covers the résumé upload with score and suggestions, the ranked job catalog, "Candidatar com IA" with review, a live rehearsal and the screenshot, and the real applications.

**Architecture:** New query and mutation helpers go in `apps/web/src/entities/career/` and use the Eden client (`getApiClient().api.me…`), sending the same collaborator headers that `entities/employee` sends (the grant header). The UI lives in `apps/web/src/features/employee/career/` and replaces the local-state prototype parts of `career.tsx`. Routing stays the same (`?tela=carreira&carreira=vagas|candidaturas|curriculo`).

**Tech Stack:** TanStack Start/Router/Query/Form, the existing shadcn UI kit (`@/shared/ui`), Eden treaty (`@offboard/api-client`), pt-BR copy in the tone of the existing collaborator screens.

**Spec:** `docs/superpowers/specs/2026-11-26-collaborator-career-design.md`.

## Global Constraints

- Zero code comments. Follow the existing web conventions: entities, features, shared/ui, query options, `useSuspenseQuery` where the screen already uses it. No new UI library.
- Every call goes to `/api/me/*` with the collaborator session and the grant header, the same way `entities/employee` builds its requests.
- **Errors:** handle 401/412 like `EmployeeAccessChanged`. A 403 `{ error: "AI Apply not available" }` shows "Disponível no plano Platinum Premium da sua empresa". 429 shows "Limite diário de uso da IA atingido". 503 shows "Recurso indisponível no momento".
- **Résumé:**
  - `POST /api/me/resume` (multipart PDF/DOCX), then `GET /api/me/resume` and `GET /api/me/resume/score` for the score and suggestions (check the exact routes in `apps/api/src/features/resumes/routes.ts`).
  - Suggestions are applied with the existing apply route.
  - This replaces the local résumé form on the Currículo view.
- **Vagas:** `GET /api/me/jobs` (paginated, `workModel` filter, `match` with score and reasons, `fitsPreferences`, `applied`). A job dialog shows the description, the match reasons and the actions: "Abrir vaga" (the URL), "Candidatar com IA" (Greenhouse jobs only, when `GET /me` `aiApply.available`), and "Já me candidatei" (`POST /api/me/jobs/:jobId/apply`).
- **Candidatar com IA:**
  1. If `aiApply.consented` is false, show a consent step that calls `PUT /api/me/ai-apply/consent { accept: true }`. Its text says the data is sent to the employer through Browserbase (USA).
  2. `POST /api/me/jobs/:jobId/ai-apply` gives the draft.
  3. Review form: one control per question by field type (text/textarea, single select, multi-select checkboxes). Each answer shows its source and an "inferido pela IA" badge. Sensitive or not-shared blanks are marked for the person to answer. File questions show "Currículo"/"Carta" as info.
  4. A toggle between "Ensaio (não envia)", the default, and "Enviar candidatura".
  5. `POST /api/me/ai-applications/:id/confirm { answers, rehearsal }`.
  6. `POST /api/me/ai-applications/:id/run`. While it runs, poll `GET /api/me/ai-applications/:id` every 2 s and show `liveUrl` in an iframe with `pointer-events: none` (read-only), with the label "Navegador ao vivo".
  7. When the state is final, show the result and the screenshot (`GET /api/me/ai-applications/:id/screenshot`) plus the evidence (fields sent). A `needs_check` state shows the "Foi enviada?" yes/no buttons (`POST …/check`).
- **Candidaturas:** `GET /api/me/applications` (real ones, with channel `ai_apply` marked "via IA") and `GET /api/me/ai-applications` (attempts, with states in pt-BR). This replaces the local-state list.
- The parts of the prototype that are not career-API-backed (interviews from the local state, version labels) are removed from Carreira only where the API replaces them. Nothing outside the Carreira tab changes.
- **Gates:** `npm run lint -- --force`, `npm run format:check`, `npm run build -w @offboard/web`, and root `npm test` stays green with `TEST_DATABASE_URL=postgres://offboard:offboard@127.0.0.1:5432/offboard_talent_test`. Web unit tests are added for pure helpers (state labels, answer-form mapping), and the web coverage include list is extended to those helper files at 100%.

## Review Focus

1. A not-shared or sensitive question must never be pre-filled in the form from anything but the draft's own value.
2. The live-view iframe must not be interactive, and it disappears when the state leaves `running`/`submitting`.
3. A real send ("Enviar candidatura") needs an explicit second confirmation dialog.
4. Errors (402/403/409/429/503) show a clear pt-BR message, never a blank screen.
5. A collaborator without a résumé lands on the Currículo upload with an explanation.

---

### Task 1: Career entity and résumé

**Files:**

- Create: `apps/web/src/entities/career/index.ts`
- Create: `apps/web/src/features/employee/career/resume.tsx`
- Modify: `features/employee/career.tsx` and `app/employee.tsx`, only where the Currículo view is wired
- Helper tests

- [ ] Steps: implement, gates, then commit `feat(web): read and score the collaborator résumé through the career API`.

### Task 2: Vagas and Candidaturas

**Files:**

- Create: `features/employee/career/jobs.tsx`
- Create: `features/employee/career/applications.tsx`
- Modify: wiring
- Helper tests

- [ ] Steps: implement, gates, then commit `feat(web): list ranked jobs and real applications in Carreira`.

### Task 3: Candidatar com IA

**Files:**

- Create: `features/employee/career/ai-apply.tsx` (consent, review form, confirm, run, live view, result)
- Create: `features/employee/career/ai-apply-form.ts` (pure mapping plus tests)

- [ ] Steps: implement, gates, then commit `feat(web): apply with AI from Carreira with a live rehearsal`.

### Delivery

- [ ] Push `feat/collaborator-career-web` and open a PR against `main`, after the API PR merges. Include screenshots of each view and of the live rehearsal in the body.
