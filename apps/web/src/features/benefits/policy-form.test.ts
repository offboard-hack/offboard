import { describe, it, expect } from "vitest";
import {
  benefitPolicySchema,
  durationOptions,
  ruleFieldOptions,
  ruleOperatorOptions,
  emptyRule,
} from "./policy-form";

const base = { defaultPlanId: null, benefitDurationMonths: 6, rules: [] };

describe("benefitPolicySchema", () => {
  it("accepts a valid policy", () => {
    const result = benefitPolicySchema.safeParse({
      defaultPlanId: "uuid-here",
      benefitDurationMonths: 6,
      rules: [
        {
          id: "r1",
          field: "department",
          operator: "contains",
          value: "Engenharia",
          planId: "uuid-plan",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts null defaultPlanId", () => {
    expect(benefitPolicySchema.safeParse({ ...base, benefitDurationMonths: 3 }).success).toBe(true);
  });

  it("rejects duration outside 1-24", () => {
    expect(benefitPolicySchema.safeParse({ ...base, benefitDurationMonths: 0 }).success).toBe(
      false,
    );

    expect(benefitPolicySchema.safeParse({ ...base, benefitDurationMonths: 25 }).success).toBe(
      false,
    );
  });

  it("rejects rule with empty value", () => {
    expect(
      benefitPolicySchema.safeParse({
        ...base,
        rules: [{ id: "r1", field: "role", operator: "equals", value: "", planId: "p1" }],
      }).success,
    ).toBe(false);
  });

  it("accepts contains rule with accented value", () => {
    expect(
      benefitPolicySchema.safeParse({
        ...base,
        rules: [{ id: "r1", field: "role", operator: "contains", value: "Gerência", planId: "p1" }],
      }).success,
    ).toBe(true);
  });
});

describe("durationOptions", () => {
  it("covers 1 to 24 with pt-BR plurals", () => {
    expect(durationOptions).toHaveLength(24);
    expect(durationOptions[0]).toEqual({ value: "1", label: "1 mês" });
    expect(durationOptions[1]).toEqual({ value: "2", label: "2 meses" });
    expect(durationOptions[23]).toEqual({ value: "24", label: "24 meses" });
  });
});

describe("rule options", () => {
  it("includes contains operator", () => {
    expect(ruleOperatorOptions.some((o) => o.value === "contains")).toBe(true);
  });

  it("lists department and role fields", () => {
    expect(ruleFieldOptions.map((o) => o.value)).toEqual(["department", "role"]);
  });
});

describe("emptyRule", () => {
  it("returns a rule with generated id and first plan", () => {
    const rule = emptyRule([{ id: "p1", name: "Gold", slug: "gold", perPersonPriceCents: 2900 }]);
    expect(rule.id).toBeTruthy();
    expect(rule.planId).toBe("p1");
    expect(rule.field).toBe("department");
    expect(rule.operator).toBe("equals");
    expect(rule.value).toBe("");
  });

  it("falls back to empty planId without plans", () => {
    expect(emptyRule([]).planId).toBe("");
  });
});
