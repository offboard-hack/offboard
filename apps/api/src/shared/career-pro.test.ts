import { describe, expect, it } from "vitest";
import { benefitEntitlement } from "./entitlement.js";
import { careerPlanOf, careerPro, type CareerStanding } from "./career-pro.js";

const now = new Date("2026-11-26T15:00:00Z");
const top = { name: "Platinum Premium", slug: "platinum-premium", status: "active" };

const standing = (patch: Partial<CareerStanding> = {}) => ({
  sponsoredUntil: "2027-02-28",
  company: top,
  individual: null,
  ...patch,
});

describe("careerPro", () => {
  it("is priced and limited in code", () => {
    expect(careerPro).toEqual({
      slug: "carreira-pro",
      name: "Carreira Pro",
      priceCents: 7900,
      aiDailyLimit: 10,
    });
  });
});

describe("careerPlanOf", () => {
  it("lets a top-plan company sponsor AI Apply until its date", () => {
    expect(careerPlanOf(standing(), now)).toEqual({
      company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: "2027-02-28" },
      individual: null,
      benefit: null,
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: "company", dailyLimit: 10 },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
    });
    expect(
      careerPlanOf(standing({ company: { ...top, status: "trialing" } }), now).aiApply,
    ).toEqual({ allowedBy: "company", dailyLimit: 10 });
  });

  it("counts the sponsorship date in São Paulo, inclusive", () => {
    const lastDay = standing({ sponsoredUntil: "2026-11-26" });

    expect(careerPlanOf(lastDay, new Date("2026-11-27T02:59:59Z")).aiApply.allowedBy).toBe(
      "company",
    );
    expect(careerPlanOf(lastDay, new Date("2026-11-27T03:00:00Z"))).toEqual({
      company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: "2026-11-26" },
      individual: null,
      benefit: null,
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: null, dailyLimit: 10 },
      upgrade: { offered: true, priceCents: 7900, dailyLimit: 10 },
    });
  });

  it("offers the upgrade when the sponsorship ends within 30 days", () => {
    expect(careerPlanOf(standing({ sponsoredUntil: "2026-12-26" }), now).upgrade.offered).toBe(
      true,
    );
    expect(careerPlanOf(standing({ sponsoredUntil: "2026-12-27" }), now).upgrade.offered).toBe(
      false,
    );
  });

  it("shows a plan without AI Apply, and no plan when the company is not subscribed", () => {
    expect(
      careerPlanOf(standing({ company: { name: "Gold", slug: "gold", status: "active" } }), now),
    ).toEqual({
      company: { name: "Gold", includesAiApply: false, sponsoredUntil: "2027-02-28" },
      individual: null,
      benefit: null,
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: null, dailyLimit: 10 },
      upgrade: { offered: true, priceCents: 7900, dailyLimit: 10 },
    });

    for (const status of ["canceled", "past_due"]) {
      expect(careerPlanOf(standing({ company: { ...top, status } }), now).company).toEqual({
        name: null,
        includesAiApply: false,
        sponsoredUntil: "2027-02-28",
      });
    }

    expect(careerPlanOf(standing({ company: null }), now).company).toEqual({
      name: null,
      includesAiApply: false,
      sponsoredUntil: "2027-02-28",
    });
  });

  it("grants AI Apply through an active Carreira Pro until its period ends", () => {
    const pro = (currentPeriodEnd: string | null, status: "active" | "pending" = "active") =>
      careerPlanOf(standing({ company: null, individual: { status, currentPeriodEnd } }), now);

    expect(pro("2026-12-26")).toEqual({
      company: { name: null, includesAiApply: false, sponsoredUntil: "2027-02-28" },
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: "2026-12-26",
        cancelable: false,
      },
      benefit: null,
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: "individual", dailyLimit: 10 },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
    });
    expect(pro("2026-11-26").aiApply.allowedBy).toBe("individual");
    expect(pro(null).aiApply.allowedBy).toBe("individual");
    expect(pro("2026-11-25")).toMatchObject({
      benefit: null,
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: null, dailyLimit: 10 },
      upgrade: { offered: true },
    });
    expect(pro("2026-12-26", "pending")).toMatchObject({
      individual: {
        plan: "carreira-pro",
        status: "pending",
        currentPeriodEnd: "2026-12-26",
        cancelable: false,
      },
      benefit: null,
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: null, dailyLimit: 10 },
      upgrade: { offered: true },
    });
  });

  it("allows canceling only an active or past-due plan with a provider subscription", () => {
    const cancelable = (
      status: "active" | "past_due" | "pending" | "canceled",
      providerSubscriptionId: string | null | undefined,
    ) =>
      careerPlanOf(
        standing({
          company: null,
          individual: { status, currentPeriodEnd: "2099-01-01", providerSubscriptionId },
        }),
        now,
      ).individual?.cancelable;

    expect(cancelable("active", "subs_1")).toBe(true);
    expect(cancelable("past_due", "subs_1")).toBe(true);
    expect(cancelable("active", null)).toBe(false);
    expect(cancelable("active", undefined)).toBe(false);
    expect(cancelable("pending", "subs_1")).toBe(false);
    expect(cancelable("canceled", "subs_1")).toBe(false);
  });

  it("holds back the upgrade while a checkout is in flight", () => {
    const offered = (individual: CareerStanding["individual"]) =>
      careerPlanOf(standing({ company: null, individual }), now).upgrade.offered;

    const recent = new Date(now.getTime() - 30 * 60_000);
    const old = new Date(now.getTime() - 61 * 60_000);

    expect(offered({ status: "past_due", currentPeriodEnd: null })).toBe(false);
    expect(offered({ status: "pending", currentPeriodEnd: null, updatedAt: recent })).toBe(false);
    expect(offered({ status: "pending", currentPeriodEnd: null, updatedAt: old })).toBe(true);
    expect(offered({ status: "pending", currentPeriodEnd: null })).toBe(true);
    expect(offered({ status: "canceled", currentPeriodEnd: null })).toBe(true);
  });

  it("names the company first when both grant AI Apply, without offering the upgrade", () => {
    const both = standing({
      sponsoredUntil: "2026-12-01",
      individual: { status: "active", currentPeriodEnd: null },
    });

    expect(careerPlanOf(both, now)).toMatchObject({
      benefit: null,
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: "company", dailyLimit: 10 },
      upgrade: { offered: false },
    });
  });

  it("never grants a past-due Carreira Pro", () => {
    expect(
      careerPlanOf(
        standing({
          company: null,
          individual: { status: "past_due", currentPeriodEnd: "2099-01-01" },
        }),
        now,
      ).aiApply.allowedBy,
    ).toBeNull();
  });

  it("keeps a canceled Carreira Pro until its paid period ends and then offers the upgrade", () => {
    const canceled = (currentPeriodEnd: string | null) =>
      careerPlanOf(
        standing({ company: null, individual: { status: "canceled", currentPeriodEnd } }),
        now,
      );

    expect(canceled("2026-11-26")).toMatchObject({
      individual: { status: "canceled", currentPeriodEnd: "2026-11-26" },
      copay: { offer: null, subscription: null },
      aiApply: { allowedBy: "individual", dailyLimit: 10 },
      upgrade: { offered: false },
    });
    expect(canceled("2026-11-25")).toMatchObject({
      aiApply: { allowedBy: null },
      upgrade: { offered: true },
    });
    expect(canceled(null)).toMatchObject({
      aiApply: { allowedBy: null },
      upgrade: { offered: true },
    });
  });
});

