import { describe, expect, it } from "vitest";
import {
  type CareerPlan,
  checkoutPendingNote,
  isProActive,
  pastDueNote,
  planCardView,
  planDate,
  planPrice,
  shouldPollPlan,
} from "./plan-card";

const base: CareerPlan = {
  company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: "2027-03-10" },
  individual: null,
  benefit: null,
  aiApply: { allowedBy: "company", dailyLimit: 10 },
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
      cancelable: false,
      paymentNote: false,
      statusNote: null,
      upgrade: "hidden",
      upgradeLabel: "Fazer upgrade · R$ 79/mês",
      benefitLine: null,
      benefitExpiring: false,
      benefitExpiryWarning: null,
      activeBenefit: null,
      showComparison: false,
      aiApplyLine: "10 candidaturas/dia com IA",
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
      aiApply: { allowedBy: null, dailyLimit: 0 },
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
      aiApply: { allowedBy: null, dailyLimit: 0 },
      upgrade: { ...base.upgrade, offered: false },
    };

    expect(planCardView(plan, today, false).upgrade).toBe("unavailable");
  });

  it("shows Carreira Pro and hides the upgrade when it is active", () => {
    const plan: CareerPlan = {
      ...base,
      aiApply: { allowedBy: "individual", dailyLimit: 10 },
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: "2026-12-26",
        cancelable: false,
      },
    };

    expect(planCardView(plan, today, false)).toMatchObject({
      proLine: "Carreira Pro ativo · renova em 26/12/2026",
      upgrade: "hidden",
    });
    expect(
      planCardView(
        {
          ...plan,
          individual: {
            plan: "carreira-pro",
            status: "active",
            currentPeriodEnd: null,
            cancelable: false,
          },
        },
        today,
        false,
      ).proLine,
    ).toBe("Carreira Pro ativo");
  });

  it("offers cancellation from the plan's cancelable flag, not from the access state", () => {
    const withIndividual = (
      status: "active" | "pending" | "past_due" | "canceled",
      cancelable: boolean,
    ) => ({
      ...base,
      aiApply: { allowedBy: null, dailyLimit: 0 },
      individual: {
        plan: "carreira-pro" as const,
        status,
        currentPeriodEnd: "2026-11-01",
        cancelable,
      },
    });

    expect(planCardView(withIndividual("past_due", true), today, false).cancelable).toBe(true);
    expect(planCardView(withIndividual("active", true), today, false).cancelable).toBe(true);
    expect(planCardView(withIndividual("pending", false), today, false).cancelable).toBe(false);
    expect(planCardView(withIndividual("canceled", false), today, false).cancelable).toBe(false);
    expect(planCardView(base, today, false).cancelable).toBe(false);
  });

  it("shows the access end of a canceled Carreira Pro and withholds the upgrade until it passes", () => {
    const canceled = (end: string | null) => ({
      ...base,
      aiApply: {
        allowedBy: end === "2026-11-25" || end === null ? null : ("individual" as const),
        dailyLimit: 10,
      },
      individual: {
        plan: "carreira-pro" as const,
        status: "canceled" as const,
        currentPeriodEnd: end,
        cancelable: false,
      },
    });

    expect(planCardView(canceled("2026-12-26"), today, false)).toMatchObject({
      proLine: "Carreira Pro cancelado · acesso até 26/12/2026",
      cancelable: false,
      upgrade: "hidden",
    });
    expect(planCardView(canceled(today), today, false)).toMatchObject({
      proLine: "Carreira Pro cancelado · acesso até 26/11/2026",
      upgrade: "hidden",
    });
    expect(isProActive(canceled("2026-11-25"), today)).toBe(false);
    expect(planCardView(canceled("2026-11-25"), today, false)).toMatchObject({
      proLine: null,
      cancelable: false,
      upgrade: "available",
    });
    expect(planCardView(canceled(null), today, false)).toMatchObject({
      proLine: null,
      upgrade: "available",
    });
  });

  it("hides the upgrade while a checkout is in flight and offers it again once the API allows a retry", () => {
    const pending: CareerPlan = {
      ...base,
      aiApply: { allowedBy: null, dailyLimit: 0 },
      individual: {
        plan: "carreira-pro",
        status: "pending",
        currentPeriodEnd: null,
        cancelable: false,
      },
    };

    const none: CareerPlan = { ...base, aiApply: { allowedBy: null, dailyLimit: 0 } };

    const inFlight: CareerPlan = { ...pending, upgrade: { ...base.upgrade, offered: false } };

    expect(planCardView(pending, today, false).upgrade).toBe("available");
    expect(planCardView(none, today, true)).toMatchObject({ upgrade: "hidden", paymentNote: true });
    expect(planCardView(inFlight, today, false)).toMatchObject({
      upgrade: "hidden",
      statusNote: checkoutPendingNote,
    });
    expect(planCardView(inFlight, today, true)).toMatchObject({
      upgrade: "hidden",
      statusNote: null,
      paymentNote: true,
    });
  });

  it("keeps Carreira Pro active when the company also sponsors, until the period ends", () => {
    const sponsored: CareerPlan = {
      ...base,
      company: { ...base.company, sponsoredUntil: "2026-12-01" },
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: "2026-11-26",
        cancelable: false,
      },
    };

    expect(planCardView(sponsored, today, false)).toMatchObject({
      proLine: "Carreira Pro ativo · renova em 26/11/2026",
      upgrade: "hidden",
    });
    expect(planCardView(sponsored, today, true).paymentNote).toBe(false);

    const lapsed: CareerPlan = {
      ...sponsored,
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: "2026-11-25",
        cancelable: false,
      },
    };

    expect(planCardView(lapsed, today, false)).toMatchObject({
      proLine: null,
      upgrade: "available",
    });
  });

  it("explains a past-due Carreira Pro instead of offering the upgrade", () => {
    const plan: CareerPlan = {
      ...base,
      aiApply: { allowedBy: null, dailyLimit: 0 },
      individual: {
        plan: "carreira-pro",
        status: "past_due",
        currentPeriodEnd: "2026-11-01",
        cancelable: false,
      },
    };

    expect(planCardView(plan, today, false)).toMatchObject({
      proLine: null,
      statusNote: pastDueNote,
      upgrade: "hidden",
    });
  });

  it("polls until Carreira Pro is active", () => {
    const active: CareerPlan = {
      ...base,
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: null,
        cancelable: false,
      },
    };

    const pending: CareerPlan = {
      ...base,
      individual: {
        plan: "carreira-pro",
        status: "pending",
        currentPeriodEnd: null,
        cancelable: false,
      },
    };

    expect(isProActive(active, today)).toBe(true);
    expect(isProActive(base, today)).toBe(false);
    expect(shouldPollPlan(undefined, today)).toBe(true);
    expect(shouldPollPlan(pending, today)).toBe(true);
    expect(shouldPollPlan(active, today)).toBe(false);
  });
});

