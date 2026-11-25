import { describe, expect, it } from "vitest";
import { aiApplyAccess, parseAllowlist } from "./ai-apply-access.js";

describe("parseAllowlist", () => {
  it("lowercases, trims and drops empty entries", () => {
    expect(parseAllowlist(" Ana@Example.com, ,bia@example.com,,")).toEqual([
      "ana@example.com",
      "bia@example.com",
    ]);
  });

  it("returns an empty list when unset", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
  });
});

describe("aiApplyAccess", () => {
  const consented = { personalEmail: "Ana@Example.com", aiApplyConsentAt: new Date() };

  it("allows a consenting, allowlisted email regardless of case", () => {
    expect(aiApplyAccess(consented, ["ana@example.com"])).toBe("allowed");
  });

  it("rejects an empty allowlist or another email", () => {
    expect(aiApplyAccess(consented, [])).toBe("not_allowed");
    expect(aiApplyAccess(consented, ["bia@example.com"])).toBe("not_allowed");
  });

  it("rejects a missing consent", () => {
    expect(aiApplyAccess({ ...consented, aiApplyConsentAt: null }, ["ana@example.com"])).toBe(
      "not_allowed",
    );
  });
});
