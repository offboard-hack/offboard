import { describe, expect, it } from "vitest";
import {
  jobsRefetchInterval,
  jobsRefreshMs,
  resumeRefetchInterval,
  resumeRefreshMs,
  scoreArrived,
} from "./refresh";

describe("resumeRefetchInterval", () => {
  it("polls while the résumé has no score", () => {
    expect(resumeRefetchInterval({ score: null })).toBe(resumeRefreshMs);
  });

  it("stops once scored, absent or not loaded", () => {
    expect(resumeRefetchInterval({ score: 0 })).toBe(false);
    expect(resumeRefetchInterval({ score: 80 })).toBe(false);
    expect(resumeRefetchInterval(null)).toBe(false);
    expect(resumeRefetchInterval(undefined)).toBe(false);
  });
});

describe("jobsRefetchInterval", () => {
  it("polls while no job on the page has a match", () => {
    expect(jobsRefetchInterval({ items: [{ match: null }, { match: null }] }, true)).toBe(
      jobsRefreshMs,
    );
  });

  it("stops when any job has a match", () => {
    expect(jobsRefetchInterval({ items: [{ match: null }, { match: { score: 1 } }] }, true)).toBe(
      false,
    );
  });

  it("stops without a résumé or data", () => {
    expect(jobsRefetchInterval({ items: [{ match: null }] }, false)).toBe(false);
    expect(jobsRefetchInterval(undefined, true)).toBe(false);
  });
});

describe("scoreArrived", () => {
  it("is true only when a null score becomes a number", () => {
    expect(scoreArrived(null, 0)).toBe(true);
    expect(scoreArrived(null, null)).toBe(false);
    expect(scoreArrived(undefined, 50)).toBe(false);
    expect(scoreArrived(40, 50)).toBe(false);
  });
});