describe("benefitEntitlement", () => {
  it("is sponsored while the benefit has AI Apply and has not expired", () => {
    const benefit = { aiApplyDailyLimit: 3, validUntil: "2027-06-01" };

    expect(benefitEntitlement(benefit, "2026-11-26")).toEqual({
      kind: "sponsored",
      until: "2027-06-01",
    });
    expect(benefitEntitlement(benefit, "2027-06-01").kind).toBe("sponsored");
  });

  it("is lapsed without AI Apply, once expired, or without a benefit", () => {
    const lapsed = { kind: "lapsed", until: null };

    expect(
      benefitEntitlement({ aiApplyDailyLimit: 0, validUntil: "2027-06-01" }, "2026-11-26"),
    ).toEqual(lapsed);
    expect(
      benefitEntitlement({ aiApplyDailyLimit: 10, validUntil: "2026-01-01" }, "2026-11-26"),
    ).toEqual(lapsed);
    expect(benefitEntitlement(null, "2026-11-26")).toEqual(lapsed);
  });
});

describe("careerPlanOf with a benefit", () => {
  const gold = {
    planName: "Gold",
    aiApplyDailyLimit: 3,
    aiApplyPriority: false,
    detailedScore: true,
    validUntil: "2027-06-01",
    source: "rule" as const,
  };

  const silver = { name: "Silver", slug: "silver", status: "active" };

  it("grants AI Apply from the benefit with its own daily limit", () => {
    const plan = careerPlanOf(standing({ company: silver, benefit: gold }), now);

    expect(plan.aiApply).toEqual({ allowedBy: "benefit", dailyLimit: 3 });
    expect(plan.benefit).toEqual(gold);
  });

  it("never grants an expired benefit and falls back to the company", () => {
    const plan = careerPlanOf(standing({ benefit: { ...gold, validUntil: "2026-01-01" } }), now);

    expect(plan.aiApply).toEqual({ allowedBy: "company", dailyLimit: 10 });
  });

  it("never grants a benefit without AI Apply", () => {
    const plan = careerPlanOf(
      standing({ company: silver, benefit: { ...gold, aiApplyDailyLimit: 0 } }),
      now,
    );

    expect(plan.aiApply).toEqual({ allowedBy: null, dailyLimit: 10 });
  });

  it("lets a higher tier win over a lower benefit", () => {
    const individual = { status: "active", currentPeriodEnd: "2027-01-01" } as const;

    expect(
      careerPlanOf(standing({ company: silver, individual, benefit: gold }), now).aiApply,
    ).toEqual({ allowedBy: "individual", dailyLimit: 10 });
    expect(careerPlanOf(standing({ benefit: gold }), now).aiApply).toEqual({
      allowedBy: "company",
      dailyLimit: 10,
    });
  });

  it("names the benefit when it matches the top tier", () => {
    const plan = careerPlanOf(standing({ benefit: { ...gold, aiApplyDailyLimit: 10 } }), now);

    expect(plan.aiApply).toEqual({ allowedBy: "benefit", dailyLimit: 10 });
  });
});
