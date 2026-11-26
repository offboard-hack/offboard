import { describe, expect, it } from "vitest";
import {
  type CareerPlan,
  isProActive,
  planCardView,
  planDate,
  planPrice,
  shouldPollPlan,
} from "./plan-card";

const base: CareerPlan = {
  company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: "2027-03-10" },
  individual: null,
  aiApply: { allowedBy: "company" },
  upgrade: { offered: true, priceCents: 7900, dailyLimit: 10 },
};

const today = "2026-11-26";

describe("plan card view", () => {
  it("formats dates and prices", () => {
    expect(planDate("2027-03-10")).toBe("10/03/2027");
    expect(planPrice(7900)).toBe("R$ 79/mês");
    expect(planPrice(7950)).toBe("R$ 79,50/mês");
  });

  it("shows the company plan with a distant sponsorship and no upgrade", () => {
    expect(planCardView(base, today, false)).toEqual({
      companyPlan: "Platinum Premium",
      aiLine: "Inclui candidatura com IA",
      sponsorLine: "Patrocinado pela empresa até 10/03/2027",
      proLine: null,
      paymentNote: false,
      upgrade: "hidden",
      upgradeLabel: "Fazer upgrade · R$ 79/mês",
    });
  });

  it("offers the upgrade when the sponsorship ends within 30 days", () => {
    const soon = { ...base, company: { ...base.company, sponsoredUntil: "2026-12-26" } };
    const later = { ...base, company: { ...base.company, sponsoredUntil: "2026-12-27" } };

    expect(planCardView(soon, today, false).upgrade).toBe("available");
    expect(planCardView(later, today, false).upgrade).toBe("hidden");
  });

  it("offers the upgrade when AI Apply is not allowed", () => {
    const plan: CareerPlan = {
      ...base,
      company: { name: null, includesAiApply: false, sponsoredUntil: "2027-03-10" },
      aiApply: { allowedBy: null },
    };

    expect(planCardView(plan, today, false)).toMatchObject({
      companyPlan: "Sua empresa não tem plano",
      aiLine: "Não inclui",
      sponsorLine: null,
      upgrade: "available",
    });
  });

  it("marks the upgrade unavailable when billing is not offered", () => {
    const plan: CareerPlan = {
      ...base,
      aiApply: { allowedBy: null },
      upgrade: { ...base.upgrade, offered: false },
    };

    expect(planCardView(plan, today, false).upgrade).toBe("unavailable");
  });

  it("shows Carreira Pro and hides the upgrade when it is active", () => {
    const plan: CareerPlan = {
      ...base,
      aiApply: { allowedBy: "individual" },
      individual: { plan: "carreira-pro", status: "active", currentPeriodEnd: "2026-12-26" },
    };

    expect(planCardView(plan, today, false)).toMatchObject({
      proLine: "Carreira Pro ativo · renova em 26/12/2026",
      upgrade: "hidden",
    });
    expect(
      planCardView(
        { ...plan, individual: { plan: "carreira-pro", status: "active", currentPeriodEnd: null } },
        today,
        false,
      ).proLine,
    ).toBe("Carreira Pro ativo");
  });

  it("keeps offering the upgrade while Carreira Pro is not active", () => {
    const plan: CareerPlan = {
      ...base,
      aiApply: { allowedBy: null },
      individual: { plan: "carreira-pro", status: "past_due", currentPeriodEnd: "2026-11-01" },
    };

    expect(planCardView(plan, today, false)).toMatchObject({ proLine: null, upgrade: "available" });
  });

  it("hides the upgrade while a checkout is pending or the payment was just made", () => {
    const pending: CareerPlan = {
      ...base,
      aiApply: { allowedBy: null },
      individual: { plan: "carreira-pro", status: "pending", currentPeriodEnd: null },
    };

    const none: CareerPlan = { ...base, aiApply: { allowedBy: null } };

    expect(planCardView(pending, today, false).upgrade).toBe("hidden");
    expect(planCardView(none, today, true)).toMatchObject({ upgrade: "hidden", paymentNote: true });
  });

  it("does not call an expired Carreira Pro active and drops the payment note once active", () => {
    const expired: CareerPlan = {
      ...base,
      aiApply: { allowedBy: null },
      individual: { plan: "carreira-pro", status: "active", currentPeriodEnd: "2026-11-01" },
    };

    const active: CareerPlan = {
      ...expired,
      aiApply: { allowedBy: "individual" },
      individual: { plan: "carreira-pro", status: "active", currentPeriodEnd: "2026-12-26" },
    };

    expect(planCardView(expired, today, false)).toMatchObject({
      proLine: null,
      upgrade: "available",
    });
    expect(planCardView(active, today, true).paymentNote).toBe(false);
  });

  it("polls until Carreira Pro is active", () => {
    const active: CareerPlan = {
      ...base,
      aiApply: { allowedBy: "individual" },
      individual: { plan: "carreira-pro", status: "active", currentPeriodEnd: null },
    };

    const pending: CareerPlan = {
      ...base,
      individual: { plan: "carreira-pro", status: "pending", currentPeriodEnd: null },
    };

    expect(isProActive(active)).toBe(true);
    expect(isProActive(base)).toBe(false);
    expect(shouldPollPlan(undefined)).toBe(true);
    expect(shouldPollPlan(pending)).toBe(true);
    expect(shouldPollPlan(active)).toBe(false);
  });
});
