import { describe, expect, it } from "vitest";
import { checkoutReferenceId } from "./webhook.js";

const id = "5dd98215-78ac-4da3-839b-27b10ca43d46";
const other = "00000000-0000-4000-8000-0000000000b1";

describe("checkoutReferenceId", () => {
  it("reads the legacy company format", () => {
    expect(checkoutReferenceId(id)).toBe(id);
  });

  it("reads a company id with an attempt suffix", () => {
    expect(checkoutReferenceId(`${id}:mwz027caf9956a`)).toBe(id);
  });

  it("reads the legacy talent format", () => {
    expect(checkoutReferenceId(`talent:${id}`, "talent:")).toBe(id);
  });

  it("reads a talent id with an attempt suffix", () => {
    expect(checkoutReferenceId(`talent:${id}:MWZ027`, "talent:")).toBe(id);
  });

  it.each([
    "",
    "not-a-uuid",
    "not-a-uuid:abc",
    `${id}:`,
    `${id}:a:b`,
    `${id}:${other}`,
    `${id}:with space`,
    `${id}:${"a".repeat(33)}`,
    `${other}:${id}`,
  ])("ignores the malformed company id %j", (externalId) => {
    expect(checkoutReferenceId(externalId)).toBeNull();
  });

  it.each([
    "talent:",
    "talent:not-a-uuid",
    `talent:${id}:`,
    `talent:${id}:a:b`,
    `talent:${other}:${id}`,
    `talent::${id}`,
  ])("ignores the malformed talent id %j", (externalId) => {
    expect(checkoutReferenceId(externalId, "talent:")).toBeNull();
  });
});
