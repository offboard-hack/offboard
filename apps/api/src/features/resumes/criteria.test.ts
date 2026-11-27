import { describe, expect, it } from "vitest";
import {
  breakdownOf,
  criteria,
  criteriaSchema,
  headroom,
  provisionalScore,
  resumeCriteria,
  totalOf,
} from "./criteria.js";

function assessment(points: number, reason = "Motivo.") {
  return Object.fromEntries(criteria.map((criterion) => [criterion, { points, reason }]));
}

describe("resumeCriteria", () => {
  it("lists every criterion once, in order, with maxima summing to 100", () => {
    expect(Object.keys(resumeCriteria)).toEqual([...criteria]);
    expect(Object.keys(criteriaSchema.shape)).toEqual([...criteria]);
    expect(criteria.map((criterion) => resumeCriteria[criterion].max)).toEqual([
      20, 15, 15, 15, 10, 10, 10, 5,
    ]);
    expect(Object.values(resumeCriteria).reduce((sum, item) => sum + item.max, 0)).toBe(100);
  });
});

describe("breakdownOf", () => {
  it("clamps each criterion to its own range and rounds", () => {
    const breakdown = breakdownOf(
      criteriaSchema.parse({
        ...assessment(3),
        results: { points: 27.6, reason: "Muitos números." },
        keywords: { points: -4, reason: "Nenhuma." },
        clarity: { points: 7.5, reason: "Boa." },
        length: { points: 5.4, reason: "Certo." },
      }),
    );

    expect(breakdown).toEqual({
      results: { points: 20, max: 20, reason: "Muitos números." },
      keywords: { points: 0, max: 15, reason: "Nenhuma." },
      clarity: { points: 8, max: 15, reason: "Boa." },
      structure: { points: 3, max: 15, reason: "Motivo." },
      actionVerbs: { points: 3, max: 10, reason: "Motivo." },
      summary: { points: 3, max: 10, reason: "Motivo." },
      consistency: { points: 3, max: 10, reason: "Motivo." },
      length: { points: 5, max: 5, reason: "Certo." },
    });
    expect(totalOf(breakdown)).toBe(45);
  });

  it("keeps arithmetic out of stored reasons", () => {
    const breakdown = breakdownOf(
      criteriaSchema.parse(assessment(3, "Poucos números (20 × 1/6 ≈ 3), mas há verbos fortes.")),
    );

    expect(breakdown.results.reason).toBe("Poucos números, mas há verbos fortes.");
  });

  it("stores short, clean reasons", () => {
    const breakdown = breakdownOf(
      criteriaSchema.parse(assessment(1, `  Fala\u0000 de ${"x".repeat(400)}`)),
    );

    expect(breakdown.results.reason).toBe(`Fala de ${"x".repeat(292)}`);
  });
});

describe("totalOf", () => {
  it("sums the points and never leaves 0 to 100", () => {
    expect(totalOf({})).toBe(0);
    expect(totalOf(breakdownOf(criteriaSchema.parse(assessment(100))))).toBe(100);
    expect(
      totalOf({ a: { points: 70, max: 70, reason: "" }, b: { points: 50, max: 50, reason: "" } }),
    ).toBe(100);
  });
});

describe("headroom", () => {
  it("is what a criterion can still gain", () => {
    const breakdown = breakdownOf(
      criteriaSchema.parse({ ...assessment(4), length: { points: 5, reason: "" } }),
    );

    expect(headroom(breakdown, "results")).toBe(16);
    expect(headroom(breakdown, "length")).toBe(0);
    expect(headroom(breakdown, "unknown")).toBe(0);
    expect(headroom({ x: { points: 9, max: 5, reason: "" } }, "x")).toBe(0);
  });
});

describe("provisionalScore", () => {
  const breakdown = breakdownOf(criteriaSchema.parse(assessment(4)));

  it("adds the gain to its criterion, capped at the criterion maximum", () => {
    expect(provisionalScore({ score: 32, breakdown }, "results", 6)).toEqual({
      score: 38,
      breakdown: { ...breakdown, results: { ...breakdown.results, points: 10 } },
    });
    expect(provisionalScore({ score: 32, breakdown }, "length", 6)).toEqual({
      score: 33,
      breakdown: { ...breakdown, length: { ...breakdown.length, points: 5 } },
    });
  });

  it("falls back to the total without a breakdown or a known criterion", () => {
    expect(provisionalScore({ score: 62, breakdown: null }, "results", 10)).toEqual({
      score: 72,
      breakdown: null,
    });
    expect(provisionalScore({ score: 95, breakdown }, null, 10)).toEqual({ score: 100, breakdown });
    expect(provisionalScore({ score: 40, breakdown }, "gone", 3)).toEqual({ score: 43, breakdown });
    expect(provisionalScore({ score: null, breakdown: null }, "results", 4)).toEqual({
      score: null,
      breakdown: null,
    });
  });
});
