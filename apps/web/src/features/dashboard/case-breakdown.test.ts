import { describe, expect, it } from "vitest";
import { caseBreakdown } from "./case-breakdown";
import type { CaseSummary } from "../../entities/offboarding";

function summary(deadline: string, completed: number, total: number) {
  return {
    id: "1",
    name: "A",
    role: "r",
    department: "d",
    deadline,
    completed,
    total,
  } satisfies CaseSummary;
}

describe("caseBreakdown", () => {
  it("splits cases into overdue, on track and complete", () => {
    expect(
      caseBreakdown(
        [
          summary("2026-11-01", 1, 3),
          summary("2026-11-27", 0, 2),
          summary("2026-12-10", 1, 2),
          summary("2026-11-01", 2, 2),
        ],
        "2026-11-27",
      ),
    ).toEqual({ overdue: 1, onTrack: 2, complete: 1 });
  });

  it("returns zeros without cases", () => {
    expect(caseBreakdown([], "2026-11-27")).toEqual({
      overdue: 0,
      onTrack: 0,
      complete: 0,
    });
  });
});
