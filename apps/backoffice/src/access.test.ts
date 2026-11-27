import { describe, expect, it } from "vitest";
import { Unauthorized, isUnauthorized } from "./access";

describe("isUnauthorized", () => {
  it("recognises the unauthorized failure", () => {
    expect(isUnauthorized(new Unauthorized())).toBe(true);
  });

  it("ignores other failures", () => {
    expect(isUnauthorized(new Error("boom"))).toBe(false);
  });
});
