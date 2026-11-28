# Offboard

HR platform for employee offboarding, career transition, and benefit management.

## Stack

| Layer                | Technology                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| API                  | [Elysia](https://elysiajs.com) on Node.js (local) / Cloudflare Workers (prod) |
| Web                  | [TanStack Start](https://tanstack.com/start) + React + Tailwind CSS           |
| Database             | PostgreSQL 16 with [pgvector](https://github.com/pgvector/pgvector)           |
| ORM / Migrations     | [Drizzle](https://orm.drizzle.team)                                           |
| Monorepo             | npm workspaces + [Turborepo](https://turbo.build)                             |
| Linting / Formatting | [oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs)                            |
| Git hooks            | [Lefthook](https://github.com/evilmartians/lefthook)                          |
| Tests                | [Vitest](https://vitest.dev)                                                  |
| AI                   | Anthropic Claude (résumé analysis, job matching, AI Apply)                    |
| Payments             | [AbacatePay](https://abacatepay.com) (co-pay billing)                         |
| Email                | [Resend](https://resend.com) (local) / Cloudflare Email Workers (prod)        |

## Workspaces

```
apps/
  api          Elysia API server + Cloudflare Worker entry
  web          TanStack Start SSR app (HR portal + collaborator app)

packages/
  db           Drizzle schema, migrations, seed
  api-client   Generated Eden Treaty client
  access       Shared access-control helpers
  employee     Employee plan sync logic
  ui           Shared UI components
```

## Prerequisites

- **Node.js >= 22.18** (see `engines` in `package.json`)
- **PostgreSQL 16** with the **pgvector** extension
- **npm 10.9+** (ships with Node 22)

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd offboard
npm ci

# 2. Create the database
createdb offboard
psql offboard -c 'CREATE EXTENSION IF NOT EXISTS vector;'

# 3. Set environment variables (see below)
cp .env.example .env   # or create manually

# 4. Run migrations
npm run migrate -w @offboard/db

# 5. Seed demo data
npm run seed -w @offboard/db

# 6. Start dev
npm run dev
```

This starts the API on `http://localhost:3001` and the web app on `http://localhost:5173`.

## Environment Variables

Create a `.env` file at the repo root (it is gitignored).

### Required

| Variable             | Description                                                                           |
| -------------------- | ------------------------------------------------------------------------------------- |
| `POSTGRES_URL`       | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/offboard`   |
| `BETTER_AUTH_SECRET` | Random string (>= 32 chars) for session signing. Generate with `openssl rand -hex 32` |

### Optional (features degrade gracefully without these)

| Variable             | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | Enables AI features (résumé analysis, job matching, AI Apply)    |
| `RESEND_API_KEY`     | Enables email sending (sign-in links, invites, notifications)    |
| `AUTH_EMAIL_FROM`    | Sender address for auth emails (e.g. `noreply@your-domain.com`)  |
| `RESUME_STORAGE_DIR` | Local directory for résumé file storage (dev only; prod uses R2) |

The remaining secrets (`ABACATEPAY_API_KEY`, `BROWSERBASE_API_KEY`, `SLACK_SIGNING_SECRET`, `TURNSTILE_*`, `TRACKING_*`, etc.) are only needed in production or for specific integrations. See `apps/api/src/server.ts` for the full list.

## Commands

| Command                            | Description                                      |
| ---------------------------------- | ------------------------------------------------ |
| `npm run dev`                      | Start API + web in dev mode                      |
| `npm test`                         | Run all tests across workspaces                  |
| `npm run lint`                     | Type-check + oxlint across workspaces            |
| `npm run format`                   | Auto-format with oxfmt                           |
| `npm run format:check`             | Check formatting (CI)                            |
| `npm run build`                    | Build all workspaces                             |
| `npm run migrate -w @offboard/db`  | Apply pending migrations                         |
| `npm run generate -w @offboard/db` | Generate a new migration from schema changes     |
| `npm run seed -w @offboard/db`     | Seed the database with demo data                 |
| `npm run scenario -- <name>`       | Run an end-to-end scenario against the local API |

## Database

The project uses PostgreSQL 16 with pgvector for embedding-based search. Drizzle manages the schema and migrations.

**Migrations** live in `packages/db/drizzle/` and are applied in journal order. To create a new migration after changing the schema files in `packages/db/src/schema/`:

```bash
npm run generate -w @offboard/db
npm run migrate -w @offboard/db
```

**Seed** populates the database with a demo organization, plans, users, and sample offboarding cases. It is idempotent.

## Testing

```bash
# All tests
npm test

# Single workspace
npm test -w @offboard/api
npm test -w @offboard/web
npm test -w @offboard/db

# Watch mode
npx vitest -w @offboard/api
```

Tests run against a real PostgreSQL database. Set `DATABASE_URL` (or `TEST_DATABASE_URL`) to a test database — the CI workflow uses `pgvector/pgvector:pg16` as a service container.

## Production

The API runs as a Cloudflare Worker. The web app is a Cloudflare Pages deployment. Pushes to `main` auto-deploy when configured.

Additional production bindings (set as Worker secrets):

| Binding      | Description                                  |
| ------------ | -------------------------------------------- |
| `HYPERDRIVE` | Cloudflare Hyperdrive for connection pooling |
| `RESUMES`    | R2 bucket for résumé storage                 |
| `AI`         | Workers AI binding for embeddings            |
| `EMAIL`      | Cloudflare Email Workers binding             |

## License

Proprietary — all rights reserved.
