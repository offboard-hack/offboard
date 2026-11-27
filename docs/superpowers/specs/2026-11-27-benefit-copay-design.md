# Benefit Co-pay Upgrade Design (corporate benefits, Phase 4)

Samuel, 2026-11-27: the collaborator can move up one benefit tier by paying only the difference. There is a single upgrade button. Phase 3 (#161) already shows the tier, a comparison with the next tier, and the co-pay price. Its button is disabled with "Em breve".

## Decisions

- **One upgrade button** (Samuel). The card offers exactly one upgrade, chosen in this order:
  1. The person has a live benefit below the top tier: "Upgrade para {próximo} · R$ {diferença}/mês". This is the co-pay.
  2. The person has no live benefit: Carreira Pro, as today.
  3. The person is on the top tier, or has an active co-pay or Carreira Pro: no upgrade.
- **Price.** The difference is `next.per_person_price_cents - current.per_person_price_cents` for the adjacent tier, charged monthly through AbacatePay.
  - **My call:** every adjacent pair gets an AbacatePay product with externalId `copay-{from}-{to}`.
  - The API creates the product on first use if it doesn't exist (`products/create`, cycle MONTHLY) and reuses it afterwards.
- **What the person gets.** While the co-pay is active, `benefit_assignments.effective_plan_id` is the next tier. Everything reads entitlements from the effective plan already, so nothing else changes.
- **Ending.** The co-pay always ends on the earliest of these:
  - **The person cancels.** AbacatePay stops charging immediately. Access lasts until the end of the paid period, as with Carreira Pro.
  - **The benefit expires** (`valid_until`). **My call:** the co-pay is cancelled at AbacatePay on that day, by the daily cron, and the effective plan goes back to the assigned one.
  - **HR moves the person to a tier at or above the co-pay tier.** The co-pay is cancelled at once, because the company now pays for it.
  - **A payment fails.** **My call:** access stays on the next tier until the end of the paid period, then falls back to the assigned tier.
  - **The account is deleted.** The co-pay is cancelled first, using the same rules as Carreira Pro in #180.
- **Safety.** Same guarantees as the company checkout in #170:
  - an advisory lock per person;
  - the issued checkout is stored and reused while it is fresh, so there is no second live checkout;
  - activation only when `data.checkout.id` matches the stored checkout;
  - events from an older provider subscription are ignored;
  - the gateway's cancel falls back to `subscriptions.get` (CANCELLED or not found count as done).

## Data (migration 0026)

**My call:** a new table `benefit_copays`. The two Phase 1 columns `copay_subscription_id` and `grace_until` on `benefit_assignments` stay unused.

| Column                     | Type                                                     |
| -------------------------- | -------------------------------------------------------- |
| `assignment_id`            | uuid, PK, FK to `benefit_assignments`, on delete cascade |
| `org_id`                   | uuid, not null, FK                                       |
| `target_plan_id`           | uuid, not null, FK to `plans`                            |
| `status`                   | enum `pending`, `active`, `past_due`, `canceled`         |
| `checkout_id`              | varchar(255), nullable                                   |
| `checkout_url`             | text, nullable                                           |
| `provider_subscription_id` | varchar(255), nullable                                   |
| `current_period_end`       | date, nullable                                           |
| `created_at`, `updated_at` | timestamp                                                |

- Webhook externalId: `copay:{assignmentId}`.
- The effective plan is recomputed from `assigned_plan_id` and the co-pay state each time one of them changes.

## Web

- The "Seu plano" card enables the Phase 3 button. It goes to checkout and, on return (`?plano=ok`), polls until the co-pay is active.
- While the co-pay is active, the card shows "Upgrade {próximo} ativo · R$ X/mês" and a "Cancelar upgrade" action with an inline confirmation.
- After a cancel, it shows "Upgrade cancelado · acesso até DD/MM/AAAA".
- HR sees the co-pay in the Benefícios tab (source plus a "coparticipação" badge). HR cannot cancel it.

## Not covered

- Refunds and disputes.
- Jumping more than one tier.
- Prorating.
