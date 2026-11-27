import { describe, expect, it } from "vitest";
import {
  companySponsors,
  entitlementOf,
  individualActive,
  individualEntitlement,
} from "./entitlement.js";

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

describe("individual entitlement", () => {
  const canceled = { status: "canceled", currentPeriodEnd: "2026-12-01" } as const;

  it("keeps a canceled Carreira Pro until the last day of the paid period in São Paulo", () => {
    expect(individualActive(canceled, "2026-12-01")).toBe(true);
    expect(individualActive(canceled, "2026-12-02")).toBe(false);
    expect(individualEntitlement(canceled, new Date("2026-12-02T02:59:59Z"))).toEqual({
      kind: "individual",
      until: "2026-12-01",
    });
    expect(individualEntitlement(canceled, new Date("2026-12-02T03:00:00Z"))).toEqual({
      kind: "lapsed",
      until: null,
    });
  });

  it("never grants a canceled Carreira Pro without a period end, or other states", () => {
    expect(individualActive({ status: "canceled", currentPeriodEnd: null }, "2026-12-01")).toBe(
      false,
    );
    expect(
      individualActive({ status: "past_due", currentPeriodEnd: "2099-01-01" }, "2026-12-01"),
    ).toBe(false);
    expect(
      individualActive({ status: "pending", currentPeriodEnd: "2099-01-01" }, "2026-12-01"),
    ).toBe(false);
    expect(individualActive(null, "2026-12-01")).toBe(false);
  });

  it("grants an active Carreira Pro until its end, or without one", () => {
    expect(individualActive({ status: "active", currentPeriodEnd: null }, "2026-12-01")).toBe(true);
    expect(
      individualActive({ status: "active", currentPeriodEnd: "2026-12-01" }, "2026-12-02"),
    ).toBe(false);
  });
});
