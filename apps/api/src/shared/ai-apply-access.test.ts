import { describe, expect, it } from "vitest";
import {
  aiApplyAccess,
  aiApplyCapable,
  browserbaseConfig,
  greenhouseKey,
  onTopPlan,
  topPlanSlug,
} from "./ai-apply-access.js";

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

describe("aiApplyCapable", () => {
  const job = { source: "greenhouse", sourceKey: "stone:8201530003", closedAt: null };

  it("takes open Greenhouse jobs with a board and posting key", () => {
    expect(aiApplyCapable(job)).toBe(true);
    expect(greenhouseKey.exec(job.sourceKey)?.slice(1)).toEqual(["stone", "8201530003"]);
  });

  it("refuses closed jobs, other sources and unreadable keys", () => {
    expect(aiApplyCapable({ ...job, closedAt: new Date() })).toBe(false);
    expect(aiApplyCapable({ ...job, source: "lever" })).toBe(false);
    expect(aiApplyCapable({ ...job, sourceKey: "stone" })).toBe(false);
    expect(aiApplyCapable({ ...job, sourceKey: "Stone:12" })).toBe(false);
    expect(aiApplyCapable({ ...job, sourceKey: "stone:12a" })).toBe(false);
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
