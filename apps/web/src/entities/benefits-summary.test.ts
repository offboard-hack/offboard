import { describe, expect, it } from "vitest";
import { costSummary, policyDefaults, type BenefitPlanOption } from "./benefits-summary";

describe("policyDefaults", () => {
  it("returns empty policy when input is null", () => {
    expect(policyDefaults(null)).toEqual({
      defaultPlanId: null,
      benefitDurationMonths: 6,
      rules: [],
    });
  });

  it("passes through existing policy", () => {
    const policy = {
      defaultPlanId: "abc",
      benefitDurationMonths: 3,
      rules: [
        {
          id: "r1",
          field: "department" as const,
          operator: "equals" as const,
          value: "Eng",
          planId: "p1",
        },
      ],
    };

    expect(policyDefaults(policy)).toEqual(policy);
  });
});

describe("costSummary", () => {
  const plans: BenefitPlanOption[] = [
    { id: "s", name: "Silver", slug: "silver", perPersonPriceCents: 0 },
    { id: "g", name: "Gold", slug: "gold", perPersonPriceCents: 2900 },
    { id: "p", name: "Platinum", slug: "platinum", perPersonPriceCents: 5900 },
  ];

  it("returns zero for empty assignments", () => {
    expect(costSummary([], plans)).toEqual({ totalCents: 0, tiers: [] });
  });

  it("sums assigned plan prices and groups by tier", () => {
    const assignments = [
      { assignedPlanName: "Gold" },
      { assignedPlanName: "Gold" },
      { assignedPlanName: "Platinum" },
    ];

    expect(costSummary(assignments, plans)).toEqual({
      totalCents: 2900 + 2900 + 5900,
      tiers: [
        { name: "Gold", count: 2, subtotalCents: 5800 },
        { name: "Platinum", count: 1, subtotalCents: 5900 },
      ],
    });
  });

  it("prices unknown plans at zero", () => {
    expect(costSummary([{ assignedPlanName: "Ghost" }], plans)).toEqual({
      totalCents: 0,
      tiers: [{ name: "Ghost", count: 1, subtotalCents: 0 }],
    });
  });
});
