import { saoPauloDate } from "./sao-paulo-date.js";

export type Entitlement =
  | { kind: "sponsored"; until: string | null }
  | { kind: "lapsed"; until: null };

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
