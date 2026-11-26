import { saoPauloDate } from "./sao-paulo-date.js";

export type Entitlement =
  | { kind: "sponsored"; until: string | null }
  | { kind: "individual"; until: string | null }
  | { kind: "lapsed"; until: null };

export type IndividualPlan = {
  status: "pending" | "active" | "past_due" | "canceled";
  currentPeriodEnd: string | null;
};

export function individualActive(individual: IndividualPlan | null, today: string) {
  return (
    individual?.status === "active" &&
    (individual.currentPeriodEnd === null || today <= individual.currentPeriodEnd)
  );
}

export function individualEntitlement(individual: IndividualPlan | null, now: Date) {
  if (individual !== null && individualActive(individual, saoPauloDate(now))) {
    return { kind: "individual", until: individual.currentPeriodEnd } satisfies Entitlement;
  }

  return { kind: "lapsed", until: null } satisfies Entitlement;
}

export function entitlementOf(input: {
  sponsoredUntil: string;
  companyActive: boolean;
  now: Date;
}) {
  if (input.companyActive && saoPauloDate(input.now) <= input.sponsoredUntil) {
    return { kind: "sponsored", until: input.sponsoredUntil } satisfies Entitlement;
  }

  return { kind: "lapsed", until: null } satisfies Entitlement;
}

export function companySponsors(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}
