import { describe, expect, it } from "vitest";
import { addMonths, saoPauloDate, saoPauloDayStart } from "./sao-paulo-date.js";

describe("saoPauloDate", () => {
  it("turns the day at 03:00 UTC", () => {
    expect(saoPauloDate(new Date("2026-11-24T02:59:59.999Z"))).toBe("2026-11-23");
    expect(saoPauloDate(new Date("2026-11-24T03:00:00.000Z"))).toBe("2026-11-24");
    expect(saoPauloDate(new Date("2027-01-01T02:00:00.000Z"))).toBe("2026-12-31");
  });
});

describe("saoPauloDayStart", () => {
  it("starts the São Paulo day at 03:00 UTC", () => {
    expect(saoPauloDayStart(new Date("2026-11-24T02:59:59.999Z"))).toEqual(
      new Date("2026-11-23T03:00:00.000Z"),
    );
    expect(saoPauloDayStart(new Date("2026-11-24T03:00:00.000Z"))).toEqual(
      new Date("2026-11-24T03:00:00.000Z"),
    );
  });
});

describe("addMonths", () => {
  it("clamps month-end dates to the last day of the target month", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-03-31", 1)).toBe("2027-04-30");
    expect(addMonths("2027-01-15", 1)).toBe("2027-02-15");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
});
