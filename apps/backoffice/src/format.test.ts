import { describe, expect, it } from "vitest";
import { formatBRL, formatDay, pageCount } from "./format";

describe("formatBRL", () => {
  it("formats cents as Brazilian reais", () => {
    expect(formatBRL(9900)).toBe("R$ 99,00");
  });
});

describe("formatDay", () => {
  it("shows a dash for a missing date", () => {
    expect(formatDay(null)).toBe("—");
  });

  it("formats a timestamp in São Paulo time", () => {
    expect(formatDay("2030-01-04T12:00:00.000Z")).toBe("04/01/2030");
  });
});

describe("pageCount", () => {
  it("rounds up and keeps at least one page", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });
});
