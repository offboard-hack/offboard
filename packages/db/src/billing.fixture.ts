import type { invoices, plans, subscriptions } from "./schema/index.ts";

export type SeedPlan = Pick<
  typeof plans.$inferInsert,
  "name" | "slug" | "monthlyPriceCents" | "maxEmployees"
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
    features: ["Até 20 desligamentos ativos", "Checklists padrão", "Suporte por e-mail"],
  },
  {
    name: "Gold",
    slug: "gold",
    monthlyPriceCents: 24900,
    maxEmployees: 30,
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
    { amountCents: 24900, status: "pending", dueDate: "2026-12-01", paidAt: null },
  ],
};
