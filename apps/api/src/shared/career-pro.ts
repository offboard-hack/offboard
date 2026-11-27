import { onTopPlan, type CompanyPlan } from "./ai-apply-access.js";
import {
  benefitEntitlement,
  companySponsors,
  individualActive,
  type IndividualPlan,
} from "./entitlement.js";
import { saoPauloDate } from "./sao-paulo-date.js";

export const careerPro = {
  slug: "carreira-pro",
  name: "Carreira Pro",
  priceCents: 7900,
  aiDailyLimit: 10,
} as const;

export const checkoutRetryMs = 60 * 60_000;

const upgradeWindowMs = 30 * 24 * 60 * 60_000;

export type BenefitStanding = {
  planName: string;
  aiApplyDailyLimit: number;
  aiApplyPriority: boolean;
  detailedScore: boolean;
  validUntil: string;
  source: "default" | "rule" | "manual";
};

export type CareerStanding = {
  sponsoredUntil: string;
  company: (CompanyPlan & { name: string }) | null;
  individual: (IndividualPlan & { updatedAt?: Date | null }) | null;
  benefit?: BenefitStanding | null;
};

export type AllowedBy = "company" | "individual" | "benefit" | null;

function upgradeWindowEnd(today: string) {
  return new Date(Date.parse(`${today}T00:00:00Z`) + upgradeWindowMs).toISOString().slice(0, 10);
}

export function checkoutInFlight(individual: CareerStanding["individual"], now: Date) {
  if (individual === null) return false;

  if (individual.status === "past_due") return true;

  return (
    individual.status === "pending" &&
    individual.updatedAt instanceof Date &&
    individual.updatedAt.getTime() > now.getTime() - checkoutRetryMs
  );
}

export function careerPlanOf(standing: CareerStanding, now: Date) {
  const today = saoPauloDate(now);
  const { company, individual, sponsoredUntil } = standing;
  const includesAiApply = onTopPlan(company);
  const companyGrant = includesAiApply && today <= sponsoredUntil;

  const individualGrant = individualActive(individual, today);

  const benefit = standing.benefit ?? null;

  const benefitGrant = benefitEntitlement(benefit, today).kind !== "lapsed";

  const benefitWins =
    benefitGrant &&
    benefit !== null &&
    (benefit.aiApplyDailyLimit >= careerPro.aiDailyLimit || !(companyGrant || individualGrant));

  const allowedBy: AllowedBy = benefitWins
    ? "benefit"
    : companyGrant
      ? "company"
      : individualGrant
        ? "individual"
        : null;

  const dailyLimit =
    benefitWins && benefit !== null ? benefit.aiApplyDailyLimit : careerPro.aiDailyLimit;

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
    benefit,
    aiApply: { allowedBy, dailyLimit },
    upgrade: {
      offered:
        !individualGrant &&
        !checkoutInFlight(individual, now) &&
        (!companyGrant || sponsoredUntil <= upgradeWindowEnd(today)),
      priceCents: careerPro.priceCents,
      dailyLimit: careerPro.aiDailyLimit,
    },
  };
}

export type CareerPlan = ReturnType<typeof careerPlanOf>;
