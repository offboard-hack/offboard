# Scenarios and seed coverage

Two ways to fill a local database:

- `npm run seed -w @offboard/db` loads fixed sample rows straight into the tables. It wipes the data, so use it only on a disposable database. Tests use it too.
- `npm run scenario -- <name>` drives the real API over HTTP: sign up, sign in with an emailed code, add people, pay, and so on. It writes no domain rows itself. The only direct database write is the shared catalog (plans, job sources and jobs), which has no API and is loaded with an idempotent upsert that wipes nothing.

Everything uses fictional people and `example.com` addresses. Nothing in the repo holds a token or key.

## Run it

```sh
docker compose up -d postgres
export DATABASE_URL=postgresql://offboard:offboard@127.0.0.1:5432/offboard
export POSTGRES_URL=$DATABASE_URL
npm run migrate -w @offboard/db

BETTER_AUTH_SECRET=$(openssl rand -hex 32) EMAIL_PROVIDER=console npm run dev
```

In another terminal, with the same `DATABASE_URL`:

```sh
npm run scenario -- add-person
```

Options: `--base-url` for the API (default `http://127.0.0.1:3001`) and `--web-origin` for the portal origin the API trusts (default `http://localhost:5173`). Every scenario can be rerun: existing orgs, members and people are reused.

## Signing in locally

`EMAIL_PROVIDER=console` makes the API write every outgoing email to a JSON lines file (`DEV_EMAIL_OUTBOX`, default `offboard-dev-outbox.jsonl` in the system temp directory) and log it. The scenario reads the six-digit code from that file, and you can read it from the API log or the file when you sign in by hand.

The provider is refused when `NODE_ENV=production` or `VERCEL=1`, and the Worker's config only accepts `resend` and `cloudflare`, so it cannot be enabled in production. With it on, the API also trusts `x-forwarded-for` for its sign-in rate limit, so the runner can request many codes in a minute. The per-email limit of 5 codes every 15 minutes still applies.

To sign in by hand as any user a scenario printed: open `/entrar` (HR) or `/colaborador/entrar` (collaborator), enter the email, and copy the code from the API log.

## Scenarios

| Scenario          | What it does                                                                                                                                                  | Log in afterwards                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orgs`            | Three orgs (Aurora Cosméticos on gold, Horizonte Logística on silver, Vale Verde Agro on platinum), each with an admin and HR members in other roles.         | `beatriz.castro@aurora.example.com`, `rafaela.nunes@horizonte.example.com`, `otavio.prado@valeverde.example.com` at `/entrar`. Members: Equipe.                                             |
| `add-person`      | Aurora sets a benefit policy (silver by default, gold for Tecnologia), adds Marina Lopes and Rafael Mendes with an invite, and both sign in as collaborators. | HR: Beneficios and Desligamentos. Collaborators `marina.colaboradora@aurora.example.com` (default silver) and `rafael.colaborador@aurora.example.com` (rule gold) at `/colaborador/entrar`. |
| `company-payment` | Aurora subscribes to a plan and the payment is confirmed. Needs the sandbox keys below.                                                                       | HR: Planos e gastos.                                                                                                                                                                        |
| `career`          | Helena Pires signs in, saves a résumé and preferences, lists jobs, has her company sponsorship set to lapsed, and upgrades to Carreira Pro.                   | `helena.colaboradora@aurora.example.com` at `/colaborador/entrar`, then the Carreira screen.                                                                                                |
| `offboarding`     | Aurora adds Gustavo Ribeiro, every task in his checklist moves to done, and an exit survey is submitted.                                                      | HR: Desligamentos, Painel, Resultados e feedback.                                                                                                                                           |
| `all`             | Runs the five above in order.                                                                                                                                 | All of the above.                                                                                                                                                                           |

Each run prints what it did and a list of `who: email -> where to log in`.

## Payments

Set `ABACATEPAY_API_KEY` (a sandbox key) and `ABACATEPAY_WEBHOOK_SECRET` both on the API and in the shell that runs the scenario. The checkout is created for real in the sandbox and its URL is printed. AbacatePay cannot reach localhost, so the runner confirms by posting a signed `subscription.completed` event to `/api/billing/webhook`. Without the key, the payment steps print `skipped: ABACATEPAY_API_KEY not set` and the rest runs.

The company step calls `POST /api/billing/subscribe`, which ships in a separate change. Until it merges, run with the key unset or the step fails with that route's 404.

## Backoffice

Set `BACKOFFICE_STAFF_EMAILS` on the API to an HR admin address, for example `beatriz.castro@aurora.example.com`, and run `npm run dev -w @offboard/backoffice` in place of the portal (both default to port 5173, the origin the API trusts). Sign in with that address. It shows all three orgs.

## Audit of the `seed` command

| Area                                            | Dev seed                               | Scenarios                                                               |
| ----------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Organizations                                   | Partly: only the default org           | Yes: three orgs through signup                                          |
| Team members, all four roles                    | Yes, default org only                  | Yes, across orgs                                                        |
| Cases, tasks, subtasks                          | Yes                                    | Yes, with the default checklist                                         |
| Collaborator access and invite                  | No                                     | Yes                                                                     |
| Checklist model, action configs                 | Action configs only                    | Not covered (default checklist, no actions)                             |
| Equipment                                       | Yes                                    | Not covered                                                             |
| Exit surveys                                    | Yes                                    | One survey                                                              |
| Integrations                                    | Names and status only, no Slack config | Not covered                                                             |
| Plans                                           | Yes                                    | Yes (catalog)                                                           |
| Company subscription, invoices                  | Yes (gold, active)                     | Yes, with sandbox keys and the subscribe route                          |
| Benefit policy and assignments                  | No                                     | Policy, default and rule assignments. Manual assignments are not driven |
| Talent profiles, preferences, answers           | Yes                                    | Profile and preferences; saved answers not covered                      |
| Résumés, suggestions                            | Yes                                    | Base résumé only; score and suggestions need AI                         |
| Jobs, job sources                               | Yes                                    | Yes (catalog)                                                           |
| Job matches, rejected jobs                      | Yes                                    | No: matches need AI or embeddings                                       |
| Applications, interviews                        | Yes                                    | Not covered                                                             |
| AI Apply drafts and attempts                    | No                                     | Skipped: needs AI and Browserbase                                       |
| Carreira Pro subscription                       | No                                     | Yes, with sandbox keys                                                  |
| Public pages                                    | Yes                                    | Not covered                                                             |
| Collaborator journey state (consent, departure) | No                                     | Not covered                                                             |

Embedding columns stay null everywhere. Nothing here calls an external service, so the app falls back to text search.

## Screens

HR portal: Painel, Desligamentos (list, detail, import), Checklist automatico, Bens e coleta, Equipe, Integracoes, Planos e gastos, Beneficios, Resultados e feedback, Candidaturas assistidas. Collaborator: `/colaborador` (departure and Carreira) and `/colaborador/entrar`. Scenarios populate Painel, Desligamentos, Equipe, Planos e gastos, Beneficios, Resultados e feedback and Carreira. The dev seed also populates Bens e coleta, Integracoes, Candidaturas assistidas and the application, interview and public page views.
