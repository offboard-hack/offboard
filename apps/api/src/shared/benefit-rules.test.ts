import { describe, expect, it } from "vitest";
import { benefitRuleSchema, evaluateBenefitRules, matchesBenefitRule } from "./benefit-rules.js";

describe("matchesBenefitRule", () => {
  it("equals matches case-insensitively", () => {
    expect(
      matchesBenefitRule(
        { field: "role", operator: "equals", value: "Gerente" },
        { department: "", role: "gerente" },
      ),
    ).toBe(true);
  });

  it("equals matches accents in both directions", () => {
    expect(
      matchesBenefitRule(
        { field: "role", operator: "equals", value: "Gerência" },
        { department: "", role: "gerencia" },
      ),
    ).toBe(true);
    expect(
      matchesBenefitRule(
        { field: "role", operator: "equals", value: "gerencia" },
        { department: "", role: "Gerência" },
      ),
    ).toBe(true);
  });

  it("ignores surrounding whitespace in the person's value", () => {
    const person = { department: "Engenharia ", role: " Gerente" };

    expect(
      matchesBenefitRule({ field: "department", operator: "equals", value: "Engenharia" }, person),
    ).toBe(true);
    expect(
      matchesBenefitRule(
        { field: "department", operator: "notEquals", value: "Engenharia" },
        person,
      ),
    ).toBe(false);
    expect(
      matchesBenefitRule({ field: "role", operator: "contains", value: "gerente" }, person),
    ).toBe(true);
  });

  it("equals does not partial-match", () => {
    expect(
      matchesBenefitRule(
        { field: "role", operator: "equals", value: "Gerente" },
        { department: "", role: "Gerente de Vendas" },
      ),
    ).toBe(false);
  });

  it("notEquals is negation of equals", () => {
    expect(
      matchesBenefitRule(
        { field: "department", operator: "notEquals", value: "TI" },
        { department: "RH", role: "" },
      ),
    ).toBe(true);
    expect(
      matchesBenefitRule(
        { field: "department", operator: "notEquals", value: "TI" },
        { department: "ti", role: "" },
      ),
    ).toBe(false);
  });

  it("contains matches substring case-insensitively with accents", () => {
    expect(
      matchesBenefitRule(
        { field: "role", operator: "contains", value: "gerência" },
        { department: "", role: "Gerência de Projetos" },
      ),
    ).toBe(true);
  });

  it("contains matches across accent differences in both directions", () => {
    expect(
      matchesBenefitRule(
        { field: "role", operator: "contains", value: "gerencia" },
        { department: "", role: "Gerência de Projetos" },
      ),
    ).toBe(true);
    expect(
      matchesBenefitRule(
        { field: "role", operator: "contains", value: "Gerência" },
        { department: "", role: "gerencia de projetos" },
      ),
    ).toBe(true);
  });

  it("contains matches 'Gerente' in 'Gerente de Vendas'", () => {
    expect(
      matchesBenefitRule(
        { field: "role", operator: "contains", value: "Gerente" },
        { department: "", role: "Gerente de Vendas" },
      ),
    ).toBe(true);
  });

  it("contains returns false when absent", () => {
    expect(
      matchesBenefitRule(
        { field: "role", operator: "contains", value: "Diretor" },
        { department: "", role: "Analista" },
      ),
    ).toBe(false);
  });
});

describe("evaluateBenefitRules", () => {
  it("returns defaultPlanId when no rules match", () => {
    const prices = new Map([["plan-a", 2900]]);
    expect(
      evaluateBenefitRules(
        [{ id: "r1", field: "role", operator: "equals", value: "CEO", planId: "plan-a" }],
        { department: "RH", role: "Analista" },
        prices,
        "plan-default",
      ),
    ).toBe("plan-default");
  });

  it("returns highest-priced plan when multiple rules match", () => {
    const prices = new Map([
      ["plan-cheap", 2900],
      ["plan-expensive", 9900],
    ]);

    const rules = [
      {
        id: "r1",
        field: "department" as const,
        operator: "equals" as const,
        value: "TI",
        planId: "plan-cheap",
      },
      {
        id: "r2",
        field: "role" as const,
        operator: "contains" as const,
        value: "Gerente",
        planId: "plan-expensive",
      },
    ];

    expect(
      evaluateBenefitRules(rules, { department: "TI", role: "Gerente de TI" }, prices, null),
    ).toBe("plan-expensive");
  });

  it("treats a matched plan missing from prices as price zero", () => {
    const prices = new Map([["plan-known", 100]]);

    const rules = [
      {
        id: "r1",
        field: "department" as const,
        operator: "equals" as const,
        value: "TI",
        planId: "plan-unknown",
      },
      {
        id: "r2",
        field: "department" as const,
        operator: "equals" as const,
        value: "TI",
        planId: "plan-known",
      },
    ];

    expect(evaluateBenefitRules(rules, { department: "TI", role: "" }, prices, null)).toBe(
      "plan-known",
    );
  });

  it("returns null when no rules match and no default", () => {
    expect(evaluateBenefitRules([], { department: "", role: "" }, new Map(), null)).toBeNull();
  });

  it("handles empty person fields (talent without case)", () => {
    const prices = new Map([["plan-a", 2900]]);
    expect(
      evaluateBenefitRules(
        [{ id: "r1", field: "role", operator: "equals", value: "Gerente", planId: "plan-a" }],
        { department: "", role: "" },
        prices,
        "plan-default",
      ),
    ).toBe("plan-default");
  });
});

describe("benefitRuleSchema", () => {
  const valid = {
    id: "r1",
    field: "role",
    operator: "contains",
    value: " Gerente ",
    planId: "6f1d6a52-8a4b-4c0e-9d34-0c5f1f6a7b11",
  };

  it("accepts and trims a valid rule", () => {
    expect(benefitRuleSchema.parse(valid).value).toBe("Gerente");
  });

  it("rejects a non-uuid planId", () => {
    expect(benefitRuleSchema.safeParse({ ...valid, planId: "x" }).success).toBe(false);
  });

  it("rejects an unknown operator", () => {
    expect(benefitRuleSchema.safeParse({ ...valid, operator: "startsWith" }).success).toBe(false);
  });
});
