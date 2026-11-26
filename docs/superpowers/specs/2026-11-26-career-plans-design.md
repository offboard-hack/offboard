# Career Plans Design ("Seu plano" and Carreira Pro)

Samuel, 2026-11-26: the collaborator must see, in Carreira, which plan the company contracted, until when it lasts, and how to upgrade. The upgrade is paid by the person.

## Decisions (Samuel)

- **The card shows the company's plan, what it includes (AI Apply yes/no) and the date it lasts until.**
- **The date is set by HR on the case**: a field called "Carreira patrocinada até". It defaults to 3 months after the case deadline (the termination date).
- **One individual plan: Carreira Pro.** It costs **R$ 79/month**, includes AI Apply with **10 real AI sends per day**, and is paid through AbacatePay (Pix or card). It is renewed monthly.

## Rules

- **AI Apply is allowed when** the person consented AND one of these holds:
  - (a) the company is on the top plan (`platinum-premium`, active or trialing) and today, in São Paulo, is on or before "Carreira patrocinada até";
  - (b) the person has an active Carreira Pro.
- **Base career features stay available while the collaborator has access:** résumé, jobs, matches, applications, rehearsal preparation.
- **Daily limit:** at most 10 real AI sends (confirms with `rehearsal: false`) per person per São Paulo day, whatever grants AI Apply. The 11th gets 429 `{ error: "Daily AI application limit reached" }`. Rehearsals don't count against it; the existing daily LLM cap still applies.
- **What the card shows:**
  - the company plan name, or "Sua empresa não tem plano" when there is none;
  - "Inclui candidatura com IA" or "Não inclui";
  - "Patrocinado pela empresa até DD/MM/AAAA";
  - when Carreira Pro is active, "Carreira Pro ativo · renova em DD/MM/AAAA";
  - when AI Apply isn't allowed, or the sponsorship ends within 30 days, a "Fazer upgrade · R$ 79/mês" button.
  - With Carreira Pro active, no upgrade button.
- **Upgrade:**
  - `POST /me/plan/checkout` creates an AbacatePay subscription checkout (product id `carreira-pro`) and returns its URL. The web redirects there, and AbacatePay returns the person to `/colaborador?tela=carreira&plano=ok`.
  - The existing `/billing/webhook` activates, renews or cancels the person's subscription when the event's `externalId` is a talent subscription id. Company subscriptions are unchanged.
  - Without AbacatePay configured, the route returns 503 and the button shows "Indisponível no momento".

## Data (migration 0015)

- `employee_access.career_sponsored_until date null`. Null means the default: the case `deadline` + 3 months.
- `talent_subscriptions`:
  - `profile_id` pk → talent_profiles (on delete cascade);
  - `plan varchar(50) not null default 'carreira-pro'`;
  - `status`: enum `pending`, `active`, `past_due`, `canceled`;
  - `provider_subscription_id varchar(255) null`;
  - `current_period_end date null`;
  - `created_at`, `updated_at`.
- It is included in the account export and deleted with the profile.
- The Carreira Pro price, name and limit live in code (`careerPro = { slug: "carreira-pro", name: "Carreira Pro", priceCents: 7900, aiDailyLimit: 10 }`), not in the company `plans` table, so it never shows in the company billing page.

## Portal

The case page gains a "Carreira patrocinada até" date field. It appears where the collaborator access email is edited, is saved with the existing employee-access settings route (org-scoped), and is prefilled with the default.

## Not covered

- Real charging needs `ABACATEPAY_API_KEY` and `ABACATEPAY_WEBHOOK_SECRET` in production, the `carreira-pro` product created in AbacatePay, and the webhook URL set there. These are ops steps for Samuel or Davi.
- Prorating, plan changes and refunds are out of scope.