const benefitBase: CareerPlan = {
  company: { name: "Gold", includesAiApply: false, sponsoredUntil: "2027-03-10" },
  individual: null,
  benefit: {
    planName: "Gold",
    aiApplyDailyLimit: 3,
    aiApplyPriority: false,
    detailedScore: true,
    validUntil: "2027-06-15",
    source: "rule",
  },
  aiApply: { allowedBy: "benefit", dailyLimit: 3 },
  upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
};

const withValidUntil = (validUntil: string) =>
  ({
    ...benefitBase,
    benefit: { ...benefitBase.benefit!, validUntil },
  }) satisfies CareerPlan;

describe("plan card benefit view", () => {
  it("shows benefit tier with sponsorship line", () => {
    expect(planCardView(benefitBase, today, false)).toMatchObject({
      benefitLine: "Gold · Patrocinado pela empresa até 15/06/2027",
      benefitExpiring: false,
      benefitExpiryWarning: null,
      aiApplyLine: "3 candidaturas/dia com IA",
      upgrade: "hidden",
    });
  });

  it("shows expiry warning when benefit expires within 30 days", () => {
    const view = planCardView(withValidUntil("2026-12-20"), today, false);

    expect(view).toMatchObject({
      benefitExpiring: true,
      benefitExpiryWarning: "Seu benefício expira em 24 dias. Faça upgrade para manter o acesso.",
      upgrade: "unavailable",
    });
    expect(planCardView(withValidUntil("2026-11-27"), today, false).benefitExpiryWarning).toBe(
      "Seu benefício expira em 1 dia. Faça upgrade para manter o acesso.",
    );
  });

  it("does not offer the upgrade for an expiring benefit when Carreira Pro is active", () => {
    const plan: CareerPlan = {
      ...withValidUntil("2026-12-20"),
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: null,
        cancelable: false,
      },
    };

    expect(planCardView(plan, today, false).upgrade).toBe("hidden");
  });

  it("hides benefit UI when benefit is lapsed", () => {
    expect(planCardView(withValidUntil("2026-11-25"), today, false)).toMatchObject({
      benefitLine: null,
      benefitExpiring: false,
      benefitExpiryWarning: null,
    });
  });

  it("shows benefit and Carreira Pro together", () => {
    const plan: CareerPlan = {
      ...benefitBase,
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: "2027-01-15",
        cancelable: false,
      },
      aiApply: { allowedBy: "individual", dailyLimit: 10 },
    };

    const view = planCardView(plan, today, false);

    expect(view.benefitLine).not.toBeNull();
    expect(view.proLine).not.toBeNull();
    expect(view.benefitLine).toBe("Gold · Patrocinado + upgrade pessoal");
  });

  it("falls back when allowedBy is benefit but benefit field is null", () => {
    expect(planCardView({ ...benefitBase, benefit: null }, today, false).benefitLine).toBeNull();
  });

  it("shows priority badge text for Platinum Premium benefit", () => {
    const plan: CareerPlan = {
      ...benefitBase,
      benefit: { ...benefitBase.benefit!, aiApplyPriority: true, aiApplyDailyLimit: 25 },
      aiApply: { allowedBy: "benefit", dailyLimit: 25 },
    };

    expect(planCardView(plan, today, false).aiApplyLine).toBe(
      "25 candidaturas/dia com IA · prioridade",
    );
  });

  it("omits the priority text when the benefit is lapsed and says so when there is no AI apply", () => {
    const lapsed: CareerPlan = {
      ...withValidUntil("2026-11-25"),
      benefit: { ...benefitBase.benefit!, validUntil: "2026-11-25", aiApplyPriority: true },
    };

    expect(planCardView(lapsed, today, false).aiApplyLine).toBe("3 candidaturas/dia com IA");
    expect(
      planCardView({ ...benefitBase, aiApply: { allowedBy: null, dailyLimit: 0 } }, today, false)
        .aiApplyLine,
    ).toBe("Sem candidatura com IA");
  });

  it("drops the upgrade prompt from the expiry warning when Carreira Pro is active", () => {
    const plan: CareerPlan = {
      ...withValidUntil("2026-12-20"),
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: null,
        cancelable: false,
      },
    };

    expect(planCardView(plan, today, false).benefitExpiryWarning).toBe(
      "Seu benefício expira em 24 dias.",
    );
  });

  it("exposes the active benefit and hides the comparison when the benefit is lapsed", () => {
    const view = planCardView(withValidUntil("2026-11-25"), today, false);

    expect(view.activeBenefit).toBeNull();
    expect(view.showComparison).toBe(false);
  });

  it("shows the comparison for an active benefit without Carreira Pro", () => {
    const view = planCardView(benefitBase, today, false);

    expect(view.activeBenefit).toBe(benefitBase.benefit);
    expect(view.showComparison).toBe(true);
  });

  it("hides the comparison when Carreira Pro matches or exceeds the benefit tier", () => {
    const plan: CareerPlan = {
      ...benefitBase,
      benefit: { ...benefitBase.benefit!, planName: "Silver", aiApplyDailyLimit: 0 },
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: null,
        cancelable: false,
      },
    };

    expect(planCardView(plan, today, false).showComparison).toBe(false);
  });

  it("keeps the comparison when the benefit tier beats Carreira Pro", () => {
    const plan: CareerPlan = {
      ...benefitBase,
      benefit: { ...benefitBase.benefit!, planName: "Platinum Premium", aiApplyDailyLimit: 25 },
      individual: {
        plan: "carreira-pro",
        status: "active",
        currentPeriodEnd: null,
        cancelable: false,
      },
    };

    expect(planCardView(plan, today, false).showComparison).toBe(true);
  });
});
