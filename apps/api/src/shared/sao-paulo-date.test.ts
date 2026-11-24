import { describe, expect, it } from "vitest";
import { saoPauloDate } from "./sao-paulo-date.js";

describe("saoPauloDate", () => {
  it("turns the day at 03:00 UTC", () => {
    expect(saoPauloDate(new Date("2026-11-24T02:59:59.999Z"))).toBe("2026-11-23");
    expect(saoPauloDate(new Date("2026-11-24T03:00:00.000Z"))).toBe("2026-11-24");
    expect(saoPauloDate(new Date("2027-01-01T02:00:00.000Z"))).toBe("2026-12-31");
  });
});
