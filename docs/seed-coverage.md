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

BETTER_AUTH_SECRET=$(openssl rand -hex 32) NODE_ENV=development EMAIL_PROVIDER=console npm run dev
```

In another terminal, with the same `DATABASE_URL`:

```sh
npm run scenario -- add-person
```

The runner refuses to run when `--base-url` or `DATABASE_URL` points to a host other than `127.0.0.1`, `localhost` or `::1`, because it writes the plans and jobs catalog directly; `--allow-remote` overrides that. Options: `--base-url` for the API (default `http://127.0.0.1:3001`) and `--web-origin` for the portal origin the API trusts (default `http://localhost:5173`). Every scenario can be rerun: existing orgs, members and people are reused.

## Signing in locally

`EMAIL_PROVIDER=console` makes the API write every outgoing email to a JSON lines file (`DEV_EMAIL_OUTBOX`, default `offboard-dev-outbox.jsonl` in the system temp directory) and log it. The scenario reads the six-digit code from that file, and you can read it from the API log or the file when you sign in by hand.

The provider is refused unless `NODE_ENV` is `development` or `test` and no `VERCEL` variable is set, and the Worker's config only accepts `resend` and `cloudflare`, so it cannot be enabled in production. With it on, the API also trusts `x-forwarded-for` for its sign-in rate limit, so the runner can request many codes in a minute. The per-email limit of 5 codes every 15 minutes still applies.

To sign in by hand as any user a scenario printed: open `/entrar` (HR) or `/colaborador/entrar` (collaborator), enter the email, and copy the code from the API log.

## Scenarios

