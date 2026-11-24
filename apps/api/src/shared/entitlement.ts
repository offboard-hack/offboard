export type Entitlement = { kind: "sponsored"; until: string } | { kind: "lapsed"; until: null };

const saoPauloDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

export function entitlementOf(input: {
  sponsoredUntil: string;
  companyActive: boolean;
  now: Date;
}) {
  if (input.companyActive && saoPauloDay.format(input.now) <= input.sponsoredUntil) {
    return { kind: "sponsored", until: input.sponsoredUntil } satisfies Entitlement;
  }

  return { kind: "lapsed", until: null } satisfies Entitlement;
}

export function companySponsors(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}
