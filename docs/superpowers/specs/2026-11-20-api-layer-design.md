# API Layer — Hono Serverless Routes

## Intent

Expose `@offboard/db` repositories as REST endpoints so the Vite SPA can replace fixture data with real Postgres queries.

## Why

The SPA is a plain Vite build — it cannot talk to Postgres directly. A thin API layer translates HTTP requests into repository calls.

## Goals

- One REST endpoint per repository operation.
- CORS configured for the frontend origin.
- Deployed as a single Vercel serverless function.
- 100% test coverage with real SQL (Hono test client + PGlite).

## Non-goals

- Authentication/authorization (future work).
- Rate limiting (future work).
- Response caching (future work).

## Anti-goals

- Business logic in the API layer. Routes are pass-through to repositories.
- Custom error handling beyond HTTP status codes.

## Constraints

- Stacked PR on top of Phase 1 (`worktree-feat+packages-db`).
- 100% test coverage on new code.
- CI workflow unchanged.
- English in code and PRs; Portuguese in UI copy.

## Approach

Hono with `@hono/node-server` for local dev and Vercel serverless adapter for deployment. Single entry point at `apps/api/src/index.ts` that creates the Hono app, wires repositories via `createRepositories(createClient(DATABASE_URL))`, and mounts route groups.

Alternatives considered and rejected:

- Express: heavier, no built-in test client, no native Vercel adapter.
- tRPC: type-safe but adds complexity; the frontend uses TanStack Query directly, not a tRPC client.
- Edge Functions alongside Vite: rejected in Phase 1 — no clear home for the repository layer.

## Routes

| Method | Path                        | Repository call                        |
| ------ | --------------------------- | -------------------------------------- |
| GET    | /offboardings               | offboardings.list()                    |
| GET    | /offboardings/:id           | offboardings.get(id)                   |
| POST   | /offboardings               | offboardings.create(body)              |
| POST   | /offboardings/bulk          | offboardings.createMany(body)          |
| DELETE | /offboardings/:id           | offboardings.delete(id)                |
| GET    | /offboardings/:caseId/tasks | tasks.listByCase(caseId)               |
| POST   | /offboardings/:caseId/tasks | tasks.create(caseId, body)             |
| PATCH  | /tasks/:id/status           | tasks.updateStatus(id, body.status)    |
| GET    | /equipment                  | equipment.list(query.status?)          |
| GET    | /integrations               | integrations.list(query.status?)       |
| GET    | /access/beneficiaries       | access.listBeneficiaries()             |
| GET    | /access/team-members        | access.listTeamMembers()               |
| GET    | /billing/plans              | billing.listPlans()                    |
| GET    | /checklist                  | checklist.list()                       |
| PATCH  | /checklist/:id              | checklist.setEnabled(id, body.enabled) |

## What's left to the builder

- Input validation strategy (Zod, Valibot, or manual).
- Error response shape.
- Vercel config (`vercel.json` or `apps/api/vercel.json`).
- Whether to split routes into separate files or keep one file.
