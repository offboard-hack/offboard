import { describe, expect, it } from "vitest";
import {
  copayPriceCents,
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
    expect(tierCatalog.map((tier) => tier.priceCents)).toEqual([0, 2900, 5900, 9900]);
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

describe("copayPriceCents", () => {
  it("is the difference between tier prices", () => {
    expect(copayPriceCents(2900, 5900)).toBe(3000);
  });
});

describe("featureComparisonView", () => {
  it("returns current, next, and copay label for Gold", () => {
    const view = featureComparisonView(goldBenefit)!;

    expect(view.current.name).toBe("Gold");
    expect(view.next!.name).toBe("Platinum");
    expect(view.copayLabel).toBe("Upgrade para Platinum · R$ 30/mês");
  });

  it("returns null copayLabel for Platinum Premium", () => {
    const view = featureComparisonView(ppBenefit)!;

    expect(view.next).toBeNull();
    expect(view.copayLabel).toBeNull();
  });

  it("returns null for null benefit", () => {
    expect(featureComparisonView(null)).toBeNull();
  });

  it("returns copay for Silver to Gold (R$0 to R$29)", () => {
    const view = featureComparisonView(silverBenefit)!;

    expect(view.copayLabel).toBe("Upgrade para Gold · R$ 29/mês");
  });
});
