import { describe, expect, it } from "vitest";
import { companySponsors, entitlementOf } from "./entitlement.js";

describe("entitlement", () => {
  it("uses the São Paulo calendar day", () => {
    expect(
      entitlementOf({
        sponsoredUntil: "2026-12-01",
        companyActive: true,
        now: new Date("2026-12-02T02:30:00Z"),
      }),
    ).toEqual({ kind: "sponsored", until: "2026-12-01" });
    expect(
      entitlementOf({
        sponsoredUntil: "2026-12-01",
        companyActive: true,
        now: new Date("2026-12-02T03:30:00Z"),
      }),
    ).toEqual({ kind: "lapsed", until: null });
  });

  it("lapses without an active company subscription", () => {
    expect(
      entitlementOf({ sponsoredUntil: "2099-01-01", companyActive: false, now: new Date() }),
    ).toEqual({ kind: "lapsed", until: null });
    expect([
      companySponsors("active"),
      companySponsors("trialing"),
      companySponsors("past_due"),
      companySponsors("canceled"),
      companySponsors(null),
      companySponsors(undefined),
    ]).toEqual([true, true, false, false, false, false]);
  });
});
