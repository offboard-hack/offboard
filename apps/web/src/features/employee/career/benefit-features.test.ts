import { describe, expect, it } from "vitest";
import {
  currentTierFeatures,
  featureComparisonView,
  nextTierFeatures,
  tierCatalog,
} from "./benefit-features";
import type { CareerPlan } from "./plan-card";

function benefit(planName: string) {
  return {
    planName,
    aiApplyDailyLimit: 0,
    aiApplyPriority: false,
    detailedScore: false,
    validUntil: "2027-01-01",
    source: "default",
  } satisfies NonNullable<CareerPlan["benefit"]>;
}

const silverBenefit = benefit("Silver");
const goldBenefit = benefit("Gold");
const ppBenefit = benefit("Platinum Premium");

describe("tier catalog", () => {
  it("lists 4 tiers in price order", () => {
    expect(tierCatalog).toHaveLength(4);
    expect(tierCatalog[0].name).toBe("Silver");
    expect(tierCatalog[3].name).toBe("Platinum Premium");
    expect(tierCatalog.map((tier) => tier.aiApplyLimit)).toEqual([0, 3, 10, 25]);
  });
});

describe("currentTierFeatures", () => {
  it("returns features for a matching plan name", () => {
    expect(currentTierFeatures(goldBenefit)!.name).toBe("Gold");
    expect(currentTierFeatures(goldBenefit)!.aiApplyLimit).toBe(3);
  });

  it("returns null for null benefit", () => {
    expect(currentTierFeatures(null)).toBeNull();
  });

  it("returns null for an unknown plan name", () => {
    expect(currentTierFeatures(benefit("Bronze"))).toBeNull();
  });
});

describe("nextTierFeatures", () => {
  it("returns Platinum for Gold", () => {
    expect(nextTierFeatures(goldBenefit)!.name).toBe("Platinum");
  });

  it("returns null for Platinum Premium", () => {
    expect(nextTierFeatures(ppBenefit)).toBeNull();
  });

  it("returns null for null and unknown benefits", () => {
    expect(nextTierFeatures(null)).toBeNull();
    expect(nextTierFeatures(benefit("Bronze"))).toBeNull();
  });
});

describe("featureComparisonView", () => {
  it("returns the current and the next tier", () => {
    const view = featureComparisonView(goldBenefit)!;

    expect(view.current.name).toBe("Gold");
    expect(view.next!.name).toBe("Platinum");
  });

  it("has no next tier for Platinum Premium", () => {
    const view = featureComparisonView(ppBenefit)!;

    expect(view.next).toBeNull();
  });

  it("returns null for null benefit", () => {
    expect(featureComparisonView(null)).toBeNull();
  });

  it("compares Silver with Gold", () => {
    const view = featureComparisonView(silverBenefit)!;

    expect(view.current.name).toBe("Silver");
    expect(view.next!.name).toBe("Gold");
  });
});
