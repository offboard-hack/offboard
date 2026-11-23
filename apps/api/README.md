# Offboard API

## Project structure

`apps/api/src/app.ts` composes Elysia. Each directory under
`apps/api/src/features` owns its routes, validation, services, and repositories.
The local Node and Vercel entry points use the same composition. That
composition passes each route plugin its own repository and injects the
action dispatcher used by offboarding. Shared request and response
contracts live under `apps/api/src/shared`.

Run `npm run lint` to check imports between workspaces, API features,
and frontend layers.

`packages/db` owns the Drizzle schema, relations, database connection,
migrations, and development seeds. The API imports these primitives and
keeps feature queries in its own repositories.

The web app calls the API through Eden using `@offboard/api-client`.
Eden derives the contract from the composed Elysia `App` type. A response
alias can use `Treaty.Data<ApiClient["api"]["team"]["get"]>`. A mutation body
can use `Parameters<ApiClient["api"]["team"]["post"]>[0]`. Web code creates
the client through `getApiClient()`, which forwards session cookies on
server renders and uses the browser origin on the client.

## Run locally

From the repository root, run `npm install` and start PostgreSQL with
`docker compose up -d postgres`. Set `DATABASE_URL` and `POSTGRES_URL` to
`postgresql://offboard:offboard@127.0.0.1:5432/offboard`.

Run `npm run migrate -w @offboard/db` to apply the database migrations.
For a disposable development database, `npm run seed -w @offboard/db` loads
sample cases and replaces the team roster. Add a team row for an email
address you control before requesting a link.

Set the auth variables below, then run `npm run dev` to start the API and
the portal. To run only the API, use `npm run dev -w @offboard/api`. The
public health endpoint at `http://127.0.0.1:3001/api/health` returns
`{"status":"ok"}`.

| Variable               | Value                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_HOST`             | Local listener address. Defaults to `127.0.0.1`.                                                                                                                                                    |
| `API_PORT`             | Local listener port. Defaults to `3001`.                                                                                                                                                            |
| `API_URL`              | API origin for the web server and Vite proxy. Locally defaults to `http://localhost:3001`.                                                                                                          |
| `POSTGRES_URL`         | API database connection string.                                                                                                                                                                     |
| `DATABASE_URL`         | Database connection string for Drizzle migrations and seed.                                                                                                                                         |
| `BETTER_AUTH_URL`      | Browser-facing portal origin. Locally defaults to `WEB_ORIGIN` or `http://localhost:5173`. Vercel previews can use the default deployment URL. Set the canonical HTTPS portal origin in production. |
| `BETTER_AUTH_SECRET`   | At least 32 characters. Generate a random secret for each environment.                                                                                                                              |
| `EMAIL_PROVIDER`       | `resend` by default, or `cloudflare` when deploying to Workers with the `EMAIL` binding.                                                                                                            |
| `AUTH_EMAIL_FROM`      | Sign-in sender on a domain verified by the selected provider. Use a bare email address for Cloudflare.                                                                                              |
| `RESEND_API_KEY`       | Resend API key. Required only for the Resend provider.                                                                                                                                              |
| `CRON_SECRET`          | Bearer secret for `/api/correios/check`. Vercel Cron sends this automatically.                                                                                                                      |
| `WEBHOOK_SECRET`       | Bearer secret for `/api/webhooks/inbound/:taskId`.                                                                                                                                                  |
| `SLACK_SIGNING_SECRET` | Slack app signing secret for `/api/integrations/slack/events`.                                                                                                                                      |

## Grant and revoke access

For a new environment, insert the first administrator in `team_members`
with their real email and the `admin` role. They can then add invited
addresses under **Equipe**. Invitees enter their address at `/entrar` to
request a one-time link. A link expires after ten minutes.

| Role                        | Access                                                                |
| --------------------------- | --------------------------------------------------------------------- |
| `admin`                     | All portal workflows, including team access and integration settings. |
| `rh`                        | Read, create, and import offboardings. Update cases and tasks.        |
| `gestor` and `visualizador` | Read offboardings and tasks.                                          |

Remove a member in **Equipe** to revoke access. Elysia checks the current
roster on every protected request. Adding the same email again creates a
new invitation and requires a fresh link.

## Prepare a Vercel preview

Use a dedicated preview database and apply the checked-in migrations before
deploying. Configure the database and auth variables for Preview, and add
test recipients to its roster. If Deployment Protection is enabled, expose
Vercel's `VERCEL_AUTOMATION_BYPASS_SECRET` to the server so its internal
API requests reach the protected deployment. Visit the preview origin used by
`BETTER_AUTH_URL`, or the deployment URL when the variable is unset.

Vercel builds the API bundle with `npm run build:vercel -w @offboard/api` and
routes `/api/auth/*` and `/api/session` to Elysia. TanStack Start forwards
the incoming session cookie for SSR API calls.

## Deploy a Cloudflare preview

Run `npx cf auth login` from the repository root and select the account for
the test deployment. Run `npm run deploy:cloudflare -w @offboard/web` to
publish the login screen and get the `workers.dev` URL. TanStack Start serves
the portal and routes `/api/*` to Elysia within the same Worker.

To enable login and data access, migrate a disposable PostgreSQL database the
Worker can reach and add a test administrator to its roster. Set
`BETTER_AUTH_URL` (the HTTPS preview origin), a generated
`BETTER_AUTH_SECRET`, and `AUTH_EMAIL_FROM` in a private secrets file outside
the repository. To use Hyperdrive, create a configuration pointing to the
direct PostgreSQL endpoint, disable query caching, and set
`OFFBOARD_HYPERDRIVE_ID` when building or deploying the Worker. For a direct
connection, include `POSTGRES_URL` in the secrets file.

For Resend, add `RESEND_API_KEY` to the file and use the default provider:

```sh
OFFBOARD_API_CONFIGURED=1 npm run deploy:cloudflare -w @offboard/web -- --secrets-file /path/to/preview-secrets.env
```

For Cloudflare Email, onboard the sender domain in Cloudflare Email Service
and use a bare address on that domain as `AUTH_EMAIL_FROM`. Set
`EMAIL_PROVIDER=cloudflare` for the deploy so it adds the native `EMAIL`
binding:

```sh
EMAIL_PROVIDER=cloudflare OFFBOARD_API_CONFIGURED=1 npm run deploy:cloudflare -w @offboard/web -- --secrets-file /path/to/preview-secrets.env
```

Include `WEBHOOK_SECRET` and `SLACK_SIGNING_SECRET` in that file if you plan to
test the corresponding integrations. To enable the Correios schedule, include
`CRON_SECRET` and set `OFFBOARD_ENABLE_CRON=1` for the build and deploy. The
trigger runs daily at 08:00 UTC. Use one scheduler per database.

For a local Worker preview, put the test bindings in
`apps/web/.dev.vars.cloudflare` and set `BETTER_AUTH_URL` to
`http://127.0.0.1:8788`. Build with `OFFBOARD_API_CONFIGURED=1` and the
provider you want to test:

```sh
OFFBOARD_API_CONFIGURED=1 npm run build:cloudflare -w @offboard/web
npm run start -w @offboard/web -- --mode cloudflare --host 127.0.0.1 --port 8788
```

With `EMAIL_PROVIDER=cloudflare`, the local runtime captures messages under
Email Sending in Local Explorer at `http://127.0.0.1:8788/cdn-cgi/local/explorer`.
