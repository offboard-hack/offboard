import { onTopPlan, type CompanyPlan } from "./ai-apply-access.js";
import { companySponsors } from "./entitlement.js";
import { saoPauloDate } from "./sao-paulo-date.js";

export const careerPro = {
  slug: "carreira-pro",
  name: "Carreira Pro",
  priceCents: 7900,
  aiDailyLimit: 10,
} as const;

const upgradeWindowMs = 30 * 24 * 60 * 60_000;

export type CareerStanding = {
  sponsoredUntil: string;
  company: (CompanyPlan & { name: string }) | null;
  individual: {
    status: "pending" | "active" | "past_due" | "canceled";
    currentPeriodEnd: string | null;
  } | null;
};

export type AllowedBy = "company" | "individual" | null;

function upgradeWindowEnd(today: string) {
  return new Date(Date.parse(`${today}T00:00:00Z`) + upgradeWindowMs).toISOString().slice(0, 10);
}

export function careerPlanOf(standing: CareerStanding, now: Date) {
  const today = saoPauloDate(now);
  const { company, individual, sponsoredUntil } = standing;
  const includesAiApply = onTopPlan(company);
  const companyGrant = includesAiApply && today <= sponsoredUntil;

  const individualGrant =
    individual?.status === "active" &&
    (individual.currentPeriodEnd === null || today <= individual.currentPeriodEnd);

  const allowedBy: AllowedBy = companyGrant ? "company" : individualGrant ? "individual" : null;

  return {
    company: {
      name: company !== null && companySponsors(company.status) ? company.name : null,
      includesAiApply,
      sponsoredUntil,
    },
    individual: individual && {
      plan: careerPro.slug,
      status: individual.status,
      currentPeriodEnd: individual.currentPeriodEnd,
    },
    aiApply: { allowedBy },
    upgrade: {
      offered: !individualGrant && (!companyGrant || sponsoredUntil <= upgradeWindowEnd(today)),
      priceCents: careerPro.priceCents,
      dailyLimit: careerPro.aiDailyLimit,
    },
  };
}

export type CareerPlan = ReturnType<typeof careerPlanOf>;
