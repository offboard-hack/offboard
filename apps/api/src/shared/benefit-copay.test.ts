import { describe, expect, it } from "vitest";
import { copayGrants } from "./benefit-copay.js";

describe("copayGrants", () => {
  const today = "2026-11-27";

  it("grants an active, past due or canceled upgrade until its period ends", () => {
    for (const status of ["active", "past_due", "canceled"] as const) {
      expect(copayGrants({ status, currentPeriodEnd: today }, today)).toBe(true);
      expect(copayGrants({ status, currentPeriodEnd: "2026-11-26" }, today)).toBe(false);
      expect(copayGrants({ status, currentPeriodEnd: null }, today)).toBe(false);
    }
  });

  it("never grants a pending or missing upgrade", () => {
    expect(copayGrants({ status: "pending", currentPeriodEnd: "2099-01-01" }, today)).toBe(false);
    expect(copayGrants(null, today)).toBe(false);
  });
});
