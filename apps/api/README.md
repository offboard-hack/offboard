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

For the employee rollout, apply `0010_employee_journey` to the production
database before setting `OFFBOARD_EMPLOYEE_SCHEMA_READY=1` in GitHub Actions
variables and the Vercel production environment. The migration preserves RH
sessions and requires collaborators with legacy sessions to sign in again.
The updated web and mobile clients send the grant identifier with employee
requests.
For the checklist and equipment rollout, apply `0012_connect_employee_workflows`
to production before deploying the code that uses it.
For the talent app rollout, apply `0013_add_talent_app` to production before
merging, since every session lookup reads `auth_session.talent_profile_id`.
First confirm `SELECT count(*) FROM auth_session WHERE num_nonnulls(member_id,
employee_case_id) <> 1;` returns 0, or the widened audience check fails.
For the AI Apply live view, apply `0014_add_ai_application_live_url` to
production before deploying, since every attempt read selects
`ai_applications.live_url`.
For people search, apply `0019_add_resume_profile_embeddings` to production
before deploying, since every résumé insert names
`resumes.profile_embedding`. Drizzle skips a migration whose journal `when`
is not later than the last applied one, and `0018` carries a future timestamp,
so keep new journal entries after `1795740000013`.
AI Apply is offered only to people who consented and whose company has an
active or trialing `platinum-premium` subscription.
For a disposable development database, `npm run seed -w @offboard/db` loads
sample cases and replaces the team roster. Add a team row for an email
address you control before requesting a sign-in code.

Set the auth variables below, then run `npm run dev` to start the API and
the portal. To run only the API, use `npm run dev -w @offboard/api`. The
public health endpoint at `http://127.0.0.1:3001/api/health` returns
`{"status":"ok"}`.

| Variable                    | Value                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_HOST`                  | Local listener address. Defaults to `127.0.0.1`.                                                                                                                                                    |
| `API_PORT`                  | Local listener port. Defaults to `3001`.                                                                                                                                                            |
| `API_URL`                   | API origin for the web server and Vite proxy. Locally defaults to `http://localhost:3001`.                                                                                                          |
| `POSTGRES_URL`              | API database connection string.                                                                                                                                                                     |
| `DATABASE_URL`              | Database connection string for Drizzle migrations and seed.                                                                                                                                         |
| `BETTER_AUTH_URL`           | Browser-facing portal origin. Locally defaults to `WEB_ORIGIN` or `http://localhost:5173`. Vercel previews can use the default deployment URL. Set the canonical HTTPS portal origin in production. |
| `BETTER_AUTH_SECRET`        | At least 32 characters. Generate a random secret for each environment.                                                                                                                              |
| `EMAIL_PROVIDER`            | `resend` by default, or `cloudflare` when deploying to Workers with the `EMAIL` binding.                                                                                                            |
| `AUTH_EMAIL_FROM`           | Sign-in sender on a domain verified by the selected provider. Use a bare email address for Cloudflare.                                                                                              |
| `RESEND_API_KEY`            | Resend API key. Required only for the Resend provider.                                                                                                                                              |
| `CRON_SECRET`               | Bearer secret for `/api/correios/check`. Vercel Cron sends this automatically.                                                                                                                      |
| `WEBHOOK_SECRET`            | Bearer secret for `/api/webhooks/inbound/:taskId`.                                                                                                                                                  |
| `SLACK_SIGNING_SECRET`      | Slack app signing secret for `/api/integrations/slack/events`.                                                                                                                                      |
| `AI_GATEWAY_API_KEY`        | Optional Vercel AI Gateway key. Enables résumé reading, scoring, tailoring and job matching; without it résumé upload and tailoring return 503.                                                     |
| `ANTHROPIC_API_KEY`         | Optional Anthropic API key for the same AI features when `AI_GATEWAY_API_KEY` is not set.                                                                                                           |
| `BROWSERBASE_API_KEY`       | Optional Browserbase API key, read only by the Worker. AI Apply needs it with `BROWSERBASE_PROJECT_ID`; without both, and always under Node (`server.ts`, Vercel), confirming a draft returns 503.  |
| `BROWSERBASE_PROJECT_ID`    | Optional Browserbase project id, paired with `BROWSERBASE_API_KEY`. Worker only.                                                                                                                    |
| `RESUME_STORAGE_DIR`        | Optional directory for uploaded résumé files in local and Node runs. Without storage, `POST /api/me/resume/upload` returns 503.                                                                     |
| `OFFBOARD_RESUMES_BUCKET`   | Build-time R2 bucket name. Binds `RESUMES` on the Worker; without it, résumé uploads return 503.                                                                                                    |
| `ABACATEPAY_API_KEY`        | AbacatePay API key. Without it `POST /api/billing/checkout` returns 503.                                                                                                                            |
| `ABACATEPAY_WEBHOOK_SECRET` | Secret for `POST /api/billing/webhook`, sent as `?webhookSecret=` or used to verify Standard Webhooks signatures.                                                                                   |
| `PUBLIC_PAGE_ORIGIN`        | Optional origin for public résumé links (`<origin>/p/<slug>`). Defaults to the portal origin.                                                                                                       |

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

## Employee journey

Open a case as an administrator or HR user and use **Área do colaborador**
to set the email allowed to sign in and the details shown in the journey.
The employee enters a six-digit code delivered through the configured email
provider at `/colaborador/entrar` or in the mobile app. Clearing or changing
the email revokes the old employee sessions.

The Elysia API serves the journey to an authenticated employee. Employees can
read it before accepting the terms and acknowledging the privacy policy.
Saving departure or career changes in PostgreSQL requires acceptance. Each
write includes the revision read by the client. Conflicting writes return 409
so the client can refresh the current record. A session for the employee area
cannot access the HR portal.

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
`OFFBOARD_HYPERDRIVE_ID` when building or deploying the Worker. Set
`OFFBOARD_HYPERDRIVE_REGION` to the database's cloud region, such as
`aws:us-east-2` for production, to keep sequential database queries near the
origin. For a direct connection, include `POSTGRES_URL` in the secrets file.

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

Set `OFFBOARD_AI_CONFIGURED=1` for the build to declare the `AI_GATEWAY_API_KEY`
secret (or `OFFBOARD_AI_CONFIGURED=anthropic` for `ANTHROPIC_API_KEY`), and `OFFBOARD_AI_APPLY_CONFIGURED=1` to declare `BROWSERBASE_API_KEY` and
`BROWSERBASE_PROJECT_ID`.

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
