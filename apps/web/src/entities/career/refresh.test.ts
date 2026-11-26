import { describe, expect, it } from "vitest";
import {
  jobsRefetchInterval,
  jobsRefreshMs,
  resumeRefetchInterval,
  resumeRefreshMs,
  scoreArrived,
} from "./refresh";

describe("resumeRefetchInterval", () => {
  it("polls while the résumé waits for a score", () => {
    expect(resumeRefetchInterval({ scoredAt: null })).toBe(resumeRefreshMs);
  });

  it("stops once scored, absent or not loaded", () => {
    expect(resumeRefetchInterval({ scoredAt: "2026-11-26T12:00:00.000Z" })).toBe(false);
    expect(resumeRefetchInterval(null)).toBe(false);
    expect(resumeRefetchInterval(undefined)).toBe(false);
  });
});

describe("jobsRefetchInterval", () => {
  it("polls while matches are being computed", () => {
    expect(jobsRefetchInterval({ matching: true }, true)).toBe(jobsRefreshMs);
  });

  it("stops once matches are computed", () => {
    expect(jobsRefetchInterval({ matching: false }, true)).toBe(false);
  });

  it("stops without a résumé or data", () => {
    expect(jobsRefetchInterval({ matching: true }, false)).toBe(false);
    expect(jobsRefetchInterval(undefined, true)).toBe(false);
  });
});

describe("scoreArrived", () => {
  it("is true only when a pending score gets its time", () => {
    const at = "2026-11-26T12:00:00.000Z";

    expect(scoreArrived(null, at)).toBe(true);
    expect(scoreArrived(null, null)).toBe(false);
    expect(scoreArrived(undefined, at)).toBe(false);
    expect(scoreArrived("2026-11-25T12:00:00.000Z", at)).toBe(false);
  });
});
