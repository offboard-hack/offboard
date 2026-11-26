import type { invoices, plans, subscriptions } from "./schema/index.ts";

export type SeedPlan = Pick<
  typeof plans.$inferInsert,
  | "name"
  | "slug"
  | "monthlyPriceCents"
  | "maxEmployees"
  | "perPersonPriceCents"
  | "aiApplyDailyLimit"
  | "aiApplyPriority"
  | "detailedScore"
> & { features: string[] };

export type SeedInvoice = Pick<
  typeof invoices.$inferInsert,
  "amountCents" | "status" | "dueDate" | "paidAt"
>;

export type SeedSubscription = Pick<
  typeof subscriptions.$inferInsert,
  "status" | "currentPeriodStart" | "currentPeriodEnd"
> & { planSlug: string; invoices: SeedInvoice[] };

export const seedPlans: SeedPlan[] = [
  {
    name: "Silver",
    slug: "silver",
    monthlyPriceCents: 14900,
    maxEmployees: 20,
    perPersonPriceCents: 0,
    aiApplyDailyLimit: 0,
    aiApplyPriority: false,
    detailedScore: false,
    features: ["Até 20 desligamentos ativos", "Checklists padrão", "Suporte por e-mail"],
  },
  {
    name: "Gold",
    slug: "gold",
    monthlyPriceCents: 24900,
    maxEmployees: 30,
    perPersonPriceCents: 2900,
    aiApplyDailyLimit: 3,
    aiApplyPriority: false,
    detailedScore: true,
    features: [
      "Até 30 desligamentos ativos",
      "Checklists personalizados",
      "Integrações com Slack e e-mail",
      "Suporte prioritário",
    ],
  },
  {
    name: "Platinum",
    slug: "platinum",
    monthlyPriceCents: 39900,
    maxEmployees: 15,
    perPersonPriceCents: 5900,
    aiApplyDailyLimit: 10,
    aiApplyPriority: false,
    detailedScore: true,
    features: [
      "Até 15 desligamentos ativos",
      "Checklists personalizados",
      "Todas as integrações",
      "Gerente de conta dedicado",
    ],
  },
  {
    name: "Platinum Premium",
    slug: "platinum-premium",
    monthlyPriceCents: 69900,
    maxEmployees: 5,
    perPersonPriceCents: 9900,
    aiApplyDailyLimit: 25,
    aiApplyPriority: true,
    detailedScore: true,
    features: [
      "Até 5 desligamentos ativos",
      "Fluxos para liderança",
      "Todas as integrações",
      "Gerente de conta dedicado",
      "Atendimento 24 horas",
    ],
  },
];

export const seedSubscription: SeedSubscription = {
  planSlug: "gold",
  status: "active",
  currentPeriodStart: "2026-11-01",
  currentPeriodEnd: "2026-11-30",
  invoices: [
    {
      amountCents: 24900,
      status: "paid",
      dueDate: "2026-10-01",
      paidAt: new Date("2026-10-01T12:00:00Z"),
    },
    {
      amountCents: 24900,
      status: "pending",
      dueDate: "2026-12-01",
      paidAt: null,
    },
  ],
};