| Scenario            | What it does                                                                                                                                                                                                                                                                                                                              | Log in afterwards                                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orgs`              | Three orgs (Aurora Cosméticos on gold, Horizonte Logística on silver, Vale Verde Agro on platinum), each with an admin and HR members in other roles.                                                                                                                                                                                     | `beatriz.castro@aurora.example.com`, `rafaela.nunes@horizonte.example.com`, `otavio.prado@valeverde.example.com` at `/entrar`. Members: Equipe.                                             |
| `add-person`        | Aurora sets a benefit policy (silver by default, gold for Tecnologia), adds Marina Lopes and Rafael Mendes with an invite, and both sign in as collaborators.                                                                                                                                                                             | HR: Beneficios and Desligamentos. Collaborators `marina.colaboradora@aurora.example.com` (default silver) and `rafael.colaborador@aurora.example.com` (rule gold) at `/colaborador/entrar`. |
| `company-payment`   | Horizonte Logística subscribes to its plan and the payment is confirmed. Needs the sandbox keys below.                                                                                                                                                                                                                                    | HR: Planos e gastos.                                                                                                                                                                        |
| `career`            | Helena Pires signs in, saves a résumé and preferences, lists jobs, has her company sponsorship set to lapsed, and upgrades to Carreira Pro. With an AI key it also scores the résumé, runs job matching, applies one suggestion and shows the score change, then drafts an AI Apply attempt.                                              | `helena.colaboradora@aurora.example.com` at `/colaborador/entrar`, then the Carreira screen.                                                                                                |
| `applications`      | Helena applies to four catalog jobs and moves them to different stages: interview (with a scheduled interview), offer, rejected and sent.                                                                                                                                                                                                 | Same login, Carreira, Candidaturas.                                                                                                                                                         |
| `answers`           | Helena saves answers to common questions (one is the sensitive PcD question), shares her gender and keeps disability private, and rejects a job (reason, undo, reject again).                                                                                                                                                             | Same login, Carreira, Preferencias.                                                                                                                                                         |
| `benefits-manual`   | HR overrides Marina Lopes's benefit to platinum, re-saves the policy with another default, Marina opens her career again, and the runner checks the manual benefit is untouched.                                                                                                                                                          | HR: Beneficios.                                                                                                                                                                             |
| `benefit-copay`     | Marina Lopes (silver by default) opens her career, starts the benefit upgrade checkout for the gold tier and the runner confirms the payment with a signed webhook, so her effective plan becomes gold. In `all` it runs after `benefits-manual`, so Marina buys premium. Needs the sandbox keys below; without them the step is skipped. | `marina.colaboradora@aurora.example.com` at `/colaborador/entrar`, then the Carreira screen. HR: Beneficios shows the Coparticipacao badge.                                                 |
| `equipment`         | HR adds three inventory items for Nina Castro, marks one returned, one in transit and one back in inventory.                                                                                                                                                                                                                              | HR: Bens e coleta.                                                                                                                                                                          |
| `integrations`      | HR sets eight integrations that need no credentials (connected, reconnect and disconnected). Slack is skipped: the API verifies the bot token with Slack.                                                                                                                                                                                 | HR: Integracoes.                                                                                                                                                                            |
| `checklist-actions` | HR configures webhook actions for two checklist steps, pointing at a receiver the runner starts on loopback. Completing a task fires the webhook and the runner checks the payload. The actions are left disabled afterwards because the receiver stops with the run.                                                                     | HR: Checklist automatico, Desligamentos (Nina Castro).                                                                                                                                      |
| `offboarding`       | Aurora adds Gustavo Ribeiro, every task in his checklist moves to done, and an exit survey is submitted.                                                                                                                                                                                                                                  | HR: Desligamentos, Painel, Resultados e feedback.                                                                                                                                           |
| `all`               | Runs all of the above in order.                                                                                                                                                                                                                                                                                                           | All of the above.                                                                                                                                                                           |

Each run prints what it did and a list of `who: email -> where to log in`.

## AI mode for `career`

Set `ANTHROPIC_API_KEY` (or `AI_GATEWAY_API_KEY`) on the API and in the shell that runs the scenario. Set `CRON_SECRET` on both too: job matching only runs through `POST /api/background/drain`, which the runner calls with that secret. Without the AI key the steps print `skipped: AI not configured`; without `CRON_SECRET` only matching is skipped. `POST /api/background/drain` is the production cron path, so the first drain also queues the API's default job boards and downloads their real public postings from the internet (hundreds of jobs). If you ran the scenario without the key first, the scoring job from that run waits out its retry backoff, so start AI runs on a fresh database. A run makes two résumé scoring calls and one matching batch, and every rerun that saves the résumé again scores it again.

AI Apply drafts need the company or Carreira Pro entitlement, a job with a readable application form (the catalog jobs have none, so the draft is usually refused and the reason is printed) and, for a run, Browserbase. The rehearsal run itself is not driven by the runner.

## Payments

Set `ABACATEPAY_API_KEY` (a sandbox key) and `ABACATEPAY_WEBHOOK_SECRET` both on the API and in the shell that runs the scenario. The checkout is created for real in the sandbox and its URL is printed. AbacatePay cannot reach localhost, so the runner confirms by posting a signed `subscription.completed` event to `/api/billing/webhook`. Without the key, the payment steps print `skipped: ABACATEPAY_API_KEY not set` and the rest runs.

The company step calls `POST /api/billing/subscription`, reads the issued checkout id from `POST /api/billing/checkout`, and the signed event carries that id, which activation requires.

## Backoffice

Set `BACKOFFICE_STAFF_EMAILS` on the API to an HR admin address, for example `beatriz.castro@aurora.example.com`, and run `npm run dev -w @offboard/backoffice` in place of the portal (both default to port 5173, the origin the API trusts). Sign in with that address. It shows all three orgs.

## Audit of the `seed` command

| Area                                            | Dev seed                               | Scenarios                                                                  |
| ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Organizations                                   | Partly: only the default org           | Yes: three orgs through signup                                             |
| Team members, all four roles                    | Yes, default org only                  | Yes, across orgs                                                           |
| Cases, tasks, subtasks                          | Yes                                    | Yes, with the default checklist                                            |
| Collaborator access and invite                  | No                                     | Yes                                                                        |
| Checklist model, action configs                 | Action configs only                    | Action configs (webhook, left disabled); the checklist model stays default |
| Equipment                                       | Yes                                    | Yes: added, returned, in transit, back in inventory                        |
| Exit surveys                                    | Yes                                    | One survey                                                                 |
| Integrations                                    | Names and status only, no Slack config | Eight without credentials; Slack skipped                                   |
| Plans                                           | Yes                                    | Yes (catalog)                                                              |
| Company subscription, invoices                  | Yes (gold, active)                     | Yes, with sandbox keys and the subscribe route                             |
| Benefit policy and assignments                  | No                                     | Policy, default, rule and manual assignments                               |
| Talent profiles, preferences, answers           | Yes                                    | Yes, including a sensitive answer and share flags                          |
| Résumés, suggestions                            | Yes                                    | Base résumé; score and suggestions with an AI key                          |
| Jobs, job sources                               | Yes                                    | Yes (catalog)                                                              |
| Job matches, rejected jobs                      | Yes                                    | Rejected jobs yes; matches only with an AI key and `CRON_SECRET`           |
| Applications, interviews                        | Yes                                    | Yes: four stages and a scheduled interview                                 |
| AI Apply drafts and attempts                    | No                                     | Draft only with an AI key (often refused for catalog jobs); no run         |
| Carreira Pro subscription                       | No                                     | Yes, with sandbox keys                                                     |
| Benefit co-pay upgrade                          | No                                     | Yes, with sandbox keys (`benefit-copay`)                                   |
| Public pages                                    | Yes                                    | Not covered                                                                |
| Collaborator journey state (consent, departure) | No                                     | Not covered                                                                |

Embedding columns stay null everywhere. Nothing here calls an external service, so the app falls back to text search.

## Screens

HR portal: Painel, Desligamentos (list, detail, import), Checklist automatico, Bens e coleta, Equipe, Integracoes, Planos e gastos, Beneficios, Resultados e feedback, Candidaturas assistidas. Collaborator: `/colaborador` (departure and Carreira) and `/colaborador/entrar`. Scenarios populate Painel, Desligamentos, Equipe, Planos e gastos, Beneficios, Resultados e feedback and Carreira. The dev seed also populates Bens e coleta, Integracoes, Candidaturas assistidas and the application, interview and public page views.
