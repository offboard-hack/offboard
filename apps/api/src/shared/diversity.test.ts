import { describe, expect, it } from "vitest";
import { isCombinable, isDiversityValue } from "./diversity.js";

describe("checks declared diversity values", () => {
  it.each([
    ["gender", "female"],
    ["gender", "female;cis"],
    ["gender", "decline"],
    ["disability", "visual;hearing"],
    ["disability", "no"],
    ["race", "brown"],
    ["pronoun", "they"],
  ] as const)("accepts %s = %s", (key, value) => {
    expect(isDiversityValue(key, value)).toBe(true);
  });

  it.each([
    ["gender", "woman"],
    ["gender", "female;female"],
    ["gender", "female;decline"],
    ["disability", "no;visual"],
    ["race", "white;black"],
    ["orientation", ""],
  ] as const)("refuses %s = %s", (key, value) => {
    expect(isDiversityValue(key, value)).toBe(false);
  });

  it("combines values only for gender and disability", () => {
    expect(isCombinable("gender")).toBe(true);
    expect(isCombinable("disability")).toBe(true);
    expect(isCombinable("race")).toBe(false);
  });
});
