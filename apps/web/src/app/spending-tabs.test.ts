import { describe, expect, it } from "vitest";
import { activeSpendingTab, spendingSearchSchema, visibleSpendingTabs } from "./spending-tabs";

describe("visibleSpendingTabs", () => {
  it("lists the tabs the user can open", () => {
    expect(visibleSpendingTabs({ plan: true, benefits: true })).toEqual(["plano", "beneficios"]);
    expect(visibleSpendingTabs({ plan: false, benefits: true })).toEqual(["beneficios"]);
    expect(visibleSpendingTabs({ plan: true, benefits: false })).toEqual(["plano"]);
    expect(visibleSpendingTabs({ plan: false, benefits: false })).toEqual([]);
  });
});

describe("activeSpendingTab", () => {
  it("keeps the requested tab when it is visible", () => {
    expect(activeSpendingTab("beneficios", ["plano", "beneficios"])).toBe("beneficios");
  });

  it("falls back to the first visible tab", () => {
    expect(activeSpendingTab(undefined, ["plano", "beneficios"])).toBe("plano");
    expect(activeSpendingTab("plano", ["beneficios"])).toBe("beneficios");
  });

  it("has no tab when none is visible", () => {
    expect(activeSpendingTab("plano", [])).toBeUndefined();
  });
});

describe("spendingSearchSchema", () => {
  it("accepts known tabs and drops unknown ones", () => {
    expect(spendingSearchSchema.parse({ aba: "beneficios" })).toEqual({ aba: "beneficios" });
    expect(spendingSearchSchema.parse({ aba: "x" })).toEqual({ aba: undefined });
    expect(spendingSearchSchema.parse({})).toEqual({});
  });
});
