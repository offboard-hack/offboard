import { describe, expect, it } from "vitest";
import {
  jobsRefetchInterval,
  jobsRefreshMs,
  resumeRefetchInterval,
  resumeRefreshMs,
  scoreArrived,
} from "./refresh";

describe("resumeRefetchInterval", () => {
  it("polls while the résumé is being scored", () => {
    expect(resumeRefetchInterval({ rescoring: true })).toBe(resumeRefreshMs);
  });

  it("stops once scored, absent or not loaded", () => {
    expect(resumeRefetchInterval({ rescoring: false })).toBe(false);
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
  it("is true only when a rescore finishes", () => {
    expect(scoreArrived(true, false)).toBe(true);
    expect(scoreArrived(true, true)).toBe(false);
    expect(scoreArrived(undefined, false)).toBe(false);
    expect(scoreArrived(false, false)).toBe(false);
  });
});
