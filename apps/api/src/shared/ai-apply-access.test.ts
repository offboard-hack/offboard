import { describe, expect, it } from "vitest";
import { aiApplyAccess, browserbaseConfig, onTopPlan, topPlanSlug } from "./ai-apply-access.js";

describe("onTopPlan", () => {
  it("needs an active or trialing subscription to the top plan", () => {
    expect(topPlanSlug).toBe("platinum-premium");
    expect(onTopPlan({ slug: "platinum-premium", status: "active" })).toBe(true);
    expect(onTopPlan({ slug: "platinum-premium", status: "trialing" })).toBe(true);
    expect(onTopPlan({ slug: "platinum-premium", status: "canceled" })).toBe(false);
    expect(onTopPlan({ slug: "platinum-premium", status: "past_due" })).toBe(false);
    expect(onTopPlan({ slug: "gold", status: "active" })).toBe(false);
    expect(onTopPlan(null)).toBe(false);
  });
});

describe("aiApplyAccess", () => {
  const consented = { aiApplyConsentAt: "2026-11-25T00:00:00.000Z" };
  const top = { slug: "platinum-premium", status: "active" };

  it("allows a consenting person whose company is on the top plan", () => {
    expect(aiApplyAccess(consented, top)).toBe("allowed");
  });

  it("rejects another plan, a lapsed subscription or none", () => {
    expect(aiApplyAccess(consented, { slug: "gold", status: "active" })).toBe("not_allowed");
    expect(aiApplyAccess(consented, { ...top, status: "canceled" })).toBe("not_allowed");
    expect(aiApplyAccess(consented, null)).toBe("not_allowed");
  });

  it("rejects a missing consent", () => {
    expect(aiApplyAccess({ aiApplyConsentAt: null }, top)).toBe("not_allowed");
  });
});

describe("browserbaseConfig", () => {
  it("needs both the key and the project", () => {
    expect(browserbaseConfig("key", "project")).toEqual({ apiKey: "key", projectId: "project" });
    expect(browserbaseConfig("key", undefined)).toBeUndefined();
    expect(browserbaseConfig(undefined, "project")).toBeUndefined();
    expect(browserbaseConfig("", "project")).toBeUndefined();
  });
});
