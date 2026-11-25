import { describe, expect, it } from "vitest";
import { isValidCpf } from "./cpf.js";

describe("isValidCpf", () => {
  it("accepts valid numbers", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("11144477735")).toBe(true);
    expect(isValidCpf("12345678909")).toBe(true);
  });

  it("rejects wrong check digits", () => {
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("52998224715")).toBe(false);
  });

  it("rejects repeated digits, wrong length and non-digits", () => {
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("529982247255")).toBe(false);
    expect(isValidCpf("529.982.247-25")).toBe(false);
    expect(isValidCpf("5299822472a")).toBe(false);
  });
});
