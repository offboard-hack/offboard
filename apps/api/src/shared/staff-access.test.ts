import { describe, expect, it } from "vitest";
import { parseStaffEmails } from "./staff-access.js";

describe("parseStaffEmails", () => {
  it("splits, trims and lowercases the allowlist", () => {
    expect(parseStaffEmails(" Ana@x.com, ,BEA@x.com ")).toEqual(
      new Set(["ana@x.com", "bea@x.com"]),
    );
  });

  it("is empty when the variable is unset", () => {
    expect(parseStaffEmails(undefined)).toEqual(new Set());
  });
});
