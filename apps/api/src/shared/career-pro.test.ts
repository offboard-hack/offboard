import { describe, expect, it } from "vitest";
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
      aiApply: { allowedBy: "company" },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
    });
    expect(
      careerPlanOf(standing({ company: { ...top, status: "trialing" } }), now).aiApply,
    ).toEqual({ allowedBy: "company" });
  });

  it("counts the sponsorship date in São Paulo, inclusive", () => {
    const lastDay = standing({ sponsoredUntil: "2026-11-26" });

    expect(careerPlanOf(lastDay, new Date("2026-11-27T02:59:59Z")).aiApply.allowedBy).toBe(
      "company",
    );
    expect(careerPlanOf(lastDay, new Date("2026-11-27T03:00:00Z"))).toEqual({
      company: { name: "Platinum Premium", includesAiApply: true, sponsoredUntil: "2026-11-26" },
      individual: null,
      aiApply: { allowedBy: null },
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
      aiApply: { allowedBy: null },
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
      individual: { plan: "carreira-pro", status: "active", currentPeriodEnd: "2026-12-26" },
      aiApply: { allowedBy: "individual" },
      upgrade: { offered: false, priceCents: 7900, dailyLimit: 10 },
    });
    expect(pro("2026-11-26").aiApply.allowedBy).toBe("individual");
    expect(pro(null).aiApply.allowedBy).toBe("individual");
    expect(pro("2026-11-25")).toMatchObject({
      aiApply: { allowedBy: null },
      upgrade: { offered: true },
    });
    expect(pro("2026-12-26", "pending")).toMatchObject({
      individual: { plan: "carreira-pro", status: "pending", currentPeriodEnd: "2026-12-26" },
      aiApply: { allowedBy: null },
      upgrade: { offered: true },
    });
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
      aiApply: { allowedBy: "company" },
      upgrade: { offered: false },
    });
  });

  it("never grants a canceled or past-due Carreira Pro", () => {
    for (const status of ["canceled", "past_due"] as const) {
      expect(
        careerPlanOf(
          standing({ company: null, individual: { status, currentPeriodEnd: "2099-01-01" } }),
          now,
        ).aiApply.allowedBy,
      ).toBeNull();
    }
  });
});
