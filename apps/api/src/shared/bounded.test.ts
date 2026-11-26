import { describe, expect, it } from "vitest";
import { bounded } from "./bounded.js";

describe("bounded", () => {
  it("rounds and clamps, treating non-numbers as zero", () => {
    expect(bounded(42.6, 0, 100)).toBe(43);
    expect(bounded(140, 0, 100)).toBe(100);
    expect(bounded(-5, 0, 100)).toBe(0);
    expect(bounded(Number.NaN, 0, 100)).toBe(0);
    expect(bounded(Number.NaN, 1, 20)).toBe(1);
  });
});
