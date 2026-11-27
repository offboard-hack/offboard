import { describe, expect, it } from "vitest";
import { isDeadlineOverdue } from "./deadline-overdue";

describe("isDeadlineOverdue", () => {
  it("is overdue only once the deadline day is before today", () => {
    expect(isDeadlineOverdue("2026-11-26", "2026-11-27")).toBe(true);
    expect(isDeadlineOverdue("2026-11-27", "2026-11-27")).toBe(false);
    expect(isDeadlineOverdue("2026-11-28", "2026-11-27")).toBe(false);
  });
});
